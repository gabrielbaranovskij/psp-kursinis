import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AiEstimate } from '../core/ai-estimate.ts';
import type { DailyGoal, EntrySource, MealEntry } from '../core/day-summary.ts';
import type { DraftStatus, MealDraft } from '../core/draft.ts';
import type { Nutrients } from '../core/nutrients.ts';
import type { Person, Product, ProductSource, TenantRepository } from '../app/ports.ts';

type NutrientRow = { kcal: number | null; protein_g: number | null; carb_g: number | null; fat_g: number | null };
type ProductRow = NutrientRow & { id: string; name: string; barcode: string | null; source: ProductSource };
type EntryRow = NutrientRow & {
  id: string;
  person_id: string;
  date: string;
  name: string;
  grams: number;
  source: EntrySource;
  product_id: string | null;
  created_at: string;
};
type DraftRow = { id: string; person_id: string; date: string; status: DraftStatus; estimate: string; created_at: string };

/**
 * Vieno kliento saugykla. `tenantId` nustatomas konstruktoriuje ir įrašomas į
 * KIEKVIENĄ užklausą (`WHERE tenant_id = ?`, `INSERT … tenant_id`), todėl kito
 * kliento įrašo nepavyks nei perskaityti, nei pakeisti, net žinant jo id.
 */
export class SqliteTenantRepository implements TenantRepository {
  constructor(
    private readonly db: DatabaseSync,
    readonly tenantId: string,
  ) {}

  // -- Žmonės ------------------------------------------------------------------

  listPeople(): Person[] {
    return this.db
      .prepare('SELECT id, name FROM people WHERE tenant_id = ? ORDER BY name')
      .all(this.tenantId) as Person[];
  }

  findPerson(id: string): Person | null {
    const row = this.db
      .prepare('SELECT id, name FROM people WHERE tenant_id = ? AND id = ?')
      .get(this.tenantId, id) as Person | undefined;
    return row ?? null;
  }

  insertPerson(name: string): Person {
    const person = { id: randomUUID(), name };
    this.db.prepare('INSERT INTO people (id, tenant_id, name) VALUES (?, ?, ?)').run(person.id, this.tenantId, name);
    return person;
  }

  // -- Produktai ---------------------------------------------------------------

  listProducts(): Product[] {
    const rows = this.db
      .prepare('SELECT * FROM products WHERE tenant_id = ? ORDER BY name')
      .all(this.tenantId) as ProductRow[];
    return rows.map(toProduct);
  }

  findProduct(id: string): Product | null {
    const row = this.db
      .prepare('SELECT * FROM products WHERE tenant_id = ? AND id = ?')
      .get(this.tenantId, id) as ProductRow | undefined;
    return row ? toProduct(row) : null;
  }

  findProductByBarcode(barcode: string): Product | null {
    const row = this.db
      .prepare('SELECT * FROM products WHERE tenant_id = ? AND barcode = ?')
      .get(this.tenantId, barcode) as ProductRow | undefined;
    return row ? toProduct(row) : null;
  }

  insertProduct(p: Omit<Product, 'id'>): Product {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO products (id, tenant_id, name, barcode, kcal, protein_g, carb_g, fat_g, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, this.tenantId, p.name, p.barcode, ...nutrientParams(p.per100g), p.source);
    return { id, ...p };
  }

  // -- Įrašai ------------------------------------------------------------------

  insertEntry(e: Omit<MealEntry, 'id' | 'createdAt'>): MealEntry {
    // Antra apsaugos linija: servisas tai jau patikrino, bet saugykla neleidžia
    // susieti įrašo su kito kliento žmogumi ar produktu net ir per klaidą.
    if (!this.findPerson(e.personId)) throw new Error('Person belongs to another tenant or does not exist.');
    if (e.productId !== null && !this.findProduct(e.productId)) {
      throw new Error('Product belongs to another tenant or does not exist.');
    }
    const entry: MealEntry = { id: randomUUID(), createdAt: new Date().toISOString(), ...e };
    this.db
      .prepare(
        `INSERT INTO meal_entries
           (id, tenant_id, person_id, date, name, grams, kcal, protein_g, carb_g, fat_g, source, product_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        this.tenantId,
        entry.personId,
        entry.date,
        entry.name,
        entry.grams,
        ...nutrientParams(entry.nutrients),
        entry.source,
        entry.productId,
        entry.createdAt,
      );
    return entry;
  }

  listEntries(personId: string, date: string): MealEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM meal_entries WHERE tenant_id = ? AND person_id = ? AND date = ? ORDER BY created_at')
      .all(this.tenantId, personId, date) as EntryRow[];
    return rows.map((r) => ({
      id: r.id,
      personId: r.person_id,
      date: r.date,
      name: r.name,
      grams: r.grams,
      nutrients: toNutrients(r),
      source: r.source,
      productId: r.product_id,
      createdAt: r.created_at,
    }));
  }

  deleteEntry(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM meal_entries WHERE tenant_id = ? AND id = ?')
      .run(this.tenantId, id);
    return Number(result.changes) > 0;
  }

  // -- AI juodraščiai -----------------------------------------------------------

  insertDraft(d: Omit<MealDraft, 'id' | 'createdAt'>): MealDraft {
    if (!this.findPerson(d.personId)) throw new Error('Person belongs to another tenant or does not exist.');
    const draft: MealDraft = { id: randomUUID(), createdAt: new Date().toISOString(), ...d };
    this.db
      .prepare(
        'INSERT INTO meal_drafts (id, tenant_id, person_id, date, status, estimate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(draft.id, this.tenantId, draft.personId, draft.date, draft.status, JSON.stringify(draft.estimate), draft.createdAt);
    return draft;
  }

  findDraft(id: string): MealDraft | null {
    const row = this.db
      .prepare('SELECT * FROM meal_drafts WHERE tenant_id = ? AND id = ?')
      .get(this.tenantId, id) as DraftRow | undefined;
    return row ? toDraft(row) : null;
  }

  setDraftStatus(id: string, status: DraftStatus): void {
    this.db
      .prepare('UPDATE meal_drafts SET status = ? WHERE tenant_id = ? AND id = ?')
      .run(status, this.tenantId, id);
  }

  listPendingDrafts(filter: { personId?: string; date?: string } = {}): MealDraft[] {
    let sql = "SELECT * FROM meal_drafts WHERE tenant_id = ? AND status = 'pending'";
    const params: string[] = [this.tenantId];
    if (filter.personId) {
      sql += ' AND person_id = ?';
      params.push(filter.personId);
    }
    if (filter.date) {
      sql += ' AND date = ?';
      params.push(filter.date);
    }
    const rows = this.db.prepare(sql + ' ORDER BY created_at').all(...params) as DraftRow[];
    return rows.map(toDraft);
  }

  // -- Tikslai -----------------------------------------------------------------

  getGoal(personId: string): DailyGoal | null {
    const row = this.db
      .prepare('SELECT * FROM daily_goals WHERE tenant_id = ? AND person_id = ?')
      .get(this.tenantId, personId) as
      | NutrientRow
      | undefined;
    return row ? toNutrients(row) : null;
  }

  setGoal(personId: string, goal: DailyGoal): void {
    if (!this.findPerson(personId)) throw new Error('Person belongs to another tenant or does not exist.');
    this.db
      .prepare(
        `INSERT INTO daily_goals (person_id, tenant_id, kcal, protein_g, carb_g, fat_g) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (person_id) DO UPDATE SET
           kcal = excluded.kcal, protein_g = excluded.protein_g,
           carb_g = excluded.carb_g, fat_g = excluded.fat_g`,
      )
      .run(personId, this.tenantId, ...nutrientParams(goal));
  }

  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

function nutrientParams(n: Nutrients): [number | null, number | null, number | null, number | null] {
  return [n.kcal, n.proteinG, n.carbG, n.fatG];
}

function toNutrients(r: NutrientRow): Nutrients {
  return { kcal: r.kcal, proteinG: r.protein_g, carbG: r.carb_g, fatG: r.fat_g };
}

function toProduct(r: ProductRow): Product {
  return { id: r.id, name: r.name, barcode: r.barcode, per100g: toNutrients(r), source: r.source };
}

function toDraft(r: DraftRow): MealDraft {
  return {
    id: r.id,
    personId: r.person_id,
    date: r.date,
    status: r.status,
    estimate: JSON.parse(r.estimate) as AiEstimate,
    createdAt: r.created_at,
  };
}
