"""Fase render/export: analysis.json (multi-voz) -> SVG + PNG + MIDI + MusicXML.
Funciones puras (sin I/O de red); run_render (Task 6) hace la subida + webhook."""
from __future__ import annotations
from xml.sax.saxutils import escape

from _common import request_signed_put, upload_put, post_webhook, artifact, extract_storage_key

_COL_W, _ROW_H, _SECTION_GAP, _MARGIN = 60, 70, 30, 20
_VOICE_LABELS = {"lead": "Voz principal", "backing": "Voz de fondo"}


def _note_label(syl: dict) -> str:
    if syl.get("blank"):
        return "–"
    if syl.get("ditto"):
        return "''"
    return syl.get("note") or "–"


def analysis_to_svg(analysis: dict) -> str:
    voices_present = analysis.get("voices_present", [])
    voices = analysis.get("voices", {})
    modulations = analysis.get("modulations", [])
    max_cols, total_rows = 0, 0
    for name in voices_present:
        lines = voices.get(name, {}).get("lines", [])
        total_rows += 1 + len(lines)
        for line in lines:
            max_cols = max(max_cols, len(line.get("syllables", [])))
    width = _MARGIN * 2 + max(max_cols, 1) * _COL_W
    height = _MARGIN * 2 + total_rows * _ROW_H + _SECTION_GAP * len(voices_present) + (40 if modulations else 0)
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">']
    y = _MARGIN
    for name in voices_present:
        lines = voices.get(name, {}).get("lines", [])
        parts.append(f'<text x="{_MARGIN}" y="{y + 20}" class="voice-label">{escape(_VOICE_LABELS.get(name, name))}</text>')
        y += _ROW_H
        for line in lines:
            x = _MARGIN
            for syl in line.get("syllables", []):
                text = syl.get("text")
                if text:
                    parts.append(f'<text x="{x}" y="{y}" class="lyric">{escape(text)}</text>')
                parts.append(f'<text x="{x}" y="{y + 24}" class="note">{escape(_note_label(syl))}</text>')
                x += _COL_W
            y += _ROW_H
        y += _SECTION_GAP
    if modulations:
        legend = "; ".join(f'{m["time"]}s {m["from"]}→{m["to"]} ({m["semitones"]:+d})' for m in modulations)
        parts.append(f'<text x="{_MARGIN}" y="{y + 20}" class="modulations">Cambios de tono: {escape(legend)}</text>')
    parts.append("</svg>")
    return "\n".join(parts)


def analysis_to_png(svg: str) -> bytes:
    import cairosvg  # requiere libcairo2 nativo
    return cairosvg.svg2png(bytestring=svg.encode("utf-8"))


def analysis_to_midi(analysis: dict):
    import pretty_midi
    pm = pretty_midi.PrettyMIDI()
    for name in analysis.get("voices_present", []):
        inst = pretty_midi.Instrument(program=0, name=name)
        current = None
        for line in analysis.get("voices", {}).get(name, {}).get("lines", []):
            for syl in line.get("syllables", []):
                if syl.get("blank"):
                    current = None
                    continue
                if syl.get("ditto") and current is not None:
                    current.end = syl["end"]
                    continue
                current = pretty_midi.Note(velocity=90, pitch=int(syl["midi"]),
                                            start=syl["start"], end=syl["end"])
                inst.notes.append(current)
        pm.instruments.append(inst)
    return pm


def analysis_to_musicxml(analysis: dict) -> bytes:
    import music21
    from music21.musicxml.m21ToXml import GeneralObjectExporter

    score = music21.stream.Score()
    for name in analysis.get("voices_present", []):
        part = music21.stream.Part(id=name)
        for line in analysis.get("voices", {}).get(name, {}).get("lines", []):
            for syl in line.get("syllables", []):
                if syl.get("blank"):
                    part.append(music21.note.Rest(quarterLength=1))
                    continue
                note_name = syl.get("note") or music21.pitch.Pitch(midi=int(syl["midi"])).nameWithOctave
                n = music21.note.Note(note_name, quarterLength=1)
                n.lyric = "''" if syl.get("ditto") else syl.get("text", "")
                part.append(n)
        score.insert(0, part)
    return GeneralObjectExporter(score).parse()


def run_render(job_id, webhook, sign_upload_url, inbound_secret, analysis):
    """Genera SVG+PNG+MIDI+MusicXML desde analysis (en memoria), los sube por
    signed PUT y postea el webhook 'render' con ok:true. En fallo: postea
    ok:false con el error y re-lanza (nunca deja la fase sin reportar)."""
    import io
    try:
        svg = analysis_to_svg(analysis)
        png = analysis_to_png(svg)
        pm = analysis_to_midi(analysis)
        midi_buf = io.BytesIO(); pm.write(midi_buf); midi_bytes = midi_buf.getvalue()
        musicxml = analysis_to_musicxml(analysis)
        files = [
            ("score_svg", "render/sheet.svg", svg.encode("utf-8"), "image/svg+xml"),
            ("score_png", "render/sheet.png", png, "image/png"),
            ("midi", "export/score.mid", midi_bytes, "audio/midi"),
            ("musicxml", "export/score.musicxml", musicxml, "application/vnd.recordare.musicxml+xml"),
        ]
        artifacts = []
        for kind, key, data, mime in files:
            put_url = request_signed_put(sign_upload_url, inbound_secret, job_id, key)
            upload_put(put_url, data, content_type=mime)
            artifacts.append(artifact(kind, extract_storage_key(put_url), mime))
        post_webhook(webhook, job_id, "render", {"ok": True, "artifacts": artifacts})
    except Exception as exc:
        post_webhook(webhook, job_id, "render", {"ok": False, "error": str(exc)[:400]})
        raise
