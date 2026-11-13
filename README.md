# FIU Lost & Found — Database (#996) and Ownership Claim (#997)

Christian Armas Rodriguez's part of Sprint A. Node.js + Express + SQLite.

## Run it
Requires Node.js 22 or newer (the locked better-sqlite3 13 dependency requires it).
```
npm install
npm run seed     # optional: 3 sample items
npm start        # http://localhost:3000
npm test         # 15 tests for #996 and #997
```
Claim page for an item: `http://localhost:3000/claim.html?id=1`
(Sample answer for item 1: `Panther`.)

## #996 — Database (`db.js`)
SQLite file `lostfound.db`, created automatically.

**items**: id, title, description, location_found, photo_path, verification_question,
answer_hash, answer_salt, poster_email, status (`open` / `claimed`), created_at

**claims**: id, item_id, claimant_name, claimant_email, correct, created_at

Verification answers are normalized (case, spacing, punctuation ignored) and hashed with
scrypt + a per-item salt, so the plain answer is never stored. The answer and the poster's
email are never returned by the API.

## #997 — Ownership claim (`public/claim.html` + `POST /api/items/:id/claim`)
Shows the item, its photo, and the verification question. The claimant enters the answer,
name, and email.
- Correct → item becomes `claimed`, claimant gets the finder's contact email
- Wrong → 403 with attempts left (3 wrong answers per email per item, then 429)
- Already claimed → 409

## API for teammates
| Method | Path | Used by |
|---|---|---|
| GET | `/api/items?q=` | #936 front page (open items, optional search) |
| GET | `/api/items/:id` | #997 claim page |
| POST | `/api/items` (multipart: title, description, location_found, verification_question, verification_answer, poster_email, photo) | #937 post form, #938 photo upload |
| POST | `/api/items/:id/claim` (JSON: name, email, answer) | #997 claim form |

Photos: images only (jpg/png/gif/webp), 5 MB max, served from `/uploads/...`. The file content is checked
(not just the name), and the saved extension is set by the server, so uploads can't be turned into web pages.
Rejected posts don't leave files behind.
To link the front page to the claim form: `<a href="/claim.html?id=ITEM_ID">Claim</a>`.
`public/index.html` implements the #934/#936 homepage, with styles in `public/styles.css` and
API-backed listing/search in `public/app.js`. Static frontend files go in `public/`.

## Validation
- Answers must contain at least one letter or number (stops "!!!" answers that anyone could match)
- Missing/bad request bodies get a 400 with a message, never a server crash
- Search treats `%` and `_` as normal characters

## #934 / #936 — Homepage (Alexis)
- Responsive navy/gold layout, item cards, dates, locations, and missing/broken-photo placeholders.
- Fetches open items from the existing API; debounced search uses `?q=` and ignores stale responses.
- Loading, empty, no-match, and failure states, with retry and clear-search actions.
- Claim links use `/claim.html?id=ITEM_ID`; returning to the homepage refreshes availability.
- User text is rendered with `textContent`; photos are limited to local upload paths.
- Eduardo's posting page is not included yet. The disabled “Post an item” action is an integration
  point in `public/index.html`; replace it with the actual page link when his work arrives.

Additional dependency-free homepage checks: `node --test frontend.test.js`.
These check rendering/search/state behavior using a small DOM test double; they do not replace
visual browser checks. Run `npm test` for Christian's existing API/database/claim tests.

Manual browser review: at desktop and mobile widths, check the seeded cards and photo fallbacks,
search for “backpack”, clear the search, follow a Claim link, and return after claiming an item.
The claimed item should disappear. Check the browser console for errors and test retry offline.
