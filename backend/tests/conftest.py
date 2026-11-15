import socket
import pytest
import os

def _is_postgres_available() -> bool:
    host = os.getenv("POSTGRES_HOST", "db.avwolouaxhjprevyskfk.supabase.co")
    port = int(os.getenv("POSTGRES_PORT", "5432"))
    try:
        res = socket.getaddrinfo(host, port)
        return bool(res)
    except Exception:
        return False

POSTGRES_AVAILABLE = _is_postgres_available()

@pytest.fixture(autouse=True)
def check_db_availability(request):
    """Automatically skips tests requiring direct live PostgreSQL socket if network/DNS is unreachable."""
    if "requires_postgres" in request.keywords and not POSTGRES_AVAILABLE:
        pytest.skip("Live PostgreSQL socket is unreachable in this environment.")
