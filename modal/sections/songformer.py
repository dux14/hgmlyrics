# modal/sections/songformer.py
"""
S2 — segmentacion de estructura musical con SongFormer (ASLP-lab).

Modelo: ASLP-lab/SongFormer (HuggingFace)
  https://huggingface.co/ASLP-lab/SongFormer

Que hace:
  1. Descarga el audio de entrada desde el signed GET URL del payload.
  2. Resamplea a 24 kHz mono (requisito del modelo segun el paper y model card).
  3. Corre inferencia con SongFormer → lista de segmentos con etiqueta en ingles.
  4. Normaliza las etiquetas al mapa ES definido mas abajo.
  5. Postea el webhook `structure` con `{status, model, segments}`.
  NO sube audio (S2 es solo estructura, sin pistas de audio).

CONTRATO DE SALIDA (webhook `structure`):
  {
    "jobId": "<id>",
    "section": "structure",
    "result": {
      "status": "done",
      "model": "songformer",
      "segments": [{"label": str, "start": float, "end": float}, ...]
    },
    "error": null
  }

INFERENCIA (repo SongFormer directo — NO trust_remote_code):
  El modeling file de HuggingFace (trust_remote_code=True) NO es cargable: su
  codigo importa de forma ABSOLUTA un stack de investigacion (model, musicfm,
  x_transformers, msaf, dataset, postprocessing) que no son paquetes pip. Por eso
  corremos el infer/infer.py ORIGINAL del repo ASLP-lab/SongFormer como subproceso
  (ver _run_inference) — su entrypoint testeado, en vez de reimplementar su
  ventaneo MuQ+MusicFM. El repo + submodulos (MuQ, musicfm) + pesos se hornean en
  una imagen dedicada (songformer_image en smoke_full.py).
    infer.py -i <scp> -o <dir> --model SongFormer
             --checkpoint SongFormer.safetensors --config_path SongFormer.yaml
    → <dir>/<stem>.json = [{"label","start","end"}, ...]  (labels en ingles)

  Etiquetas (8-class): intro, verse, chorus, bridge, inst, outro, silence,
  pre-chorus → mapeadas a ES por _LABEL_MAP. infer.py carga el audio a 24 kHz
  mono por su cuenta (librosa); no hace falta pre-resamplear.

  NOTA PROD: run_songformer corre en la imagen de prod (stems_app.py), que aun
  NO incluye el stack de SongFormer. Para desplegar S2 en prod hay que darle a
  esta seccion su propia imagen/funcion Modal (pendiente). Este modulo ya tiene
  la inferencia correcta; el smoke la verifica via songformer_image.
"""

from __future__ import annotations

import os
import tempfile

# Mapa EXACTO de etiquetas ingles → espanol (segun especificacion de tarea).
# Si el modelo emite una etiqueta que no esta en el mapa, se pasa tal cual.
_LABEL_MAP: dict[str, str] = {
    "intro": "intro",
    "verse": "verso",
    "chorus": "coro",
    "bridge": "puente",
    "inst": "instrumental",         # etiqueta real del modelo (no "instrumental")
    "instrumental": "instrumental",  # por si el modelo emite la forma larga
    "outro": "outro",
    "silence": "silencio",
    "pre-chorus": "pre-coro",
    "pre_chorus": "pre-coro",        # variante con guion bajo
}

# Etiqueta de modelo que se reporta en los webhooks.
_MODEL_LABEL: str = "songformer"

# ── Rutas del repo SongFormer dentro de la imagen dedicada ───────────────────
# El repo se clona con submodulos (MuQ, musicfm) en /opt/songformer y los pesos
# (MusicFM + SongFormer.safetensors) viven en ckpts/. Todas las rutas que usa
# infer.py son RELATIVAS a _SONGFORMER_DIR, por eso se corre con cwd alli.
_SONGFORMER_DIR: str = "/opt/songformer/src/SongFormer"
_SONGFORMER_THIRD_PARTY: str = "/opt/songformer/src/third_party"
_SONGFORMER_CHECKPOINT: str = "SongFormer.safetensors"
_SONGFORMER_CONFIG: str = "SongFormer.yaml"


def _normalize_label(raw: str) -> str:
    """
    Normaliza una etiqueta del modelo al espanol segun _LABEL_MAP.
    Si la etiqueta no esta en el mapa, la devuelve sin modificar.
    """
    return _LABEL_MAP.get(raw.lower().strip(), raw)


def _run_inference(audio_path: str) -> list[dict]:
    """
    Corre la inferencia de estructura de SongFormer sobre `audio_path` invocando
    el infer/infer.py ORIGINAL del repo como subproceso (cwd=_SONGFORMER_DIR,
    PYTHONPATH con los submodulos MuQ+musicfm). Usa el codigo testeado del repo
    en lugar de reimplementar su ventaneo.

    infer.py:
      - lee un .scp con una ruta de audio por linea,
      - carga el audio a 24 kHz mono (librosa) por su cuenta,
      - escribe <out_dir>/<stem>.json con [{"label","start","end"}, ...]
        (labels en ingles: intro/verse/chorus/bridge/inst/outro/silence/pre-chorus).

    Devuelve los segmentos {label,start,end} SIN normalizar (el llamador aplica
    _normalize_label).
    """
    import json
    import subprocess
    from pathlib import Path

    out_dir = tempfile.mkdtemp()
    fd, scp_path = tempfile.mkstemp(suffix=".scp")
    with os.fdopen(fd, "w") as f:
        f.write(f"{audio_path}\n")

    env = dict(os.environ)
    # infer.py importa paquetes LOCALES del repo (dataset, postprocessing, model)
    # que viven en _SONGFORMER_DIR, ademas de los submodulos MuQ/musicfm en
    # third_party. Como el script esta en infer/infer.py, sys.path[0] es infer/
    # (no el cwd), asi que hay que poner ambos dirs en el PYTHONPATH explicito.
    env["PYTHONPATH"] = os.pathsep.join(
        p for p in (_SONGFORMER_DIR, _SONGFORMER_THIRD_PARTY, env.get("PYTHONPATH", "")) if p
    )

    proc = subprocess.run(
        [
            "python", "infer/infer.py",
            "-i", scp_path,
            "-o", out_dir,
            "--model", "SongFormer",
            "--checkpoint", _SONGFORMER_CHECKPOINT,
            "--config_path", _SONGFORMER_CONFIG,
            "-gn", "1",
            "-tn", "1",
        ],
        cwd=_SONGFORMER_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            "SongFormer infer.py fallo "
            f"(rc={proc.returncode}).\nSTDERR:\n{proc.stderr[-2000:]}\n"
            f"STDOUT:\n{proc.stdout[-1000:]}"
        )

    # infer.py escribe <out_dir>/<stem>.json (stem del path en el .scp).
    stem = Path(audio_path).stem
    out_json = os.path.join(out_dir, f"{stem}.json")
    if not os.path.isfile(out_json):
        # Fallback: cualquier .json producido (por si el stem/subdir difiere).
        found = [
            os.path.join(root, fn)
            for root, _, files in os.walk(out_dir)
            for fn in files
            if fn.endswith(".json")
        ]
        if not found:
            raise RuntimeError(
                f"SongFormer no produjo JSON en {out_dir}. "
                f"STDOUT:\n{proc.stdout[-1000:]}"
            )
        out_json = found[0]

    with open(out_json) as f:
        raw_result = json.load(f)

    segments = []
    for seg in raw_result:
        label = seg.get("label", "")
        start = float(seg.get("start", 0.0))
        end = float(seg.get("end", start))
        segments.append({"label": label, "start": start, "end": end})
    return segments


def run_songformer(payload: dict) -> None:
    """
    Nodo S2: descarga el audio de entrada, corre SongFormer para obtener
    la estructura musical, normaliza las etiquetas a espanol y postea el
    webhook de la seccion `structure`.

    En caso de excepcion posta un webhook `failed` para structure y propaga
    la excepcion (Modal lo registrara como fallo de la funcion).

    Args:
        payload: dict con claves:
          - jobId: str
          - input.getUrl: str  (signed GET URL del audio original)
          - webhook: {url, secret}
          (NO se necesitan `uploads` — S2 no sube audio)
    """
    # Import de httpx aqui para evitar import-time fuera del contenedor Modal
    # (mismo patron que extract.py y _common.py).
    import httpx  # noqa: F401 — disponible en la imagen

    from sections._common import post_webhook

    job_id: str = payload["jobId"]
    get_url: str = payload["input"]["getUrl"]
    webhook: dict = payload["webhook"]

    try:
        # ── 1. Descargar audio de entrada ────────────────────────────────────
        fd, src_path = tempfile.mkstemp(suffix=".audio")
        os.close(fd)
        with httpx.stream("GET", get_url, timeout=120, follow_redirects=True) as r:
            r.raise_for_status()
            with open(src_path, "wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)

        # ── 2. Inferencia SongFormer (infer.py carga el audio a 24 kHz solo) ─
        raw_segments = _run_inference(src_path)

        # ── 4. Normalizar etiquetas a espanol ────────────────────────────────
        segments = [
            {
                "label": _normalize_label(seg["label"]),
                "start": seg["start"],
                "end": seg["end"],
            }
            for seg in raw_segments
        ]

        # ── 5. Webhook de exito ──────────────────────────────────────────────
        post_webhook(
            webhook,
            job_id,
            section="structure",
            result={
                "status": "done",
                "model": _MODEL_LABEL,
                "segments": segments,
            },
        )

    except Exception as exc:
        # Postear fallo antes de propagar para que el front no quede esperando.
        try:
            post_webhook(
                webhook,
                job_id,
                section="structure",
                result={
                    "status": "failed",
                    "model": _MODEL_LABEL,
                    "segments": [],
                },
                error=str(exc)[:400],
            )
        except Exception:
            pass  # si el webhook en si falla, no enmascarar el error original
        raise
