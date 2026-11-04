// Tests for #996 (database) and #997 (claim verification). Run: npm test
const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.DB_PATH = ':memory:';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-uploads-'));

const test = require('node:test');
const assert = require('node:assert');
const app = require('./server');

let server, base;
test.before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); }); }));
test.after(() => { server.close(); fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true }); });

const uploads = () => fs.readdirSync(process.env.UPLOAD_DIR);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5e90000000049454e44ae426082', 'hex');

async function postForm(p, fields, photo) {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  if (photo) fd.append('photo', new Blob([photo.data], { type: photo.type }), photo.name);
  const res = await fetch(base + p, { method: 'POST', body: fd });
  return { status: res.status, body: await res.json() };
}
async function postJson(p, body, raw) {
  const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
const claim = (id, answer, email = 'bob@fiu.edu') => postJson(`/api/items/${id}/claim`, { name: 'Bob', email, answer });

const item = { title: 'Red wallet', description: 'Leather, found near PG5', location_found: 'PG5',
  verification_question: 'What card is in the front slot?', verification_answer: 'Panther Card',
  poster_email: 'Finder@FIU.edu' };

let id;

// ---- #996: posting and storing items ----

test('creates an item with a photo and hides the answer and poster email', async () => {
  const r = await postForm('/api/items', item, { data: PNG, type: 'image/png', name: 'wallet.png' });
  assert.equal(r.status, 201);
  id = r.body.id;
  assert.equal(r.body.verification_question, item.verification_question);
  assert.match(r.body.photo_path, /^\/uploads\/[\w-]+\.png$/);
  for (const k of ['answer_hash', 'answer_salt', 'poster_email', 'verification_answer']) assert.ok(!(k in r.body), k);
  const img = await fetch(base + r.body.photo_path);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
});

test('rejects an item with missing fields', async () => {
  const r = await postForm('/api/items', { title: 'x' });
  assert.equal(r.status, 400);
});

test('rejects an invalid poster email', async () => {
  const r = await postForm('/api/items', { ...item, poster_email: 'not-an-email' });
  assert.equal(r.status, 400);
});

test('rejects a punctuation-only answer (would let anyone claim)', async () => {
  const r = await postForm('/api/items', { ...item, verification_answer: '!!!' });
  assert.equal(r.status, 400);
});

test('rejects non-image uploads instead of silently dropping them', async () => {
  const before = uploads().length;
  const r = await postForm('/api/items', item, { data: Buffer.from('hello'), type: 'text/plain', name: 'a.txt' });
  assert.equal(r.status, 400);
  assert.equal(uploads().length, before);
});

test('a fake "image" named .html is rejected and not saved', async () => {
  const before = uploads().length;
  const r = await postForm('/api/items', item, { data: Buffer.from('<script>alert(1)</script>'), type: 'image/png', name: 'evil.html' });
  assert.equal(r.status, 400);
  assert.equal(uploads().length, before);
  assert.ok(uploads().every((f) => !f.endsWith('.html')));
});

test('a rejected post does not leave its photo on disk', async () => {
  const before = uploads().length;
  const r = await postForm('/api/items', { title: 'x' }, { data: PNG, type: 'image/png', name: 'a.png' });
  assert.equal(r.status, 400);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(uploads().length, before);
});

test('lists and searches open items; % is not a wildcard', async () => {
  const all = await (await fetch(`${base}/api/items`)).json();
  assert.equal(all.length, 1);
  assert.equal((await (await fetch(`${base}/api/items?q=wallet`)).json()).length, 1);
  assert.equal((await (await fetch(`${base}/api/items?q=laptop`)).json()).length, 0);
  assert.equal((await (await fetch(`${base}/api/items?q=%25`)).json()).length, 0);
});

test('unknown or invalid item ids return 404', async () => {
  assert.equal((await fetch(`${base}/api/items/999`)).status, 404);
  assert.equal((await fetch(`${base}/api/items/abc`)).status, 404);
  assert.equal((await claim('abc', 'x')).status, 404);
});

// ---- #997: claiming with the verification question ----

test('missing or malformed claim body returns 400, not a crash', async () => {
  const noBody = await fetch(`${base}/api/items/${id}/claim`, { method: 'POST' });
  assert.equal(noBody.status, 400);
  assert.equal((await postJson(`/api/items/${id}/claim`, null, '{bad')).status, 400);
  assert.equal((await claim(id, '?')).status, 400);
});

test('wrong answer is rejected and counts down attempts', async () => {
  const r = await claim(id, 'library card');
  assert.equal(r.status, 403);
  assert.equal(r.body.attemptsLeft, 2);
});

test('locks out after 3 wrong answers, even if the 4th is right', async () => {
  assert.equal((await claim(id, 'nope')).body.attemptsLeft, 1);
  assert.equal((await claim(id, 'nope')).body.attemptsLeft, 0);
  assert.equal((await claim(id, 'panther card')).status, 429);
});

test('correct answer (any case/spacing/punctuation) claims the item', async () => {
  const r = await claim(id, '  panther   CARD! ', 'ana@fiu.edu');
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.equal(r.body.contact, 'finder@fiu.edu');
});

test('claimed item cannot be claimed again and leaves the list', async () => {
  assert.equal((await claim(id, 'panther card', 'ana@fiu.edu')).status, 409);
  assert.equal((await (await fetch(`${base}/api/items`)).json()).length, 0);
});

test('front page and claim page are served', async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/claim.html?id=1`)).status, 200);
});
