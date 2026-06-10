#!/usr/bin/env python3
"""
Curación de un subset mínimo del Universal LPC Spritesheet Character Generator
para el mundo virtual de hgmlyrics (M4.2).

- Extrae solo los walk.png necesarios (576x256 = 9 frames x 4 dir @ 64x64).
- Produce public/world/lpc/<...> + manifest.json + public/world/CREDITS.txt.
- La atribución por-archivo se deriva de CREDITS.csv (repo LPC) por prefijo de dir.

Fuente: https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator
Licencias del subset: OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 (ver CREDITS.txt).
"""
import csv
import io
import json
import os
import struct
import subprocess
import sys

LPC = "/tmp/lpc"
DEST = sys.argv[1] if len(sys.argv) > 1 else "public/world"
LPC_DEST = os.path.join(DEST, "lpc")

BODY_TYPES = ["male", "female"]
BODY_LABEL = {"male": "Masculino", "female": "Femenino"}

# Cada entrada: layer -> opciones. Cada opción mapea bodyType -> path fuente en el repo.
# La fuente female de pants vive en legs/pants/thin/, no en female/.
COLOR_LABEL = {
    "black": "Negro", "blue": "Azul", "brown": "Marron",
    "gray": "Gris", "green": "Verde", "red": "Rojo",
}
PANTS_COLORS = list(COLOR_LABEL.keys())

LAYERS = [
    {
        "key": "body", "name": "Cuerpo", "zPos": 10, "required": True,
        "options": [
            {"id": "base", "name": "Base", "src": {
                "male": "spritesheets/body/bodies/male/walk.png",
                "female": "spritesheets/body/bodies/female/walk.png",
            }},
        ],
    },
    {
        "key": "legs", "name": "Pantalon", "zPos": 20, "required": False,
        "options": [
            {"id": c, "name": COLOR_LABEL[c], "src": {
                "male": f"spritesheets/legs/pants/male/walk/{c}.png",
                "female": f"spritesheets/legs/pants/thin/walk/{c}.png",
            }} for c in PANTS_COLORS
        ],
    },
    {
        "key": "torso", "name": "Camiseta", "zPos": 35, "required": False,
        "options": [
            {"id": "shortsleeve", "name": "Manga corta", "src": {
                "male": "spritesheets/torso/clothes/shortsleeve/shortsleeve/male/walk.png",
                "female": "spritesheets/torso/clothes/shortsleeve/shortsleeve/female/walk.png",
            }},
            {"id": "longsleeve", "name": "Manga larga", "src": {
                "male": "spritesheets/torso/clothes/longsleeve/longsleeve/male/walk.png",
                "female": "spritesheets/torso/clothes/longsleeve/longsleeve/female/walk.png",
            }},
        ],
    },
    {
        "key": "hair", "name": "Pelo", "zPos": 120, "required": False,
        # El sheet adult es compartido por ambos sexos (misma fuente).
        "options": [
            {"id": s, "name": label, "shared": f"spritesheets/hair/{s}/adult/walk.png"}
            for s, label in [
                ("plain", "Liso"), ("long", "Largo"), ("bob", "Bob"),
                ("curly_long", "Rizado"), ("messy1", "Despeinado"),
            ]
        ],
    },
]

EXPECTED = (576, 256)


def git_show(path):
    r = subprocess.run(["git", "show", f"HEAD:{path}"], cwd=LPC,
                       capture_output=True)
    if r.returncode != 0:
        return None
    return r.stdout


def png_dim(data):
    # IHDR width/height están en los bytes 16..24
    return struct.unpack(">II", data[16:24])


def write_png(rel_src, dest_path):
    data = git_show(rel_src)
    if data is None:
        raise SystemExit(f"FALTA en repo: {rel_src}")
    dim = png_dim(data)
    if dim != EXPECTED:
        raise SystemExit(f"DIM {dim} != {EXPECTED}: {rel_src}")
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    with open(dest_path, "wb") as f:
        f.write(data)
    return rel_src


used_sources = set()
manifest_layers = []

for layer in sorted(LAYERS, key=lambda l: l["zPos"]):
    m_opts = []
    for opt in layer["options"]:
        files = {}
        if "shared" in opt:
            rel = f"lpc/hair/{opt['id']}.png"
            write_png(opt["shared"], os.path.join(DEST, rel))
            used_sources.add(opt["shared"])
            for bt in BODY_TYPES:
                files[bt] = rel
        else:
            for bt in BODY_TYPES:
                rel = f"lpc/{layer['key']}/{opt['id']}/{bt}.png"
                write_png(opt["src"][bt], os.path.join(DEST, rel))
                used_sources.add(opt["src"][bt])
                files[bt] = rel
        m_opts.append({"id": opt["id"], "name": opt["name"], "files": files})
    manifest_layers.append({
        "key": layer["key"], "name": layer["name"], "zPos": layer["zPos"],
        "required": layer["required"], "options": m_opts,
    })

manifest = {
    "version": 1,
    "frame": {"w": 64, "h": 64, "cols": 9, "rows": 4},
    "rowDir": ["up", "left", "down", "right"],
    "bodyTypes": [{"id": bt, "name": BODY_LABEL[bt]} for bt in BODY_TYPES],
    "layers": manifest_layers,
}
os.makedirs(LPC_DEST, exist_ok=True)
with open(os.path.join(LPC_DEST, "manifest.json"), "w") as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)

# ---- CREDITS.txt desde CREDITS.csv (match por prefijo de directorio) ----
rows = list(csv.DictReader(io.StringIO(git_show("CREDITS.csv").decode("utf-8"))))


def credit_for(src_repo_path):
    # src_repo_path: "spritesheets/.../walk.png" -> sin prefijo "spritesheets/"
    p = src_repo_path[len("spritesheets/"):]
    pdir = os.path.dirname(p)
    best = None
    best_len = -1
    for row in rows:
        fn = row["filename"].strip().strip('"')
        fdir = os.path.dirname(fn)
        # match: el directorio de credit es prefijo del directorio del asset
        if pdir == fdir or pdir.startswith(fdir + "/") or fdir.startswith(pdir):
            common = os.path.commonprefix([pdir, fdir])
            if len(common) > best_len:
                best_len = len(common)
                best = row
    return best


authors = set()
licenses = set()
urls = set()
detail_lines = []
for src in sorted(used_sources):
    row = credit_for(src)
    asset = src[len("spritesheets/"):]
    if not row:
        detail_lines.append(f"- {asset}: (sin fila en CREDITS.csv)")
        continue
    a = [x.strip() for x in row["authors"].strip().strip('"').split(",") if x.strip()]
    lic = [x.strip() for x in row["licenses"].strip().strip('"').split(",") if x.strip()]
    us = [x.strip() for x in row["urls"].strip().strip('"').split(",") if x.strip()]
    authors.update(a)
    licenses.update(lic)
    urls.update(us)
    detail_lines.append(f"- {asset}\n    autores: {', '.join(a)}\n    licencias: {', '.join(lic)}")

header = """CREDITOS — Assets LPC (mundo virtual)
=====================================

Los sprites de avatar del mundo virtual son un subset curado del
Universal LPC Spritesheet Character Generator:
  https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator

LPC es multi-licencia. Los assets aqui usados se distribuyen bajo una
combinacion de: OGA-BY 3.0, CC-BY-SA 3.0 y GPL 3.0. Los spritesheets
compuestos (artwork derivado) heredan estas obligaciones (atribucion +
copyleft sobre las IMAGENES). El codigo de la aplicacion NO queda afectado.

Licencias presentes en este subset:
  {licenses}

Autores (atribucion agregada):
  {authors}

Fuentes (OpenGameArt / repos):
{urls}

Detalle por asset usado:
{detail}
""".format(
    licenses="\n  ".join(sorted(licenses)),
    authors=", ".join(sorted(authors)),
    urls="\n".join("  " + u for u in sorted(urls)),
    detail="\n".join(detail_lines),
)
with open(os.path.join(DEST, "CREDITS.txt"), "w") as f:
    f.write(header)

print(f"OK: {len(used_sources)} PNGs, {len(manifest_layers)} layers, "
      f"{len(authors)} autores, {len(licenses)} licencias")
print("manifest:", os.path.join(LPC_DEST, "manifest.json"))
