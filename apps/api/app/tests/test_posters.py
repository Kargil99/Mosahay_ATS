import pytest
from pydantic import ValidationError

from app.schemas.models import JobPosterCreate


def test_poster_request_accepts_supported_templates_formats_and_languages():
    request = JobPosterCreate(
        org_id="org-id",
        title="Warehouse Associate",
        template_id="warehouse",
        format="whatsapp",
        language="or",
        poster_copy={"title": "ଗୋଦାମ ସହାୟକ"},
    )
    assert request.template_id == "warehouse"
    assert request.poster_copy["title"]


def test_poster_request_rejects_unsupported_template_or_long_copy():
    with pytest.raises(ValidationError):
        JobPosterCreate(org_id="org-id", title="Role", template_id="fake", format="square", poster_copy={})
    with pytest.raises(ValidationError):
        JobPosterCreate(org_id="org-id", title="Role", template_id="corporate", format="square", poster_copy={"title": "x" * 2001})
