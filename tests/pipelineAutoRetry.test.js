import { describe, expect, it } from 'vitest';
import {
  AUTO_MAX_RETRIES,
  RUN_AUTO_RETRY_BUDGET,
  AUTO_RETRYABLE_PHASES,
  classifyFailure,
  autoRetriesLeft,
  shouldAutoRetry,
} from '../api/_lib/pipeline/autoRetry.js';

describe('clasificador de fallos', () => {
  it('OOM (varias formas) es permanente', () => {
    expect(classifyFailure('CUDA out of memory')).toBe('permanent');
    expect(classifyFailure('el proceso murio por OOM')).toBe('permanent');
    expect(classifyFailure('Ran out of memory durante la inferencia')).toBe('permanent');
  });
  it('un 4xx de Modal es permanente', () => {
    expect(classifyFailure('Modal 422: payload invalido')).toBe('permanent');
    expect(classifyFailure('Modal 400: falta song_id')).toBe('permanent');
  });
  it('secreto o env faltante es permanente', () => {
    expect(classifyFailure('bad inbound secret')).toBe('permanent');
    expect(classifyFailure('MODAL_STEMS_ENDPOINT / MODAL_INBOUND_SECRET no configurados')).toBe(
      'permanent',
    );
    expect(classifyFailure('falta song_id en el payload')).toBe('permanent');
  });
  it('todo lo demas es transitorio, incluido el timeout de zombis', () => {
    expect(classifyFailure('La fase tardo demasiado y fue cancelada.')).toBe('transient');
    expect(classifyFailure('connection reset by peer')).toBe('transient');
    expect(classifyFailure(null)).toBe('transient');
    expect(classifyFailure(undefined)).toBe('transient');
  });
});

describe('autoRetriesLeft', () => {
  it('resta autoRetries de AUTO_MAX_RETRIES', () => {
    expect(autoRetriesLeft({ autoRetries: 0 })).toBe(AUTO_MAX_RETRIES);
    expect(autoRetriesLeft({ autoRetries: 1 })).toBe(AUTO_MAX_RETRIES - 1);
    expect(autoRetriesLeft({ autoRetries: 2 })).toBe(0);
  });
  it('sin autoRetries (fase nunca reintentada) trata como 0', () => {
    expect(autoRetriesLeft({})).toBe(AUTO_MAX_RETRIES);
  });
});

describe('shouldAutoRetry', () => {
  const base = () => ({
    phase: 'stems',
    phaseState: { retries: 0, autoRetries: 0 },
    runAutoRetries: 0,
    errorText: 'connection reset',
    timeout: false,
  });

  it('verdadero en el caso transitorio de libro', () => {
    expect(shouldAutoRetry(base())).toBe(true);
  });
  it('OOM no reintenta', () => {
    expect(shouldAutoRetry({ ...base(), errorText: 'CUDA out of memory' })).toBe(false);
  });
  it('err.timeout no reintenta aunque el texto sea transitorio', () => {
    expect(shouldAutoRetry({ ...base(), timeout: true })).toBe(false);
  });
  it('lyrics_review nunca (no es AUTO_RETRYABLE_PHASES)', () => {
    expect(shouldAutoRetry({ ...base(), phase: 'lyrics_review' })).toBe(false);
  });
  it('upload nunca (intervencion humana, no job)', () => {
    expect(shouldAutoRetry({ ...base(), phase: 'upload' })).toBe(false);
  });
  it('respeta el tope autoRetries de la fase', () => {
    expect(
      shouldAutoRetry({ ...base(), phaseState: { retries: 0, autoRetries: AUTO_MAX_RETRIES } }),
    ).toBe(false);
  });
  it('respeta el tope MANUAL retries de la fase (retries:3, autoRetries:0 => false)', () => {
    expect(shouldAutoRetry({ ...base(), phaseState: { retries: 3, autoRetries: 0 } })).toBe(false);
  });
  it('respeta el circuit breaker del run (RUN_AUTO_RETRY_BUDGET)', () => {
    expect(shouldAutoRetry({ ...base(), runAutoRetries: RUN_AUTO_RETRY_BUDGET })).toBe(false);
  });
});

describe('constantes exportadas', () => {
  it('AUTO_RETRYABLE_PHASES coincide con RETRYABLE_PHASES de retry.js menos upload/lyrics_review', () => {
    expect([...AUTO_RETRYABLE_PHASES].sort()).toEqual(
      ['clips', 'pitch', 'stems', 'structure', 'sync', 'transcription'].sort(),
    );
  });
  it('topes numericos del plan', () => {
    expect(AUTO_MAX_RETRIES).toBe(2);
    expect(RUN_AUTO_RETRY_BUDGET).toBe(4);
  });
});
