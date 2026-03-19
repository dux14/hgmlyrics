require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');

const { all, get, run } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
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

// --- AUTH ROUTE --- //
app.post('/api/auth/login', (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN is required' });
  
  if (pin === (process.env.ADMIN_PIN || '1234')) {
    const token = jwt.sign({ admin: true }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
    return res.json({ token });
  }
  
  res.status(401).json({ error: 'Invalid PIN' });
});

// --- UPLOAD ROUTE --- //
const multer = require('multer');
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'uploads'))
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
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
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const countRow = await get('SELECT COUNT(*) as total FROM songs');
    const total = countRow.total;

    const rows = await all(
      `SELECT id, title, artist, album, albumSlug, year, genre,
              voiceType, voicePercentMale, voicePercentFemale,
              coverImage, albumOrder, createdAt, updatedAt
       FROM songs ORDER BY album, albumOrder LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const songs = rows.map(r => ({
      ...r,
      voicePercent: { male: r.voicePercentMale, female: r.voicePercentFemale },
    }));
    songs.forEach(s => {
      delete s.voicePercentMale;
      delete s.voicePercentFemale;
    });

    res.json({ songs, total, page, limit, totalPages: Math.ceil(total / limit) });
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
       FROM songs`
    );

    const results = rows
      .filter(r => {
        const haystack = removeAccents(`${r.title} ${r.album} ${r.artist}`).toLowerCase();
        return haystack.includes(normalizedQ);
      })
      .slice(0, 15)
      .map(r => ({
        ...r,
        voicePercent: { male: r.voicePercentMale, female: r.voicePercentFemale },
      }));
    results.forEach(s => {
      delete s.voicePercentMale;
      delete s.voicePercentFemale;
    });

    res.json({ results });
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
      sections: JSON.parse(row.sections || '[]')
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
    await run(`
      INSERT INTO songs (
        id, title, artist, album, albumSlug, year, genre, 
        voiceType, voicePercentMale, voicePercentFemale, coverImage, 
        sections, albumOrder, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      s.id, s.title, s.artist, s.album, s.albumSlug, s.year, s.genre,
      s.voiceType, s.voicePercent?.male || 50, s.voicePercent?.female || 50,
      s.coverImage, sectionsJson, s.albumOrder || 0, new Date().toISOString(), new Date().toISOString()
    ]);
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
    await run(`
      UPDATE songs SET
        title = ?, artist = ?, album = ?, albumSlug = ?, year = ?, genre = ?,
        voiceType = ?, voicePercentMale = ?, voicePercentFemale = ?, coverImage = ?,
        sections = ?, albumOrder = ?, updatedAt = ?
      WHERE id = ?
    `, [
      s.title, s.artist, s.album, s.albumSlug, s.year, s.genre,
      s.voiceType, s.voicePercent?.male || 50, s.voicePercent?.female || 50,
      s.coverImage, sectionsJson, s.albumOrder || 0, new Date().toISOString(), id
    ]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/songs/:id', authMiddleware, async (req, res) => {
  try {
    await run('DELETE FROM songs WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// START SERVER
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
module.exports = { app, authMiddleware };
