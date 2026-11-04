// Adds sample items so the front page and claim form have something to show.
// Run: npm run seed
const { createItem, listItems } = require('./db');

if (listItems().length) {
  console.log('Database already has items; skipping seed.');
  process.exit(0);
}

const samples = [
  { title: 'Black JanSport backpack', description: 'Found under a table on the 2nd floor.',
    location_found: 'Green Library', verification_question: 'What keychain is clipped to the zipper?',
    verification_answer: 'Panther', poster_email: 'finder1@fiu.edu' },
  { title: 'Silver iPhone 14', description: 'Clear case, cracked corner on the back.',
    location_found: 'GC food court', verification_question: 'What sticker is inside the case?',
    verification_answer: 'blue star', poster_email: 'finder2@fiu.edu' },
  { title: 'FIU water bottle', description: 'Navy Hydro Flask with dents near the bottom.',
    location_found: 'Rec Center', verification_question: 'What name is written on the bottom?',
    verification_answer: 'Maria', poster_email: 'finder3@fiu.edu' },
];
samples.forEach(createItem);
console.log(`Seeded ${samples.length} items.`);
