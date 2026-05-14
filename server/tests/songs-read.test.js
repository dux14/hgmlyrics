const request = require('supertest');
const { app } = require('../index');
const { resetDb, seedSong } = require('./helpers');

beforeEach(async () => {
  await resetDb();
});

describe('GET /api/songs', () => {
  it('returns empty list when no songs seeded', async () => {
    const res = await request(app).get('/api/songs');
    expect(res.status).toBe(200);
    expect(res.body.songs).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('returns seeded songs with voicePercent object', async () => {
    await seedSong({ id: 's1', title: 'Uno' });
    await seedSong({ id: 's2', title: 'Dos', album: 'Other', albumOrder: 2 });

    const res = await request(app).get('/api/songs');
    expect(res.status).toBe(200);
    expect(res.body.songs).toHaveLength(2);
    const first = res.body.songs[0];
    expect(first.voicePercent).toEqual({ male: 50, female: 50 });
    expect(first).not.toHaveProperty('voicePercentMale');
    expect(first).not.toHaveProperty('voicePercentFemale');
  });
});

describe('GET /api/songs/all', () => {
  it('returns songs with parsed sections and Cache-Control no-store', async () => {
    await seedSong({ id: 's1' });
    const res = await request(app).get('/api/songs/all');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.songs).toHaveLength(1);
    expect(res.body.songs[0].sections).toEqual([{ type: 'verse', text: 'la la la' }]);
    expect(typeof res.body.version).toBe('number');
  });
});

describe('GET /api/songs/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/songs/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns full song with sections parsed', async () => {
    await seedSong({ id: 'abc' });
    const res = await request(app).get('/api/songs/abc');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('abc');
    expect(res.body.sections).toEqual([{ type: 'verse', text: 'la la la' }]);
    expect(res.body.voicePercent).toEqual({ male: 50, female: 50 });
  });
});

describe('GET /api/songs/search', () => {
  it('returns empty results for empty query', async () => {
    const res = await request(app).get('/api/songs/search?q=');
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it('is accent-insensitive', async () => {
    await seedSong({ id: 's1', title: 'Canción de prueba' });
    const res = await request(app).get('/api/songs/search?q=cancion');
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].id).toBe('s1');
  });

  it('matches against title/album/artist', async () => {
    await seedSong({ id: 's1', title: 'Foo', album: 'Bar', artist: 'Baz' });
    const r1 = await request(app).get('/api/songs/search?q=foo');
    const r2 = await request(app).get('/api/songs/search?q=bar');
    const r3 = await request(app).get('/api/songs/search?q=baz');
    expect(r1.body.results).toHaveLength(1);
    expect(r2.body.results).toHaveLength(1);
    expect(r3.body.results).toHaveLength(1);
  });
});
