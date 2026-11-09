// Three clearly labelled example prospects, so a fresh install is not an empty screen.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed');
const names = { northfield: 'northfield-dental', kiln: 'kiln-co-ceramics', harbor: 'harbor-light' };

export async function seedExamples(store, { onlyIfEmpty = false } = {}) {
  if (onlyIfEmpty && (await store.list('clients')).length) return 0;
  let n = 0;
  for (const [file, id] of Object.entries(names)) {
    await store.set('clients', id, JSON.parse(await fs.readFile(path.join(dir, file + '.json'), 'utf8')));
    n++;
  }
  return n;
}
