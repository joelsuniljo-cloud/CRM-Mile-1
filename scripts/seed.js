// Optional: load the three example prospects.
// Usage: npm run seed   (uses DATABASE_URL if set, else ./data/db.json)
// With the file store, stop the server first, because the running server keeps its own copy in memory.
// On Render, set SEED_EXAMPLES=true instead and the server seeds an empty database on startup.
import { createStore } from '../lib/store.js';
import { seedExamples } from '../lib/seed.js';

const store = await createStore();
console.log('seeded', await seedExamples(store), 'example prospects');
process.exit(0);
