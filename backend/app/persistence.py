"""Single-writer Linux filesystem durability; runtime authority is never saved."""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
import fcntl
import json
import logging
import math
import os
from pathlib import Path
import re
import tempfile
from typing import TYPE_CHECKING
from uuid import UUID

from backend.app.session_authority import SeatSessionRecord
from backend.engine.state.game_state import GameState
from backend.engine.state.game_state_io import game_state_from_data, game_state_to_data
from backend.engine.state.validators import validate_game_state

if TYPE_CHECKING:
    from backend.app.store import StoredGame

SCHEMA = "grimfronteira.storedgame"
VERSION = 1
LOG = logging.getLogger(__name__)
HASH = re.compile(r"[0-9a-f]{64}\Z")
RUNTIME_FIELDS = {
    "presence", "session_pause", "sessions", "active_session", "active_session_hash",
    "superseded_session_hashes", "last_seen", "reconnect_token", "reconnect_token_hash",
    "online", "offline", "lock",
}


class PersistenceUnavailable(RuntimeError):
    def __init__(self):
        super().__init__("Game persistence is unavailable")


class GameUnavailable(RuntimeError):
    def __init__(self):
        super().__init__("This game is unavailable")


class SessionTopologyInvalid(RuntimeError):
    def __init__(self):
        super().__init__("Game seats and recovery authority are inconsistent")


class InvalidSnapshot(ValueError):
    """Contains only a fixed diagnostic category, never input values."""


def canonical_id(value: object) -> str:
    if not isinstance(value, str):
        raise InvalidSnapshot("identifier")
    try:
        if str(UUID(value)) != value:
            raise ValueError
    except ValueError:
        raise InvalidSnapshot("identifier") from None
    return value


def configured_directory() -> Path:
    override = os.environ.get("GF_PERSISTENCE_DIR")
    if override is None:
        return Path(__file__).resolve().parents[2] / "var" / "games"
    path = Path(override)
    if not path.is_absolute():
        raise RuntimeError("GF_PERSISTENCE_DIR must be an absolute path")
    return path


def _require(condition: bool, category: str = "structure") -> None:
    if not condition:
        raise InvalidSnapshot(category)


def _integer(value: object) -> bool:
    return type(value) is int and value >= 0


def _json_values(value: object) -> None:
    if value is None or type(value) in (str, bool, int):
        return
    if type(value) is float and math.isfinite(value):
        return
    if isinstance(value, list):
        for item in value:
            _json_values(item)
        return
    if isinstance(value, dict) and all(isinstance(k, str) for k in value):
        for item in value.values():
            _json_values(item)
        return
    raise InvalidSnapshot("json")


def _validate_state(data: object) -> GameState:
    _require(isinstance(data, dict))
    _require(set(data) == {"schema", "version", "deck", "zones", "meta"})
    _require(data["schema"] == "grimfronteira.gamestate" and type(data["version"]) is int and data["version"] == 1, "version")
    deck = data["deck"]
    _require(isinstance(deck, dict))
    _require(set(deck) == {"schema", "version", "created_utc", "notes", "settings", "draw_pile", "in_play", "discard_pile", "removed"})
    _require(deck["schema"] == "grimfronteira.deckstate" and type(deck["version"]) is int and deck["version"] == 1, "version")
    _require(deck["created_utc"] is None or isinstance(deck["created_utc"], str))
    _require(isinstance(deck["notes"], str))
    settings = deck["settings"]
    _require(settings is None or isinstance(settings, dict))
    if settings is not None:
        _require(set(settings) == {"top_of_deck", "include_jokers", "deck_size"})
        _require(settings["top_of_deck"] in {"first", "last"})
        _require(type(settings["include_jokers"]) is bool and _integer(settings["deck_size"]))
    for pile in ("draw_pile", "in_play", "discard_pile", "removed"):
        _require(isinstance(deck[pile], list) and all(isinstance(c, str) and c for c in deck[pile]))
    zones, meta = data["zones"], data["meta"]
    _require(isinstance(zones, dict) and all(isinstance(k, str) and isinstance(v, list)
             and all(isinstance(c, str) and c for c in v) for k, v in zones.items()))
    _require(isinstance(meta, dict) and _integer(meta.get("revision")))
    _require(not RUNTIME_FIELDS.intersection(meta), "runtime_fields")
    _require(meta.get("phase") in {"lobby", "hook_selection", "started", "table", "victory"})
    try:
        state = game_state_from_data(data)
        validate_game_state(state)
    except (ValueError, TypeError, KeyError, AttributeError):
        raise InvalidSnapshot("game_state") from None
    return state


def _validate_topology(state: GameState, sessions: object) -> None:
    meta = state.meta
    marshal, order = meta.get("marshal_id"), meta.get("players_order")
    _require(isinstance(marshal, str) and bool(marshal.strip()), "topology")
    _require(isinstance(order, list) and all(isinstance(p, str) and p.strip() for p in order), "topology")
    _require(len(order) == len(set(order)) and marshal in order, "topology")
    _require(isinstance(sessions, dict) and set(sessions) == set(order), "topology")
    player_metadata = meta.get("players", {})
    _require(isinstance(player_metadata, dict) and set(player_metadata) <= set(order), "topology")
    setup_seats = meta.get("setup.players", [])
    _require(isinstance(setup_seats, list) and all(isinstance(p, str) and p in order for p in setup_seats), "topology")
    lobby = meta.get("lobby")
    _require(isinstance(lobby, dict), "topology")
    players = lobby.get("players")
    _require(isinstance(players, dict) and set(players) == set(order)
             and all(isinstance(p, dict) for p in players.values()), "topology")
    hashes = []
    for record in sessions.values():
        _require(isinstance(record, dict) and set(record) == {"reconnect_token_hash"}, "authority")
        digest = record["reconnect_token_hash"]
        _require(isinstance(digest, str) and HASH.fullmatch(digest) is not None, "authority")
        hashes.append(digest)
    _require(len(hashes) == len(set(hashes)), "authority")


def encode_envelope(game_id: str, state: GameState, sessions: Mapping[str, SeatSessionRecord]) -> dict:
    canonical_id(game_id)
    data = game_state_to_data(state)
    durable_sessions = {seat: {"reconnect_token_hash": record.reconnect_token_hash}
                        for seat, record in sessions.items()}
    _require(all(seat == record.player_id for seat, record in sessions.items()), "topology")
    _json_values(data)
    _validate_state(data)
    _validate_topology(state, durable_sessions)
    return {"schema": SCHEMA, "version": VERSION, "game_id": game_id,
            "game_state": data, "sessions": durable_sessions}


def _pairs(pairs: list) -> dict:
    result = {}
    for key, value in pairs:
        _require(key not in result, "json")
        result[key] = value
    return result


def _reject_constant(value: str):
    raise InvalidSnapshot("json")


def decode_envelope(text: str, game_id: str) -> StoredGame:
    from backend.app.store import StoredGame
    try:
        data = json.loads(text, object_pairs_hook=_pairs, parse_constant=_reject_constant)
        _json_values(data)
        _require(isinstance(data, dict) and set(data) == {"schema", "version", "game_id", "game_state", "sessions"})
        _require(data["schema"] == SCHEMA and type(data["version"]) is int and data["version"] == VERSION, "version")
        _require(canonical_id(data["game_id"]) == canonical_id(game_id), "identifier")
        state = _validate_state(data["game_state"])
        _validate_topology(state, data["sessions"])
        return StoredGame(state=state, sessions={seat: SeatSessionRecord(
            player_id=seat, reconnect_token_hash=record["reconnect_token_hash"],
            active_session_hash="", superseded_session_hashes=frozenset(), last_seen=None,
        ) for seat, record in data["sessions"].items()})
    except InvalidSnapshot:
        raise
    except (ValueError, TypeError, KeyError, AttributeError, RecursionError):
        raise InvalidSnapshot("structure") from None


@dataclass
class RestoreReport:
    games: dict[str, StoredGame] = field(default_factory=dict)
    rejected: set[str] = field(default_factory=set)


class MemoryRepository:
    """Explicit test injection: no disk writes or strict synthetic-seat validation."""
    durable = False

    def __init__(self):
        self.unavailable: set[str] = set()

    def ensure_available(self, game_id: str) -> None:
        if game_id in self.unavailable:
            raise GameUnavailable()

    def fence(self, game_id: str) -> None:
        self.unavailable.add(game_id)

    def save_snapshot(self, game_id, state, sessions) -> None:
        self.ensure_available(game_id)

    def delete_snapshot(self, game_id) -> None:
        self.unavailable.discard(game_id)


class UninitializedRepository(MemoryRepository):
    """Production cannot silently run without lifespan initialization."""
    def save_snapshot(self, game_id, state, sessions) -> None:
        raise PersistenceUnavailable()


class FileRepository(MemoryRepository):
    durable = True

    def __init__(self, directory: Path | None = None):
        super().__init__()
        self.directory = Path(directory) if directory is not None else configured_directory()
        if not self.directory.is_absolute():
            raise RuntimeError("Persistence directory must be absolute")
        self._lock_fd: int | None = None
        self._dir_fd: int | None = None

    def open(self) -> FileRepository:
        if self._lock_fd is not None:
            raise RuntimeError("Persistence repository is already open")
        try:
            self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            self._dir_fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            self._lock_fd = os.open(self.directory / ".writer.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            fcntl.flock(self._lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            os.fchmod(self._dir_fd, 0o700)
            os.fchmod(self._lock_fd, 0o600)
            # Probe the same durability operations required by saves, before serving.
            fd, path = tempfile.mkstemp(prefix=".probe-", dir=self.directory)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
                os.unlink(path)
            self._fsync_directory()
            return self
        except OSError:
            self.close()
            raise RuntimeError("Cannot initialize persistence directory or acquire exclusive writer ownership") from None

    def close(self) -> None:
        if self._lock_fd is not None:
            os.close(self._lock_fd)
            self._lock_fd = None
        if self._dir_fd is not None:
            os.close(self._dir_fd)
            self._dir_fd = None

    def _require_open(self) -> None:
        if self._lock_fd is None:
            raise PersistenceUnavailable()

    def _fsync_directory(self) -> None:
        os.fsync(self._dir_fd)

    def _write_temp(self, path: Path, content: str) -> None:
        with path.open("w", encoding="utf-8") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())

    def save_snapshot(self, game_id: str, state: GameState, sessions: Mapping[str, SeatSessionRecord]) -> None:
        self._require_open()
        self.ensure_available(game_id)
        try:
            envelope = encode_envelope(game_id, state, sessions)
        except InvalidSnapshot as exc:
            if str(exc) in {"topology", "authority"}:
                raise SessionTopologyInvalid() from None
            raise PersistenceUnavailable() from None
        except Exception:
            raise PersistenceUnavailable() from None
        temp = None
        replaced = False
        replacing = False
        content = None
        try:
            content = json.dumps(envelope, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n"
            fd, name = tempfile.mkstemp(prefix=f".{game_id}-", suffix=".tmp", dir=self.directory)
            temp = Path(name)
            os.close(fd)  # mkstemp creates 0600; reopen only our private temporary file.
            self._write_temp(temp, content)
            replacing = True
            os.replace(temp, self.directory / f"{game_id}.json")
            replaced = True
            self._fsync_directory()
        except Exception:
            # os.replace normally either completes or raises without replacing.
            # Also handle injected/exceptional errors after it actually completed.
            uncertain = replaced
            if replacing and not replaced:
                try:
                    uncertain = (self.directory / f"{game_id}.json").read_text(encoding="utf-8") == content
                except FileNotFoundError:
                    pass
                except (OSError, UnicodeError):
                    uncertain = True
            if uncertain:
                self.fence(game_id)
            LOG.error("Persistence save failed game=%s category=%s", game_id,
                      "uncertain_commit" if uncertain else "write")
            raise PersistenceUnavailable() from None
        finally:
            if temp is not None:
                try:
                    temp.unlink(missing_ok=True)
                except OSError:
                    pass

    def load_snapshot(self, path: Path) -> StoredGame:
        self._require_open()
        canonical_id(path.stem)
        if path.parent != self.directory or path.suffix != ".json" or path.is_symlink():
            raise InvalidSnapshot("file")
        return decode_envelope(path.read_text(encoding="utf-8"), path.stem)

    def load_all(self) -> RestoreReport:
        self._require_open()
        report = RestoreReport()
        for path in sorted(self.directory.glob("*.json")):
            try:
                canonical_id(path.stem)
            except InvalidSnapshot:
                continue
            try:
                report.games[path.stem] = self.load_snapshot(path)
            except Exception as exc:
                report.rejected.add(path.stem)
                category = str(exc) if isinstance(exc, InvalidSnapshot) else "read"
                LOG.warning("Persistence restore rejected game=%s category=%s", path.stem, category)
        self.unavailable.update(report.rejected)
        return report

    def delete_snapshot(self, game_id: str) -> None:
        self._require_open()
        canonical_id(game_id)
        removed = False
        try:
            (self.directory / f"{game_id}.json").unlink(missing_ok=True)
            removed = True
            self._fsync_directory()
            self.unavailable.discard(game_id)
        except OSError:
            if removed:
                self.fence(game_id)
            raise PersistenceUnavailable() from None
