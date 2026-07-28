-- Beats detectados: viven con el ciclo del alignment (se resetean al reprocesar).
ALTER TABLE song_line_timings
  ADD COLUMN bpm_detected NUMERIC,
  ADD COLUMN beats JSONB;

-- Overrides manuales del admin: sobreviven al reprocesado.
ALTER TABLE song_audio
  ADD COLUMN bpm_manual NUMERIC CHECK (bpm_manual IS NULL OR (bpm_manual > 0 AND bpm_manual < 400)),
  ADD COLUMN time_signature TEXT CHECK (time_signature IS NULL OR time_signature IN ('4/4','3/4','6/8','2/4')),
  ADD COLUMN beat_anchor SMALLINT CHECK (beat_anchor IS NULL OR (beat_anchor BETWEEN 1 AND 12));
