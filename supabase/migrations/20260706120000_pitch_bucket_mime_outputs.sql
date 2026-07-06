-- Partitura vocal: el pipeline (Modal) sube artefactos NO-audio al bucket pitch-jobs
-- vía signed PUT: analysis.json (application/json), partitura SVG (image/svg+xml),
-- PNG (image/png), MIDI (audio/midi) y MusicXML (application/vnd.recordare.musicxml+xml).
-- La restriccion audio-only original (migracion 20260705120000) rechazaba esos outputs,
-- rompiendo las fases fusion/render al subir. Se libera allowed_mime_types.
--
-- Seguridad conservada por otras capas: bucket privado + endpoint sign-upload
-- (valida x-inbound-secret timing-safe + prefijo ${user_id}/${job_id}/ + estado running)
-- + file_size_limit de 25MB. El input de audio ya se valida en el front y en createJob.
UPDATE storage.buckets
  SET allowed_mime_types = NULL
  WHERE id = 'pitch-jobs';
