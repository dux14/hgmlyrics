import xml.etree.ElementTree as ET
from render import analysis_to_svg, analysis_to_png


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
