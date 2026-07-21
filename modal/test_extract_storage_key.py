"""extract_storage_key debe ser bucket-agnóstico: el helper lo comparten el
Estudio legacy (bucket 'stems-jobs') y el pipeline unificado por canción
(bucket 'song-audio', vía createSongAudioSignedPutUrl). La key es relativa al
bucket, así que se devuelve sin el prefijo del bucket en ambos casos."""
import pytest

from sections._common import extract_storage_key

BASE = "https://omntufksfhezqtqgmhlp.supabase.co/storage/v1/object/upload/sign"


def test_bucket_stems_jobs_legacy():
    url = f"{BASE}/stems-jobs/user123/job456/voiceInstrumental/vocals.mp3?token=abc"
    assert extract_storage_key(url) == "user123/job456/voiceInstrumental/vocals.mp3"


def test_bucket_song_audio_pipeline_unificado():
    # Regresión del smoke B8: el pipeline unificado firma PUT en 'song-audio'.
    url = f"{BASE}/song-audio/songid/runs/runid/leadBacking/vocals.mp3?token=xyz"
    assert extract_storage_key(url) == "songid/runs/runid/leadBacking/vocals.mp3"


def test_url_sin_marker_falla():
    with pytest.raises(ValueError):
        extract_storage_key("https://example.com/no/es/supabase?token=x")


def test_url_bucket_sin_key_falla():
    with pytest.raises(ValueError):
        extract_storage_key(f"{BASE}/song-audio?token=x")
