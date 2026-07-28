from fusion import assemble_analysis

def test_analysis_incluye_voces_extra_sin_romper_lead_backing():
    base = {"lead": {"lines": [{"syllables": []}]}, "backing": {"lines": []}}
    extra = {"male": {"notes": []}, "female": {"notes": []}}
    result = assemble_analysis(base_voices=base, modulations=[], voices_present_base=["lead","backing"], extra_voices=extra)
    assert result["voices_present"] == ["lead","backing","male","female"]
    assert result["voices"]["male"] == extra["male"]
    assert result["voices"]["lead"] == base["lead"]  # sin tocar

def test_assemble_analysis_sin_extra_es_solo_lead_backing():
    base = {"lead": {"lines": []}, "backing": {"lines": []}}
    result = assemble_analysis(base_voices=base, modulations=[], voices_present_base=["lead","backing"])
    assert result["voices_present"] == ["lead","backing"]
