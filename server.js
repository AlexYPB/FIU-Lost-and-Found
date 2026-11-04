// Express API for the FIU lost-and-found app.
// Owns: #996 (database + item endpoints) and #997 (claim with verification question).
// The post form (#937), photo upload UI (#938) and front page (#936) can call these endpoints.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { createItem, listItems, getItem, submitClaim, normalizeAnswer } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));
// nosniff: browsers must treat uploads as the image type we saved them as.
app.use('/uploads', express.static(UPLOAD_DIR, {
  setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
}));

// Allowed photo types. The saved extension comes from this table, never from the
// user's file name, so an upload can't become an .html page.
const IMAGE_TYPES = {
  'image/jpeg': { ext: '.jpg',  magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png':  { ext: '.png',  magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/gif':  { ext: '.gif',  magic: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  'image/webp': { ext: '.webp', magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};

class BadRequest extends Error {}

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${IMAGE_TYPES[file.mimetype].ext}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_TYPES[file.mimetype]) return cb(null, true);
    cb(new BadRequest('Photo must be a JPG, PNG, GIF or WEBP image'));
  },
});

// Confirms the file content really is the image type it claims to be.
function isRealImage(file) {
  const fd = fs.openSync(file.path, 'r');
  try {
    const head = Buffer.alloc(12);
    const n = fs.readSync(fd, head, 0, 12, 0);
    return n >= 4 && IMAGE_TYPES[file.mimetype].magic(head);
  } finally {
    fs.closeSync(fd);
  }
}

function removeUpload(file) {
  if (file) fs.rmSync(file.path, { force: true });
}

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const clean = (s, max = 500) => (typeof s === 'string' ? s.trim().slice(0, max) : '');
const hasLetterOrNumber = (s) => normalizeAnswer(s).length > 0;

function parseId(raw) {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// GET /api/items?q=wallet  -> open items (no answers, no poster email)
app.get('/api/items', (req, res) => {
  res.json(listItems({ q: clean(req.query.q, 100) || undefined }));
});

// GET /api/items/:id -> one item, including its verification question
app.get('/api/items/:id', (req, res) => {
  const id = parseId(req.params.id);
  const item = id && getItem(id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(item);
});

// POST /api/items  (multipart/form-data, optional field "photo")
app.post('/api/items', upload.single('photo'), (req, res) => {
  const b = req.body || {};
  const data = {
    title: clean(b.title, 100),
    description: clean(b.description, 1000),
    location_found: clean(b.location_found, 200),
    verification_question: clean(b.verification_question, 200),
    verification_answer: clean(b.verification_answer, 200),
    poster_email: clean(b.poster_email, 200).toLowerCase(),
    photo_path: req.file ? `/uploads/${req.file.filename}` : null,
  };

  const fail = (error) => { removeUpload(req.file); res.status(400).json({ error }); };

  const missing = ['title', 'description', 'verification_question', 'verification_answer', 'poster_email']
    .filter((k) => !data[k]);
  if (missing.length) return fail(`Missing: ${missing.join(', ')}`);
  if (!isEmail(data.poster_email)) return fail('Invalid email');
  if (!hasLetterOrNumber(data.verification_answer)) {
    return fail('Verification answer must contain letters or numbers');
  }
  if (req.file && !isRealImage(req.file)) return fail('Photo file is not a valid image');

  res.status(201).json(createItem(data));
});

// POST /api/items/:id/claim  { name, email, answer }  -> #997
app.post('/api/items/:id/claim', (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 100);
  const email = clean(b.email, 200).toLowerCase();
  const answer = clean(b.answer, 200);
  if (!name || !hasLetterOrNumber(answer) || !isEmail(email)) {
    return res.status(400).json({ error: 'Name, a valid email, and an answer are required' });
  }

  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ success: false, error: 'Item not found' });

  const r = submitClaim({ itemId: id, name, email, answer });
  if (r.ok) {
    return res.json({
      success: true,
      message: 'Ownership verified! Contact the finder to arrange pickup.',
      contact: r.posterEmail,
    });
  }
  const map = {
    not_found:         [404, 'Item not found'],
    already_claimed:   [409, 'This item has already been claimed'],
    too_many_attempts: [429, 'Too many wrong answers for this item'],
    wrong_answer:      [403, 'That answer does not match'],
  };
  const [status, error] = map[r.reason];
  res.status(status).json({ success: false, error, attemptsLeft: r.attemptsLeft });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  removeUpload(req.file);
  if (err instanceof BadRequest || err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Lost & Found running at http://localhost:${PORT}`));
}
module.exports = app;
