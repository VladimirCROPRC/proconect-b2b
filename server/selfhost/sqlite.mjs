import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const binding = value => typeof value === 'boolean' ? Number(value) : value instanceof ArrayBuffer ? new Uint8Array(value) : value;

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  return db;
}

export function d1Adapter(db) {
  class Statement {
    constructor(sql, args = []) { this.sql = sql; this.args = args.map(binding); }
    bind(...args) { return new Statement(this.sql, args); }
    execute() {
      const statement = db.prepare(this.sql);
      // D1 .first() is also used for DELETE ... RETURNING.
      const results = statement.columns().length ? statement.all(...this.args) : [];
      const changes = results.length || (statement.columns().length ? 0 : Number(statement.run(...this.args).changes));
      return { results, success: true, meta: { changes, last_row_id: Number(db.prepare('SELECT last_insert_rowid() AS id').get().id), duration: 0 } };
    }
    async all() { return this.execute(); }
    async run() { return this.execute(); }
    async first(column) { const row = this.execute().results[0]; return row ? column === undefined ? row : row[column] : null; }
    async raw() { return this.execute().results.map(row => Object.values(row)); }
  }
  return {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE');
      try { const results = statements.map(statement => statement.execute()); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    async exec(sql) { db.exec(sql); return { count: 1, duration: 0 }; },
  };
}
