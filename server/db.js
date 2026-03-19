const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, 'sqlite.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    // Create tables
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS songs (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          artist TEXT,
          album TEXT,
          albumSlug TEXT,
          year INTEGER,
          genre TEXT,
          voiceType TEXT,
          voicePercentMale INTEGER,
          voicePercentFemale INTEGER,
          coverImage TEXT,
          sections TEXT,
          createdAt TEXT,
          updatedAt TEXT
        )
      `);
    });
  }
});

// Seed data function to ensure we start with something if empty
function seedData() {
  db.get('SELECT COUNT(*) as count FROM songs', [], (err, row) => {
    if (err) return console.error(err.message);
    if (row.count === 0) {
      console.log('Seeding initial data...');
      const songsJsonPath = path.resolve(__dirname, '../src/data/songs.json');
      if (fs.existsSync(songsJsonPath)) {
        try {
          const content = fs.readFileSync(songsJsonPath, 'utf8');
          const data = JSON.parse(content);
          if (data && data.songs && data.songs.length > 0) {
            const stmt = db.prepare(`
              INSERT INTO songs (
                id, title, artist, album, albumSlug, year, genre, 
                voiceType, voicePercentMale, voicePercentFemale, coverImage, 
                sections, createdAt, updatedAt
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            data.songs.forEach(song => {
              stmt.run([
                song.id, song.title, song.artist, song.album, song.albumSlug,
                song.year, song.genre, song.voiceType,
                song.voicePercent?.male || 50,
                song.voicePercent?.female || 50,
                song.coverImage,
                JSON.stringify(song.sections || []),
                song.createdAt || new Date().toISOString(),
                song.updatedAt || new Date().toISOString()
              ]);
            });
            stmt.finalize();
            console.log('Seeded data successfully.');
          }
        } catch (e) {
          console.error('Error seeding data:', e);
        }
      }
    }
  });
}

// Quick promise wrappers for queries
const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const all = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// Seed on startup
setTimeout(seedData, 500);

module.exports = { db, run, all, get };
