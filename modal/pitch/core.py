"""core.py — logica PURA (sin I/O/GPU). Los nodos Modal le pasan arrays ya
calculados; nunca toca disco ni red. Testeable con pytest+numpy solos."""
from __future__ import annotations
import math

import numpy as np

NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def hz_to_midi(hz: float) -> float:
    """Hz -> MIDI fraccional. <=0/NaN -> nan (silencio)."""
    if hz is None or hz <= 0 or math.isnan(hz):
        return float('nan')
    return 69.0 + 12.0 * math.log2(hz / 440.0)


def midi_to_name(midi: float) -> str:
    """MIDI redondeado -> nombre cientifico, p.ej. 60 -> 'C4'."""
    m = round(midi)
    return f"{NOTE_NAMES[m % 12]}{m // 12 - 1}"


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


def note_events_from_f0(times, f0, conf, *, conf_threshold=0.5, min_note_sec=0.08, smooth_win=5):
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
            "note": midi_to_name(ev["midi"]),
            "cents": ev["cents"],
        })
    return result


def fuse_syllables_notes(syllables, note_events):
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
            syl["note"] = midi_to_name(best_ev["midi"])
        last_midi = best_ev["midi"]

    return syllables


def detect_modulations(note_events, *, window_sec=4.0, threshold_semitones=3):
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
                "from": midi_to_name(prev_center),
                "to": midi_to_name(center),
                "semitones": semitones,
            })
        prev_center = center

    return mods
