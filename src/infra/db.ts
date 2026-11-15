import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { seed } from './seed.ts';

/**
 * SQLite duomenų bazė (įtaisytas `node:sqlite`, papildomai nieko diegti nereikia).
 *
 * Klientas (tenant) – organizacija, pvz. dietologų kabinetas; jo žmonės – `people`.
 * Kiekviena su klientu susijusi lentelė turi `tenant_id` su išoriniu raktu į
 * `tenants`. Tai ir yra aiški duomenų priklausomybė klientui; kad užklausos jį
 * visada filtruotų, užtikrina SqliteTenantRepository.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  api_key   TEXT NOT NULL UNIQUE
);

-- Kliento žmonės (pvz. dietologų kabineto pacientai), kurių mityba sekama.
CREATE TABLE IF NOT EXISTS people (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id),
  name       TEXT NOT NULL
);

-- Produktų biblioteka bendra visam klientui.
CREATE TABLE IF NOT EXISTS products (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id),
  name       TEXT NOT NULL,
  barcode    TEXT,
  kcal       INTEGER,
  protein_g  INTEGER,
  carb_g     INTEGER,
  fat_g      INTEGER,
  source     TEXT NOT NULL CHECK (source IN ('manual','barcode','ai')),
  UNIQUE (tenant_id, barcode)
);

CREATE TABLE IF NOT EXISTS meal_entries (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  person_id   TEXT NOT NULL REFERENCES people(id),
  date        TEXT NOT NULL,
  name        TEXT NOT NULL,
  grams       INTEGER NOT NULL CHECK (grams > 0),
  kcal        INTEGER,
  protein_g   INTEGER,
  carb_g      INTEGER,
  fat_g       INTEGER,
  source      TEXT NOT NULL CHECK (source IN ('manual','barcode','ai')),
  product_id  TEXT REFERENCES products(id),
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS meal_entries_person_date ON meal_entries (tenant_id, person_id, date);

CREATE TABLE IF NOT EXISTS meal_drafts (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  person_id   TEXT NOT NULL REFERENCES people(id),
  date        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending','confirmed','discarded')),
  estimate    TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_goals (
  person_id  TEXT PRIMARY KEY REFERENCES people(id),
  tenant_id  TEXT NOT NULL REFERENCES tenants(id),
  kcal       INTEGER,
  protein_g  INTEGER,
  carb_g     INTEGER,
  fat_g      INTEGER
);
`;

export type Tenant = { id: string; name: string };

export function openDatabase(path: string, options: { seed?: boolean } = {}): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  if (options.seed !== false) {
    const row = db.prepare('SELECT COUNT(*) AS n FROM tenants').get() as { n: number };
    if (row.n === 0) seed(db);
  }
  return db;
}

export function findTenantByApiKey(db: DatabaseSync, apiKey: string): Tenant | null {
  const row = db.prepare('SELECT id, name FROM tenants WHERE api_key = ?').get(apiKey) as Tenant | undefined;
  return row ?? null;
}
