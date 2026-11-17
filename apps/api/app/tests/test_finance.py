from decimal import Decimal

import pytest

from app.services.finance import calculate_placement_fee


def test_fee_calculation_uses_explicit_approved_terms():
    assert calculate_placement_fee("percentage", Decimal("12.5"), Decimal("1500000")) == Decimal("187500.00")
    assert calculate_placement_fee("fixed", Decimal("50000.456"), None) == Decimal("50000.46")


def test_percentage_fee_requires_ctc_and_valid_rate():
    with pytest.raises(ValueError, match="CTC"):
        calculate_placement_fee("percentage", Decimal("10"), None)
    with pytest.raises(ValueError, match="between 0 and 100"):
        calculate_placement_fee("percentage", Decimal("110"), Decimal("500000"))
