from app.services.ai_extraction import Fact, ResumeExtraction, SkillFact, merge_verified_facts


def extraction(**updates):
    values = {
        "full_name": Fact(value=None), "email": Fact(value=None), "phone": Fact(value=None),
        "current_title": Fact(value=None), "current_employer": Fact(value=None), "skills": [],
        "experiences": [], "qualifications": [], "certifications": [],
    }
    values.update(updates)
    return ResumeExtraction(**values)


def test_ai_fact_merge_requires_verbatim_resume_evidence():
    parsed, warnings = merge_verified_facts(
        {"full_name": None, "skills": []},
        extraction(full_name=Fact(value="Jane Doe", evidence_quote="Jane Doe"),
                   skills=[SkillFact(skill="Python", evidence_quote="Python and SQL"), SkillFact(skill="Ruby", evidence_quote="Ruby is a nice language")]),
        "Jane Doe\nSkills: Python and SQL",
    )
    assert parsed["full_name"] == "Jane Doe"
    assert parsed["skills"] == ["Python"]
    assert len(warnings) == 1


def test_ai_extraction_schema_does_not_include_protected_trait_fields():
    fields = set(ResumeExtraction.model_fields)
    assert not fields.intersection({"age", "gender", "nationality", "religion", "health", "disability", "personality"})
