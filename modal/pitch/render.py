from _common import post_webhook


def run_render(job_id, webhook, analysis):
    """M1: fase minima, NO genera SVG/PNG/MIDI/MusicXML (eso es M2). Postea
    'render' con {"ok": True, "artifacts": []} para que el job llegue a
    'succeeded' con las 6 fases reportadas. Nunca debe ser el motivo de que el
    job quede en 'partial' en M1. `analysis` se recibe para M2 (aqui no se usa)."""
    post_webhook(webhook, job_id, "render", {"ok": True, "artifacts": []})
