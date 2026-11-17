from fastapi.testclient import TestClient

from app.main import app
from app.routers.api import _safe_csv_cell


def test_health_is_safe_and_does_not_need_supabase():
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "mosahay-recruitos-api"}


def test_authenticated_endpoints_require_configured_backend_and_bearer_token():
    response = TestClient(app).get("/api/v1/me")
    assert response.status_code in {401, 503}
    assert "SUPABASE" not in response.text


def test_csv_cells_neutralize_spreadsheet_formulas():
    assert _safe_csv_cell("=HYPERLINK(\"https://example.invalid\")").startswith("'")
    assert _safe_csv_cell("  +SUM(A1:A2)").startswith("'")
    assert _safe_csv_cell("Candidate name") == "Candidate name"
    assert _safe_csv_cell(None) == ""


def test_candidate_csv_import_requires_an_authenticated_workspace():
    response = TestClient(app).post(
        "/api/v1/candidates/import.csv?org_id=00000000-0000-0000-0000-000000000001",
        files={"file": ("candidates.csv", b"full_name,email\nAsha Rao,asha@example.invalid\n", "text/csv")},
    )
    assert response.status_code in {401, 503}
