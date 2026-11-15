import type { EstimateRequest } from '../src/core/ai-estimate.ts';
import type { ExternalProduct } from '../src/core/barcode.ts';
import { DomainError } from '../src/core/errors.ts';
import type { MealEstimator, ProductLookup } from '../src/app/ports.ts';
import { buildApp } from '../src/http/app.ts';
import { openDatabase } from '../src/infra/db.ts';
import { SqliteTenantRepository } from '../src/infra/sqlite-repository.ts';
import { MealEntryService } from '../src/app/meal-entry-service.ts';

export const DATE = '2026-11-16';

/** Open Food Facts pakaitalas: grąžina iš anksto įrašytus produktus. */
export class FakeProductLookup implements ProductLookup {
  calls = 0;
  constructor(private readonly products: Record<string, ExternalProduct> = {}) {}
  async findByBarcode(barcode: string): Promise<ExternalProduct | null> {
    this.calls++;
    return this.products[barcode] ?? null;
  }
}

/** Gemini pakaitalas: grąžina įrašytą atsakymą arba meta gedimą. */
export class FakeEstimator implements MealEstimator {
  calls = 0;
  constructor(private readonly answer: string | (() => never)) {}
  async estimate(_req: EstimateRequest): Promise<string> {
    this.calls++;
    return typeof this.answer === 'string' ? this.answer : this.answer();
  }
}

export const unavailable = (): never => {
  throw DomainError.upstream('ai_unavailable', 'The AI is unavailable right now. Nothing was saved.');
};

export function aiJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'Makaronai su sūriu',
    kcal: 420,
    protein_grams: 16,
    carb_grams: 60,
    fat_grams: 12,
    portion_grams: 300,
    confidence: 'medium',
    note: 'Assumed 300 g.',
    ...overrides,
  });
}

/** Tuščia DB su vienu klientu, vienu žmogumi ir servisu, be pavyzdinių duomenų. */
export function serviceFixture(opts: { lookup?: ProductLookup; estimator?: MealEstimator | null } = {}) {
  const db = openDatabase(':memory:', { seed: false });
  db.prepare("INSERT INTO tenants (id, name, api_key) VALUES ('t1', 'Testas', 'k1')").run();
  const repo = new SqliteTenantRepository(db, 't1');
  const person = repo.insertPerson('Jonas');
  const lookup = opts.lookup ?? new FakeProductLookup();
  const service = new MealEntryService(repo, lookup, opts.estimator === undefined ? null : opts.estimator);
  return { db, repo, service, personId: person.id };
}

/** HTTP programa su dviem klientais (A, B) be pavyzdinių duomenų. */
export function appFixture(estimator: MealEstimator | null = new FakeEstimator(aiJson())) {
  const db = openDatabase(':memory:', { seed: false });
  db.prepare("INSERT INTO tenants (id, name, api_key) VALUES ('tA', 'Klientas A', 'key-a'), ('tB', 'Klientas B', 'key-b')").run();
  const personA = new SqliteTenantRepository(db, 'tA').insertPerson('A pacientas');
  const personB = new SqliteTenantRepository(db, 'tB').insertPerson('B pacientas');
  const app = buildApp({ db, productLookup: new FakeProductLookup(), estimator });
  return { db, app, personA: personA.id, personB: personB.id };
}
