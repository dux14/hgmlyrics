from core import build_voice_entry, merge_voices_present

def test_build_voice_entry_permite_solape_polifonico():
    notes = [{"start":1.0,"end":2.0,"midi":60,"note":"C4","cents":0},
             {"start":1.2,"end":1.8,"midi":64,"note":"E4","cents":3}]
    entry = build_voice_entry(notes)
    assert len(entry["notes"]) == 2 and entry["notes"][1]["note"] == "E4"

def test_merge_voices_present_dedup_y_orden():
    assert merge_voices_present(["lead","backing"], ["female","male"]) == ["lead","backing","male","female"]
    assert merge_voices_present(["lead","male"], ["male"]) == ["lead","male"]  # idempotente
