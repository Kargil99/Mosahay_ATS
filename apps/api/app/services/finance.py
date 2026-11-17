"""Fee calculations based on explicitly approved placement terms."""
from decimal import Decimal, ROUND_HALF_UP


CENT = Decimal("0.01")


def calculate_placement_fee(model: str, fee_value: Decimal, agreed_ctc: Decimal | None) -> Decimal:
    if fee_value < 0:
        raise ValueError("Fee value cannot be negative")
    if model == "percentage":
        if agreed_ctc is None:
            raise ValueError("Agreed CTC is required for a percentage fee")
        if not Decimal(0) <= fee_value <= Decimal(100):
            raise ValueError("Percentage fee must be between 0 and 100")
        return (agreed_ctc * fee_value / Decimal(100)).quantize(CENT, rounding=ROUND_HALF_UP)
    if model in {"fixed", "milestone", "custom"}:
        return fee_value.quantize(CENT, rounding=ROUND_HALF_UP)
    raise ValueError("Unsupported placement fee model")
