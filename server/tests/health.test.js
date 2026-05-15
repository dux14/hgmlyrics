const request = require('supertest');
const { app } = require('../index');
const { resetDb } = require('./helpers');

beforeEach(async () => {
  await resetDb();
});

describe('GET /health', () => {
  it('responds with "ok"', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
  });
});

describe('GET /api/version', () => {
  it('returns a numeric dataVersion', async () => {
    const res = await request(app).get('/api/version');
    expect(res.status).toBe(200);
    expect(typeof res.body.dataVersion).toBe('number');
    expect(res.body.dataVersion).toBeGreaterThan(0);
  });
});
