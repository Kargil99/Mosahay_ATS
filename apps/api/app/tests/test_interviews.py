import pytest

from app.services.interviews import validate_interview_questions


def test_question_validation_trims_and_preserves_job_related_questions():
    assert validate_interview_questions(["  Explain your role-related design process  "]) == ["Explain your role-related design process"]


@pytest.mark.parametrize(
    "questions",
    [
        [],
        ["tiny"],
        ["How do you solve role problems?", "how do you solve role problems?"],
        ["How old are you and what is your work history?"],
        [None],
    ],
)
def test_question_validation_rejects_invalid_or_non_job_related_questions(questions):
    with pytest.raises(ValueError):
        validate_interview_questions(questions)
