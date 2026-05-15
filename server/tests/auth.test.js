const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../index');
const { resetDb } = require('./helpers');

beforeEach(async () => {
  await resetDb();
});

describe('POST /api/auth/login', () => {
  it('returns 400 when PIN missing', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PIN/i);
  });

  it('returns 401 with wrong PIN', async () => {
    const res = await request(app).post('/api/auth/login').send({ pin: 'wrong-pin' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('returns a valid JWT with the correct PIN', async () => {
    const res = await request(app).post('/api/auth/login').send({ pin: process.env.ADMIN_PIN });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');

    const payload = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(payload.admin).toBe(true);
    expect(payload.exp - payload.iat).toBeGreaterThan(60 * 60 * 24 * 6); // ~7d
  });
});
