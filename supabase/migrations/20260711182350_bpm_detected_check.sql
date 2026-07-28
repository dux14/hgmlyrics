-- Simetría con el CHECK de bpm_manual: un glitch de detección no debe persistir un BPM absurdo.
ALTER TABLE song_line_timings
  ADD CONSTRAINT song_line_timings_bpm_detected_check
  CHECK (bpm_detected IS NULL OR (bpm_detected > 0 AND bpm_detected < 400));
