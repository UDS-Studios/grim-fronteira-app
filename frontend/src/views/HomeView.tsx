type HomeViewProps = {
  joinGameId: string;
  setJoinGameId: (v: string) => void;
  onNewGame: () => void;
  onJoinGame: () => Promise<void>;
};

export default function HomeView({
  joinGameId,
  setJoinGameId,
  onNewGame,
  onJoinGame,
}: HomeViewProps) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "auto",
        padding: 8,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          background: "var(--surface-bg)",
          border: "1px solid var(--border-strong)",
          borderRadius: 16,
          padding: 24,
          width: "min(760px, 100%)",
          display: "grid",
          gap: 22,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <h1
            style={{
              margin: 0,
              fontFamily: "LavaArabic, serif",
              fontSize: "5.1em",
              letterSpacing: "0.05em",
              lineHeight: 1,
            }}
          >
            Grim Fronteira
          </h1>

          <div
            style={{
              marginTop: 8,
              fontSize: "1.2em",
              letterSpacing: "0.12em",
              opacity: 0.85,
              fontStyle: "italic",
            }}
          >
            The Frontier is Waiting...
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 28,
            alignItems: "start",
          }}
        >
          <button
            onClick={onNewGame}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              justifySelf: "center",
            }}
            title="Create a new game"
          >
            <img
              src="/ui/new-game.png"
              alt="New Game"
              style={{
                width: 260,
                height: "auto",
                display: "block",
              }}
            />
          </button>

          <div
            style={{
              display: "grid",
              gap: 10,
              justifyItems: "center",
            }}
          >
            <input
              value={joinGameId}
              onChange={(e) => setJoinGameId(e.target.value)}
              placeholder="game_id"
              style={{
                width: 260,
                textAlign: "center",
                padding: "8px 10px",
              }}
            />

            <button
              onClick={onJoinGame}
              disabled={!joinGameId.trim()}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: joinGameId.trim() ? "pointer" : "default",
                opacity: joinGameId.trim() ? 1 : 0.45,
              }}
              title={joinGameId.trim() ? "Join existing game" : "Enter a game id first"}
            >
              <img
                src="/ui/join-game.png"
                alt="Join Game"
                style={{
                  width: 260,
                  height: "auto",
                  display: "block",
                }}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
