"""core.py — logica PURA (sin I/O/GPU). Los nodos Modal le pasan arrays ya
calculados; nunca toca disco ni red. Testeable con pytest+numpy solos."""
from __future__ import annotations
import math

import numpy as np

NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
NOTE_NAMES = NOTE_NAMES_SHARP  # alias de compatibilidad (no romper referencias existentes)


def hz_to_midi(hz: float) -> float:
    """Hz -> MIDI fraccional. <=0/NaN -> nan (silencio)."""
    if hz is None or hz <= 0 or math.isnan(hz):
        return float('nan')
    return 69.0 + 12.0 * math.log2(hz / 440.0)


def midi_to_name(midi: float, use_flats: bool = False) -> str:
    """MIDI redondeado -> nombre cientifico, p.ej. 60 -> 'C4'. use_flats=True
    escribe con bemoles (Db, Eb, Gb, Ab, Bb) en vez de sostenidos."""
    m = round(midi)
    names = NOTE_NAMES_FLAT if use_flats else NOTE_NAMES_SHARP
    return f"{names[m % 12]}{m // 12 - 1}"


# Perfiles Krumhansl-Schmuckler (pesos por grado desde la tonica).
_KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
_KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
# Tonicas MAYORES cuya armadura se escribe con bemoles (Db,Eb,F,Gb,Ab,Bb).
_FLAT_TONICS = {1, 3, 5, 6, 8, 10}


def _pearson(a, b) -> float:
    a = a - a.mean(); b = b - b.mean()
    denom = float(np.sqrt((a * a).sum() * (b * b).sum()))
    return float((a * b).sum() / denom) if denom > 0 else 0.0


def detect_key(pc_weights) -> "tuple[int, str]":
    """pc_weights: 12 pesos por pitch-class (0=C..11=B). Devuelve (tonic_pc, mode)
    con mode in {'major','minor'} por Krumhansl-Schmuckler (correlacion de Pearson
    del histograma rotado contra cada perfil). Sin datos -> (0,'major')."""
    h = np.asarray(pc_weights, dtype=float)
    if h.sum() <= 0:
        return (0, "major")
    best = None  # (r, tonic, mode)
    for tonic in range(12):
        rotated = np.roll(h, -tonic)  # rotated[0] = peso de la tonica
        for mode, profile in (("major", _KS_MAJOR), ("minor", _KS_MINOR)):
            r = _pearson(rotated, np.asarray(profile, dtype=float))
            if best is None or r > best[0]:
                best = (r, tonic, mode)
    return (best[1], best[2])


def key_uses_flats(tonic_pc: int, mode: str) -> bool:
    """True si la armadura de la tonalidad se escribe con bemoles. Para menores usa
    el relativo mayor (tonica + 3 semitonos)."""
    pc = (tonic_pc + 3) % 12 if mode == "minor" else tonic_pc % 12
    return pc in _FLAT_TONICS


def _moving_median_ignore_nan(values: np.ndarray, win: int) -> np.ndarray:
    """Mediana movil centrada en `win`, ignorando NaN (frames no-voiced)."""
    n = len(values)
    half = win // 2
    out = np.full(n, np.nan)
    for i in range(n):
        lo, hi = max(0, i - half), min(n, i + half + 1)
        window = values[lo:hi]
        window = window[~np.isnan(window)]
        if len(window) > 0:
            out[i] = np.median(window)
    return out


def note_events_from_f0(times, f0, conf, *, conf_threshold=0.5, min_note_sec=0.08, smooth_win=5,
                         use_flats=False):
    """Convierte un contorno F0 (frecuencia por frame) en eventos de nota discretos.

    1. voiced = (conf>=conf_threshold) & (f0>0); frames no-voiced = sordos, nunca
       generan evento (hueco).
    2. midi_frac[voiced] = hz_to_midi(f0[voiced]) vectorizado.
    3. smoothed = mediana movil de midi_frac sobre voiced en ventana smooth_win
       (ignora NaN/no-voiced) — amortigua jitter frame-a-frame.
    4. midi_round = round(smoothed); un evento = run contiguo de frames voiced con
       el mismo midi_round. start/end = times del primer/ultimo+1 frame del run.
       cents = round(mean(smoothed_run - midi_round)*100).
    5. Post-proceso: eventos con (end-start) < min_note_sec se fusionan con el
       vecino (prev o next) de MAYOR duracion, iterando hasta que no queden cortos
       (jitter de 1-2 frames a otra nota).
    6. note = midi_to_name(midi) por evento.

    Devuelve lista de dicts [{"start","end","midi","note","cents"}] ordenados por
    start; lista vacia si no hay frames voiced.
    """
    times = np.asarray(times, dtype=float)
    f0 = np.asarray(f0, dtype=float)
    conf = np.asarray(conf, dtype=float)
    n = len(times)

    voiced = (conf >= conf_threshold) & (f0 > 0)
    if not np.any(voiced):
        return []

    midi_frac = np.full(n, np.nan)
    midi_frac[voiced] = 69.0 + 12.0 * np.log2(f0[voiced] / 440.0)

    smoothed = _moving_median_ignore_nan(midi_frac, smooth_win)

    midi_round = np.full(n, np.nan)
    midi_round[voiced] = np.round(smoothed[voiced])

    # frame_dur para estimar end del ultimo frame de cada run
    frame_dur = (times[-1] - times[0]) / (n - 1) if n > 1 else 0.0

    # construir runs contiguos de frames voiced con el mismo midi_round
    events = []
    i = 0
    while i < n:
        if not voiced[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and voiced[j + 1] and midi_round[j + 1] == midi_round[i]:
            j += 1
        start = times[i]
        end = times[j] + frame_dur if j + 1 < n else times[j] + frame_dur
        run_smoothed = smoothed[i:j + 1]
        midi = midi_round[i]
        cents = round(float(np.mean(run_smoothed - midi)) * 100)
        events.append({
            "start": float(start),
            "end": float(end),
            "midi": float(midi),
            "cents": int(cents),
            "_dur": float(end - start),
        })
        i = j + 1

    # fusionar eventos cortos (< min_note_sec) con el vecino de mayor duracion
    changed = True
    while changed and len(events) > 1:
        changed = False
        for idx, ev in enumerate(events):
            if ev["_dur"] >= min_note_sec:
                continue
            prev_ev = events[idx - 1] if idx > 0 else None
            next_ev = events[idx + 1] if idx + 1 < len(events) else None
            if prev_ev is None and next_ev is None:
                break
            if prev_ev is None:
                target = next_ev
            elif next_ev is None:
                target = prev_ev
            else:
                target = prev_ev if prev_ev["_dur"] >= next_ev["_dur"] else next_ev
            # fusionar ev dentro de target: extiende el rango temporal del target
            target["start"] = min(target["start"], ev["start"])
            target["end"] = max(target["end"], ev["end"])
            target["_dur"] = target["end"] - target["start"]
            events.remove(ev)
            changed = True
            break

    result = []
    for ev in events:
        result.append({
            "start": ev["start"],
            "end": ev["end"],
            "midi": ev["midi"],
            "note": midi_to_name(ev["midi"], use_flats),
            "cents": ev["cents"],
        })
    return result


def fuse_syllables_notes(syllables, note_events, use_flats=False):
    """
    syllables: [{"text","start","end"}] en orden temporal (in-place: añade
    note/midi/cents/ditto/blank y devuelve la misma lista). Algoritmo: por
    sílaba, calcular el solapamiento temporal
    [min(end,ev.end)-max(start,ev.start)] con cada note_event y quedarse con el
    de mayor solapamiento. Si el máximo solapamiento es < 30% de la duración de
    la sílaba (o no hay note_events), blank=True, note=midi=cents=None. Si no, y
    su midi == midi de la ÚLTIMA sílaba no-blank ya etiquetada, ditto=True y
    note=None (conserva midi/cents para que el front dibuje '"' pero el afinador
    siga sabiendo la nota); si no, ditto=False y note=midi_to_name(midi).
    Actualizar el "último midi etiquetado" solo tras procesar cada sílaba
    no-blank.
    """
    last_midi = None
    for syl in syllables:
        dur = syl["end"] - syl["start"]
        best_ev = None
        best_overlap = 0.0
        for ev in note_events:
            overlap = min(syl["end"], ev["end"]) - max(syl["start"], ev["start"])
            if overlap > best_overlap:
                best_overlap = overlap
                best_ev = ev

        if best_ev is None or (dur > 0 and best_overlap < 0.3 * dur):
            syl["blank"] = True
            syl["note"] = None
            syl["midi"] = None
            syl["cents"] = None
            continue

        syl["blank"] = False
        syl["midi"] = best_ev["midi"]
        syl["cents"] = best_ev["cents"]
        if best_ev["midi"] == last_midi:
            syl["ditto"] = True
            syl["note"] = None
        else:
            syl["ditto"] = False
            syl["note"] = midi_to_name(best_ev["midi"], use_flats)
        last_midi = best_ev["midi"]

    return syllables


def detect_modulations(note_events, *, window_sec=4.0, threshold_semitones=3, use_flats=False):
    """
    Heurística "mejor esfuerzo" (no detección armónica real): partir la línea de
    tiempo en ventanas de window_sec desde note_events[0].start; el "centro
    tonal" de cada ventana = mediana de los midis de los eventos que EMPIEZAN en
    ella (ventanas sin eventos se omiten). Si el centro de una ventana difiere
    del de la ventana anterior en >= threshold_semitones, emitir {"time": inicio
    de la ventana actual, "from": midi_to_name(centro prev), "to":
    midi_to_name(centro actual), "semitones": actual-prev}. Lista vacía si
    note_events está vacío o no hay saltos.
    """
    if not note_events:
        return []

    origin = note_events[0]["start"]
    windows = {}
    for ev in note_events:
        idx = int((ev["start"] - origin) // window_sec)
        windows.setdefault(idx, []).append(ev["midi"])

    mods = []
    prev_center = None
    for idx in sorted(windows):
        center = float(np.median(windows[idx]))
        if prev_center is not None and abs(center - prev_center) >= threshold_semitones:
            semitones = round(center - prev_center)
            mods.append({
                "time": origin + idx * window_sec,
                "from": midi_to_name(prev_center, use_flats),
                "to": midi_to_name(center, use_flats),
                "semitones": semitones,
            })
        prev_center = center

    return mods


# ── M5: ensamblado de voces sin letra (genero/coro) ─────────────────────────
# Orden canonico para voices_present: fijo, no depende del orden de llegada de
# los webhooks (gender y choir corren en paralelo).
_VOICE_ORDER = ["lead", "backing", "male", "female", "choir"]

def build_voice_entry(notes: list, use_flats: bool = False) -> dict:
    """Entry de `voices` sin letra (genero/coro): lista plana de eventos de nota
    (dicts); el solape temporal entre eventos codifica polifonia, no es un error."""
    return {"notes": [
        {
            "start": n["start"], "end": n["end"], "midi": n["midi"],
            "note": (midi_to_name(n["midi"], use_flats) if n.get("midi") is not None else n.get("note")),
            "cents": n["cents"],
        }
        for n in notes
    ]}

def merge_voices_present(base: list, extra: list) -> list:
    """Dedupe + orden canonico (`base` ya trae lead/backing)."""
    present = set(base) | set(extra)
    return [v for v in _VOICE_ORDER if v in present]
