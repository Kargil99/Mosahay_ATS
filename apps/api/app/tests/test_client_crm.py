import pytest
from pydantic import ValidationError

from app.schemas.models import BulkScoreCreate, ClientActivityCreate, ClientContractCreate


def test_bulk_score_selection_is_required_bounded_and_unique():
    with pytest.raises(ValidationError):
        BulkScoreCreate(application_ids=[])
    with pytest.raises(ValidationError):
        BulkScoreCreate(application_ids=["same", "same"])
    with pytest.raises(ValidationError):
        BulkScoreCreate(application_ids=[str(index) for index in range(101)])
    assert BulkScoreCreate(application_ids=["one", "two"]).application_ids == ["one", "two"]


def test_client_contract_validates_dates_and_percentage_fee():
    with pytest.raises(ValidationError):
        ClientContractCreate(title="Recruitment Agreement", fee_model="fixed", fee_value=1, valid_from="2026-06-01", valid_until="2026-05-01")
    with pytest.raises(ValidationError):
        ClientContractCreate(title="Recruitment Agreement", fee_model="percentage", fee_value=110)
    contract = ClientContractCreate(title="Recruitment Agreement", fee_model="percentage", fee_value=12.5, guarantee_months=3)
    assert contract.currency == "INR"


def test_client_activity_only_accepts_supported_types_and_limits_detail_length():
    with pytest.raises(ValidationError):
        ClientActivityCreate(activity_type="system", subject="Manual record")
    with pytest.raises(ValidationError):
        ClientActivityCreate(activity_type="call", subject="Call", details="x" * 10001)
    assert ClientActivityCreate(activity_type="meeting", subject="Quarterly hiring review").activity_type == "meeting"
