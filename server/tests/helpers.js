const jwt = require('jsonwebtoken');
const { run, resetDb } = require('../db');

/**
 * Sign a JWT as admin using the test JWT_SECRET.
 * @returns {string} Bearer token (without "Bearer " prefix).
 */
function makeAdminToken() {
  return jwt.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

/**
 * Insert a song row directly via the db helpers.
 * @param {object} overrides Optional fields to override the default fixture.
 */
async function seedSong(overrides = {}) {
  const fixture = {
    id: 'song-1',
    title: 'Test Song',
    artist: 'Test Artist',
    album: 'Test Album',
    albumSlug: 'test-album',
    year: 2024,
    genre: 'pop',
    voiceType: 'SATB',
    voicePercentMale: 50,
    voicePercentFemale: 50,
    coverImage: '/covers/test.webp',
    sections: JSON.stringify([{ type: 'verse', text: 'la la la' }]),
    albumOrder: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cejilla: null,
    ...overrides,
  };
  await run(
    `INSERT INTO songs (
      id, title, artist, album, albumSlug, year, genre,
      voiceType, voicePercentMale, voicePercentFemale, coverImage,
      sections, albumOrder, createdAt, updatedAt, cejilla
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fixture.id,
      fixture.title,
      fixture.artist,
      fixture.album,
      fixture.albumSlug,
      fixture.year,
      fixture.genre,
      fixture.voiceType,
      fixture.voicePercentMale,
      fixture.voicePercentFemale,
      fixture.coverImage,
      fixture.sections,
      fixture.albumOrder,
      fixture.createdAt,
      fixture.updatedAt,
      fixture.cejilla,
    ],
  );
  return fixture;
}

module.exports = { makeAdminToken, seedSong, resetDb };
