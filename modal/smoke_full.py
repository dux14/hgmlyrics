# modal/smoke_full.py
"""
Smoke FULL de las 4 secciones del Estudio — corre el MISMO código desplegado
(S1 extract_all_stems, S2 SongFormer, S3 MedleyVox, S4 chorus_bs_roformer) sobre
un mp3 arbitrario de Samu y baja TODAS las salidas a disco local, renombradas
por sección (S1 - N, S2, S3 - N, S4 - N) para escucha crítica.

NO toca producción: es una app efímera (`modal run`), distinta de `hkn-stems`.
Reusa la imagen y los helpers reales, así que la separación es idéntica a la de
prod. La imagen comparte hash con el orquestador → capas cacheadas.

Optimización del smoke: S3 y S4 reciben el vocal ep_317 que YA produjo S1 (mismo
modelo, misma entrada → vocal idéntico al que re-extraen en prod), evitando 2
re-extracciones BS-RoFormer. El audio que Samu escucha es el mismo.

Uso:
  cd modal && python3 -m modal run smoke_full.py --mp3 /ruta/al/audio.mp3
"""

from __future__ import annotations

import os

import modal

# Misma definición de imagen que stems_app.py (mismo hash → reusa cache).
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git")
    .pip_install_from_requirements("requirements.txt")
    .run_commands(
        "git clone --depth=1 https://github.com/SUC-DriverOld/MedleyVox-Inference-WebUI "
        "/opt/medleyvox-webui",
        "pip install pyloudnorm",
    )
    .env({"PYTHONPATH": "/opt/medleyvox-webui"})
    .add_local_python_source("sections")
)

app = modal.App("hkn-stems-full-smoke")

_OUT_DIR = "/Users/samu/code/personal/Mark-N-Hkl/estudio-escucha/full"

# Orden de las 7 pistas de S1 tal como se numeran en disco (S1 - 1 .. S1 - 7).
_S1_ORDER = ["vocals", "instrumental", "drums", "bass", "guitar", "piano", "other"]
# Orden de S3 (S3 - 1 lead, S3 - 2 backing) y S4 (S4 - 1 male, S4 - 2 female).
_S3_ORDER = ["lead", "backing"]
_S4_ORDER = ["male", "female"]


@app.function(image=image, gpu="T4", timeout=3600)
def smoke_full(name: str, original_bytes: bytes) -> dict:
    """
    Corre las 4 secciones sobre el audio original y devuelve, como bytes, todas
    las pistas de S1/S3/S4 + los segmentos de estructura de S2 + las RMS de S3.

    Devuelve dict:
      {
        "name": str,
        "s1": {track: bytes, ...},          # 7 pistas
        "s2_segments": [{label,start,end}],  # estructura
        "s3": {"lead": bytes, "backing": bytes},
        "s3_rms": {"lead": float, "backing": float},
        "s4": {"male": bytes, "female": bytes},
      }
    """
    import tempfile

    # Helpers REALES del pipeline desplegado.
    from sections.extract import extract_all_stems
    from sections.songformer import (
        _run_inference,
        _normalize_label,
    )
    from sections.medley_vox import separate_lead_backing
    from sections.gender import (
        separate_by_gender,
        _CHORUS_MODEL_CKPT,
        _AUFR33_MODEL_CKPT,
    )

    fd, src = tempfile.mkstemp(suffix=".mp3")
    os.close(fd)
    with open(src, "wb") as f:
        f.write(original_bytes)

    # ── S1: ep_317 (vocals/instrumental) + demucs 6s (7 pistas) ──────────────
    print(f"[{name}] S1 — extract_all_stems…")
    s1_stems = extract_all_stems(src)
    s1_bytes: dict[str, bytes] = {}
    for track in _S1_ORDER:
        with open(s1_stems[track], "rb") as f:
            s1_bytes[track] = f.read()
    vocals_path = s1_stems["vocals"]  # reusado por S3 y S4

    # ── S2: SongFormer (estructura) ──────────────────────────────────────────
    # S2 NO es fatal para el smoke: si SongFormer falla (p.ej. deps de
    # trust_remote_code faltantes en la imagen), igual entregamos S1/S3/S4.
    print(f"[{name}] S2 — SongFormer…")
    s2_segments: list[dict] = []
    s2_error: str | None = None
    try:
        # SongFormer carga y resamplea a 24 kHz mono por su cuenta (librosa);
        # se le pasa el mp3 original directamente.
        raw_segments = _run_inference(src)
        s2_segments = [
            {
                "label": _normalize_label(seg["label"]),
                "start": seg["start"],
                "end": seg["end"],
            }
            for seg in raw_segments
        ]
    except Exception as exc:  # noqa: BLE001 — reportar, no abortar el smoke
        s2_error = f"{type(exc).__name__}: {exc}"
        print(f"[{name}] S2 FALLÓ (no fatal): {s2_error}")

    # ── S3: MedleyVox (lead/backing) sobre el vocal de S1 ────────────────────
    print(f"[{name}] S3 — MedleyVox…")
    sep3 = separate_lead_backing(vocals_path)
    with open(sep3["lead_mp3"], "rb") as f:
        s3_lead = f.read()
    with open(sep3["backing_mp3"], "rb") as f:
        s3_backing = f.read()

    # ── S4: A/B de género sobre el vocal de S1 — 2 modelos ───────────────────
    # A = chorus_bs_roformer (Sucial, default actual); B = aufr33 (alternativa).
    # Mismo vocal ep_317 para ambos → comparación limpia modelo-vs-modelo.
    s4: dict[str, dict] = {}
    s4_errors: dict[str, str] = {}
    for tag, ckpt in (("chorus", _CHORUS_MODEL_CKPT), ("aufr33", _AUFR33_MODEL_CKPT)):
        print(f"[{name}] S4 — {tag} ({ckpt})…")
        try:
            st = separate_by_gender(vocals_path, model_ckpt=ckpt)
            with open(st["male"], "rb") as f:
                male = f.read()
            with open(st["female"], "rb") as f:
                female = f.read()
            s4[tag] = {"male": male, "female": female}
        except Exception as exc:  # noqa: BLE001 — un modelo no debe matar el otro
            s4_errors[tag] = f"{type(exc).__name__}: {exc}"
            print(f"[{name}] S4 {tag} FALLÓ (no fatal): {s4_errors[tag]}")

    return {
        "name": name,
        "s1": s1_bytes,
        "s2_segments": s2_segments,
        "s2_error": s2_error,
        "s3": {"lead": s3_lead, "backing": s3_backing},
        "s3_rms": {"lead": sep3["rms_lead"], "backing": sep3["rms_backing"]},
        "s4": s4,
        "s4_errors": s4_errors,
    }


@app.local_entrypoint()
def main(mp3: str = "/Users/samu/Downloads/huracan.mp3"):
    import json

    name = os.path.splitext(os.path.basename(mp3))[0]
    with open(mp3, "rb") as f:
        original = f.read()

    print(f"Despachando smoke full de «{name}» ({len(original)/1e6:.1f} MB)…")
    res = smoke_full.remote(name, original)

    song_dir = f"{_OUT_DIR}/{name}"
    os.makedirs(song_dir, exist_ok=True)

    manifest: dict[str, str] = {}

    # ── S1: 7 pistas renombradas S1 - N ──────────────────────────────────────
    for i, track in enumerate(_S1_ORDER, start=1):
        fname = f"S1 - {i} {track}.mp3"
        with open(f"{song_dir}/{fname}", "wb") as f:
            f.write(res["s1"][track])
        manifest[fname] = f"S1 voz/instrumentos — {track}"

    # ── S2: estructura (json + txt legible) ──────────────────────────────────
    seg = res["s2_segments"]
    s2_error = res.get("s2_error")
    with open(f"{song_dir}/S2 - estructura.json", "w") as f:
        json.dump(seg, f, ensure_ascii=False, indent=2)
    if s2_error:
        with open(f"{song_dir}/S2 - estructura.txt", "w") as f:
            f.write(f"S2 SongFormer FALLO (sin estructura):\n  {s2_error}\n")
        manifest["S2 - estructura.txt"] = f"S2 estructura — FALLO: {s2_error[:60]}"
    else:
        lines = [
            f"{i:>2}. {s['label']:<12} {s['start']:>7.2f}s → {s['end']:>7.2f}s"
            for i, s in enumerate(seg, start=1)
        ]
        with open(f"{song_dir}/S2 - estructura.txt", "w") as f:
            f.write("\n".join(lines) + "\n")
        manifest["S2 - estructura.json/.txt"] = f"S2 estructura — {len(seg)} segmentos"

    # ── S3: lead / backing renombrados S3 - N ────────────────────────────────
    for i, track in enumerate(_S3_ORDER, start=1):
        es = "lider" if track == "lead" else "coros"
        fname = f"S3 - {i} {es}.mp3"
        with open(f"{song_dir}/{fname}", "wb") as f:
            f.write(res["s3"][track])
        rms = res["s3_rms"][track]
        manifest[fname] = f"S3 lider/coros — {es} (RMS {rms:.4f})"

    # ── S4: A/B de género (2 modelos) renombrados S4 - N ─────────────────────
    # chorus = S4 - 1/2, aufr33 = S4 - 3/4. Mismo vocal ep_317 para ambos.
    s4 = res["s4"]
    s4_errors = res.get("s4_errors", {})
    i = 1
    for tag in ("chorus", "aufr33"):
        modelo = "chorus_bs_roformer" if tag == "chorus" else "aufr33"
        if tag not in s4:
            err = s4_errors.get(tag, "sin salida")
            manifest[f"S4 ({modelo})"] = f"S4 genero {modelo} — FALLO: {err[:60]}"
            i += 2
            continue
        for track in _S4_ORDER:
            es = "masculina" if track == "male" else "femenina"
            fname = f"S4 - {i} voz {es} ({modelo}).mp3"
            with open(f"{song_dir}/{fname}", "wb") as f:
                f.write(s4[tag][track])
            manifest[fname] = f"S4 genero [{modelo}] — voz {es}"
            i += 1

    # ── Manifiesto legible ───────────────────────────────────────────────────
    with open(f"{song_dir}/MANIFIESTO.txt", "w") as f:
        f.write(f"Smoke full — «{name}»\n\n")
        for k, v in manifest.items():
            f.write(f"  {k:<28}  {v}\n")
        f.write(
            f"\nS3 RMS: lead={res['s3_rms']['lead']:.4f} "
            f"backing={res['s3_rms']['backing']:.4f} "
            f"(heuristica: lead = mayor RMS)\n"
        )

    print("OK — escrito a", song_dir)
    print("  S1:", len(_S1_ORDER), "pistas | S2:", len(seg), "segmentos |",
          "S3: lead/backing | S4: male/female")
    print(
        f"  S3 RMS lead={res['s3_rms']['lead']:.4f} "
        f"backing={res['s3_rms']['backing']:.4f}"
    )
