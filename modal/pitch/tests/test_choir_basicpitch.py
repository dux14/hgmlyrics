from choir_basicpitch import basic_pitch_events_to_notes

def test_convierte_eventos_solapados_y_descarta_baja_confianza():
    events = [{"start_time_s":1.0,"end_time_s":2.0,"pitch_midi":60,"amplitude":0.8},
              {"start_time_s":1.2,"end_time_s":1.8,"pitch_midi":64,"amplitude":0.6},
              {"start_time_s":0.0,"end_time_s":0.1,"pitch_midi":60,"amplitude":0.05}]
    notes = basic_pitch_events_to_notes(events, min_amplitude=0.3)
    assert len(notes) == 2
    assert notes[0]["note"] == "C4" and notes[1]["note"] == "E4"
