require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const { all, get, run } = require('./db');

// Fail-fast: rechazar arranque sin secrets críticos definidos.
const REQUIRED_ENV = ['ADMIN_PIN', 'JWT_SECRET'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(
    `❌ Missing required env vars: ${missing.join(', ')}.\n` +
      `   Copy server/.env.example → server/.env and fill the values.`,
  );
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// ── In-memory cache for song listings ──
let songsCache = null;
let songsCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Data version tracking (F1) ──
let dataVersion = Date.now();

function bumpDataVersion() {
  dataVersion = Date.now();
}

function invalidateSongsCache() {
  songsCache = null;
  songsCacheTime = 0;
}

app.use(cors());
app.use(compression());
app.use(express.json());
// Serve the uploads folder statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Simple Auth Middleware
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// --- HEALTH CHECK --- //
app.get('/health', (req, res) => res.send('ok'));

// --- VERSION ENDPOINT (F1) --- //
app.get('/api/version', (req, res) => {
  res.json({ dataVersion });
});

// --- AUTH ROUTE --- //
app.post('/api/auth/login', (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN is required' });

  if (pin === process.env.ADMIN_PIN) {
    const token = jwt.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token });
  }

  res.status(401).json({ error: 'Invalid PIN' });
});

// --- UPLOAD ROUTE --- //
const multer = require('multer');
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  },
});
const upload = multer({ storage: storage });

app.post('/api/upload', authMiddleware, upload.single('cover'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

// --- Helper: strip accents for comparison --- //
function removeAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// --- SONGS ROUTES --- //
app.get('/api/songs', async (req, res) => {
  try {
    // Return cached response if fresh
    if (songsCache && Date.now() - songsCacheTime < CACHE_TTL) {
      return res.json(songsCache);
    }

    // Single query — no pagination needed for ~100 songs
    const rows = await all(
      `SELECT id, title, artist, album, albumSlug, year, genre,
              voiceType, voicePercentMale, voicePercentFemale,
              coverImage, albumOrder, createdAt, updatedAt
       FROM songs ORDER BY album, albumOrder`,
    );

    const songs = rows.map((r) => ({
      ...r,
      voicePercent: { male: r.voicePercentMale, female: r.voicePercentFemale },
    }));
    songs.forEach((s) => {
      delete s.voicePercentMale;
      delete s.voicePercentFemale;
    });

    // Cache the result
    songsCache = { songs, total: songs.length };
    songsCacheTime = Date.now();

    res.json(songsCache);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- SEARCH SONGS --- //
app.get('/api/songs/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ results: [] });

    const normalizedQ = removeAccents(q).toLowerCase();
    const rows = await all(
      `SELECT id, title, artist, album, albumSlug, year, genre,
              voiceType, voicePercentMale, voicePercentFemale,
              coverImage, albumOrder
       FROM songs`,
    );

    const results = rows
      .filter((r) => {
        const haystack = removeAccents(`${r.title} ${r.album} ${r.artist}`).toLowerCase();
        return haystack.includes(normalizedQ);
      })
      .slice(0, 15)
      .map((r) => ({
        ...r,
        voicePercent: { male: r.voicePercentMale, female: r.voicePercentFemale },
      }));
    results.forEach((s) => {
      delete s.voicePercentMale;
      delete s.voicePercentFemale;
    });

    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- ALL SONGS WITH SECTIONS (F8: pre-caching) --- //
app.get('/api/songs/all', async (req, res) => {
  try {
    const rows = await all('SELECT * FROM songs ORDER BY album, albumOrder');
    const songs = rows.map((r) => ({
      ...r,
      voicePercent: { male: r.voicePercentMale, female: r.voicePercentFemale },
      sections: JSON.parse(r.sections || '[]'),
    }));
    songs.forEach((s) => {
      delete s.voicePercentMale;
      delete s.voicePercentFemale;
    });

    res.set('Cache-Control', 'no-store');
    res.json({ songs, version: dataVersion });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/songs/:id', async (req, res) => {
  try {
    const row = await get('SELECT * FROM songs WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Song not found' });

    const song = {
      ...row,
      voicePercent: { male: row.voicePercentMale, female: row.voicePercentFemale },
      sections: JSON.parse(row.sections || '[]'),
    };
    delete song.voicePercentMale;
    delete song.voicePercentFemale;

    res.json(song);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/songs', authMiddleware, async (req, res) => {
  const s = req.body;
  try {
    const sectionsJson = JSON.stringify(s.sections || []);
    await run(
      `
      INSERT INTO songs (
        id, title, artist, album, albumSlug, year, genre, 
        voiceType, voicePercentMale, voicePercentFemale, coverImage, 
        sections, albumOrder, cejilla, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        s.id,
        s.title,
        s.artist,
        s.album,
        s.albumSlug,
        s.year,
        s.genre,
        s.voiceType,
        s.voicePercent?.male ?? 50,
        s.voicePercent?.female ?? 50,
        s.coverImage,
        sectionsJson,
        s.albumOrder || 0,
        s.cejilla ?? null,
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    );
    invalidateSongsCache();
    bumpDataVersion();
    res.status(201).json({ success: true, id: s.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/songs/:id', authMiddleware, async (req, res) => {
  const s = req.body;
  const id = req.params.id;
  try {
    const sectionsJson = JSON.stringify(s.sections || []);
    await run(
      `
      UPDATE songs SET
        title = ?, artist = ?, album = ?, albumSlug = ?, year = ?, genre = ?,
        voiceType = ?, voicePercentMale = ?, voicePercentFemale = ?, coverImage = ?,
        sections = ?, albumOrder = ?, cejilla = ?, updatedAt = ?
      WHERE id = ?
    `,
      [
        s.title,
        s.artist,
        s.album,
        s.albumSlug,
        s.year,
        s.genre,
        s.voiceType,
        s.voicePercent?.male ?? 50,
        s.voicePercent?.female ?? 50,
        s.coverImage,
        sectionsJson,
        s.albumOrder || 0,
        s.cejilla ?? null,
        new Date().toISOString(),
        id,
      ],
    );
    invalidateSongsCache();
    bumpDataVersion();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/songs/:id', authMiddleware, async (req, res) => {
  try {
    await run('DELETE FROM songs WHERE id = ?', [req.params.id]);
    invalidateSongsCache();
    bumpDataVersion();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- SERVE FRONTEND IN PRODUCTION --- //
const distPath = path.resolve(__dirname, '..', 'dist');
const coversPath = path.resolve(__dirname, '..', 'public', 'covers');

// Serve album cover images
app.use('/covers', express.static(coversPath));

// Serve Vite-built frontend
app.use(express.static(distPath));

// SPA catch-all: any non-API route returns index.html
app.get('{*path}', (req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Frontend not built. Run "npm run build" first.');
  }
});

module.exports = { app, authMiddleware, invalidateSongsCache };

// START SERVER (only when run as CLI, never on require/import).
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
