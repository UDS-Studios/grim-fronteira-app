import pytest


@pytest.fixture
def enabled_debug_api(monkeypatch):
    """Explicit, function-scoped permission for application debug tests."""
    monkeypatch.setenv("GF_ENABLE_DEBUG_API", "1")
