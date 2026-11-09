// Document store with two backends behind one interface.
//   DATABASE_URL set  -> Postgres (use this on Render so data survives deploys)
//   otherwise         -> a JSON file in DATA_DIR (fine for local use)
import fs from 'node:fs/promises';
import path from 'node:path';
import { deepMerge } from './merge.js';

export async function createStore() {
  if (process.env.DATABASE_URL) return pgStore(process.env.DATABASE_URL);
  return fileStore(process.env.DATA_DIR || path.resolve('data'));
}

async function pgStore(url) {
  const { default: pg } = await import('pg');
  // Render's internal URLs need no SSL. External ones (*.render.com) do.
  const ssl = process.env.PGSSL === 'false' ? false : /render\.com/.test(url) || process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false;
  const pool = new pg.Pool({ connectionString: url, ssl, max: 5 });
  await pool.query(`create table if not exists docs (
    collection text not null,
    id text not null,
    data jsonb not null,
    updated_at timestamptz not null default now(),
    primary key (collection, id)
  )`);
  return {
    kind: 'postgres',
    async list(collection) {
      const r = await pool.query('select id, data from docs where collection = $1 order by updated_at desc', [collection]);
      return r.rows.map((x) => ({ id: x.id, data: x.data }));
    },
    async get(collection, id) {
      const r = await pool.query('select data from docs where collection = $1 and id = $2', [collection, id]);
      return r.rows[0]?.data ?? null;
    },
    async set(collection, id, data) {
      await pool.query(
        `insert into docs (collection, id, data) values ($1, $2, $3)
         on conflict (collection, id) do update set data = excluded.data, updated_at = now()`,
        [collection, id, data]
      );
    },
    async patch(collection, id, partial) {
      const c = await pool.connect();
      try {
        await c.query('begin');
        const r = await c.query('select data from docs where collection = $1 and id = $2 for update', [collection, id]);
        if (!r.rows.length) { await c.query('rollback'); return false; }
        const merged = deepMerge(r.rows[0].data, partial);
        await c.query('update docs set data = $3, updated_at = now() where collection = $1 and id = $2', [collection, id, merged]);
        await c.query('commit');
        return true;
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    async del(collection, id) {
      await pool.query('delete from docs where collection = $1 and id = $2', [collection, id]);
    },
  };
}

async function fileStore(dir) {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'db.json');
  let db = {};
  try { db = JSON.parse(await fs.readFile(file, 'utf8')); } catch { db = {}; }
  let chain = Promise.resolve();
  const save = () => {
    chain = chain.then(async () => {
      const tmp = file + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(db));
      await fs.rename(tmp, file);
    }).catch((e) => console.error('Could not write data file:', e.message));
    return chain;
  };
  const col = (c) => (db[c] ||= {});
  return {
    kind: 'file',
    async list(collection) {
      return Object.entries(col(collection))
        .map(([id, v]) => ({ id, data: v.data, at: v.at }))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .map(({ id, data }) => ({ id, data }));
    },
    async get(collection, id) { return col(collection)[id]?.data ?? null; },
    async set(collection, id, data) { col(collection)[id] = { data, at: new Date().toISOString() }; await save(); },
    async patch(collection, id, partial) {
      const row = col(collection)[id];
      if (!row) return false;
      row.data = deepMerge(row.data, partial);
      row.at = new Date().toISOString();
      await save();
      return true;
    },
    async del(collection, id) { delete col(collection)[id]; await save(); },
  };
}
