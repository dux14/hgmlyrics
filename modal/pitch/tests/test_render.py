import xml.etree.ElementTree as ET
from render import analysis_to_svg, analysis_to_png, analysis_to_midi, analysis_to_musicxml
import music21


def test_svg_xml_valido_silabas_y_leyenda_modulacion(analysis_small):
    svg = analysis_to_svg(analysis_small)
    root = ET.fromstring(svg)
    assert root.tag.endswith("svg")
    texts = [t.text for t in root.iter() if t.tag.endswith("text")]
    assert "Me" in texts and "vá" in texts and "oh" in texts
    assert "C4" in texts and "D4" in texts and "G3" in texts
    assert "''" in texts
    assert any(t in ("–", "-") for t in texts)
    assert "+7" in svg


def test_png_valido(analysis_small):
    png = analysis_to_png(analysis_to_svg(analysis_small))
    assert isinstance(png, bytes) and png[:8] == b"\x89PNG\r\n\x1a\n" and len(png) > 100


def test_midi_una_pista_por_voz_y_ditto_sostiene(analysis_small):
    pm = analysis_to_midi(analysis_small)
    assert len(pm.instruments) == 2
    lead = next(i for i in pm.instruments if i.name == "lead")
    backing = next(i for i in pm.instruments if i.name == "backing")
    assert len(lead.notes) == 2
    assert lead.notes[0].pitch == 60 and lead.notes[0].start == 0.31 and lead.notes[0].end == 0.55
    assert lead.notes[1].pitch == 62
    assert len(backing.notes) == 1 and backing.notes[0].pitch == 55


def test_musicxml_una_parte_por_voz_con_lyrics(analysis_small):
    xml_bytes = analysis_to_musicxml(analysis_small)
    assert isinstance(xml_bytes, bytes) and b"<score-partwise" in xml_bytes
    score = music21.converter.parse(xml_bytes.decode("utf-8"), format="musicxml")
    assert len(score.parts) == 2
    lead_notes = list(score.parts[0].flatten().notesAndRests)
    lyrics = [n.lyric for n in lead_notes if n.isNote and n.lyric]
    pitches = [n.pitch.nameWithOctave for n in lead_notes if n.isNote]
    assert "Me" in lyrics and "vá" in lyrics
    assert "C4" in pitches and "D4" in pitches
    # una sílaba blank conserva su texto: el Rest lleva el lyric (no se pierde la palabra)
    all_lyrics = [n.lyric for n in lead_notes if n.lyric]
    assert "la" in all_lyrics
