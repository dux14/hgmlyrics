const request = require('supertest');
const { app } = require('../index');
const { resetDb, seedSong, makeAdminToken } = require('./helpers');

beforeEach(async () => {
  await resetDb();
});

describe('POST /api/songs (auth required)', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/songs').send({ id: 'x', title: 'X' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const res = await request(app)
      .post('/api/songs')
      .set('Authorization', 'Bearer not-a-real-jwt')
      .send({ id: 'x', title: 'X' });
    expect(res.status).toBe(401);
  });

  it('inserts a song with admin token', async () => {
    const token = makeAdminToken();
    const res = await request(app)
      .post('/api/songs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        id: 'new-song',
        title: 'New',
        artist: 'A',
        album: 'B',
        albumSlug: 'b',
        year: 2025,
        genre: 'rock',
        voiceType: 'SATB',
        voicePercent: { male: 60, female: 40 },
        coverImage: null,
        sections: [{ type: 'verse', text: 'hi' }],
        albumOrder: 1,
        cejilla: 3,
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBe('new-song');

    const fetched = await request(app).get('/api/songs/new-song');
    expect(fetched.status).toBe(200);
    expect(fetched.body.title).toBe('New');
    expect(fetched.body.voicePercent).toEqual({ male: 60, female: 40 });
    expect(fetched.body.sections).toEqual([{ type: 'verse', text: 'hi' }]);
    expect(fetched.body.cejilla).toBe(3);
  });
});

describe('PUT /api/songs/:id (auth required)', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).put('/api/songs/x').send({ title: 'X' });
    expect(res.status).toBe(401);
  });

  it('updates an existing song with admin token', async () => {
    await seedSong({ id: 's1', title: 'Original' });
    const token = makeAdminToken();
    const res = await request(app)
      .put('/api/songs/s1')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Updated',
        artist: 'A',
        album: 'B',
        albumSlug: 'b',
        year: 2025,
        genre: 'pop',
        voiceType: 'SATB',
        voicePercent: { male: 50, female: 50 },
        coverImage: null,
        sections: [],
        albumOrder: 0,
        cejilla: null,
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const fetched = await request(app).get('/api/songs/s1');
    expect(fetched.body.title).toBe('Updated');
  });
});

describe('DELETE /api/songs/:id (auth required)', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).delete('/api/songs/x');
    expect(res.status).toBe(401);
  });

  it('removes the song with admin token', async () => {
    await seedSong({ id: 's1' });
    const token = makeAdminToken();
    const res = await request(app).delete('/api/songs/s1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const fetched = await request(app).get('/api/songs/s1');
    expect(fetched.status).toBe(404);
  });
});

describe('writes bump dataVersion', () => {
  it('increments dataVersion after a POST', async () => {
    const before = (await request(app).get('/api/version')).body.dataVersion;
    // Wait 5ms to guarantee Date.now() advances.
    await new Promise((r) => setTimeout(r, 5));
    const token = makeAdminToken();
    await request(app)
      .post('/api/songs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        id: 'v-test',
        title: 'V',
        artist: '',
        album: '',
        albumSlug: '',
        year: 2025,
        genre: '',
        voiceType: '',
        voicePercent: { male: 50, female: 50 },
        coverImage: null,
        sections: [],
        albumOrder: 0,
        cejilla: null,
      });
    const after = (await request(app).get('/api/version')).body.dataVersion;
    expect(after).toBeGreaterThan(before);
  });
});
