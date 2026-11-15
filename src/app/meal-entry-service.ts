import {
  assertValidEstimateRequest,
  parseAiResponse,
  type EstimateRequest,
} from '../core/ai-estimate.ts';
import { assertValidBarcode, NO_PRODUCT_MESSAGE } from '../core/barcode.ts';
import { summarizeDay, type DailyGoal, type DaySummary, type MealEntry } from '../core/day-summary.ts';
import { confirmDraft, assertPending, type DraftEdits, type MealDraft } from '../core/draft.ts';
import { DomainError } from '../core/errors.ts';
import { scaleFromPer100g, toPer100g, type Nutrients } from '../core/nutrients.ts';
import type { MealEstimator, Person, Product, ProductLookup, TenantRepository } from './ports.ts';

/** Vieno žmogaus eilutė kliento apžvalgoje. */
export type PersonDayOverview = Person & Omit<DaySummary, 'date'>;

/**
 * „Valgio įrašo sudarymas“ – pagrindinis modulis.
 *
 * Iš trijų šaltinių (ranka, brūkšninis kodas, AI) gauna maistinę vertę ir
 * paverčia ją konkretaus žmogaus valgio įrašu. Skaičiavimo ir tikrinimo logika
 * yra src/core; ši klasė ją sujungia su saugykla ir išorinėmis paslaugomis.
 *
 * Sukuriama kiekvienai užklausai su jau konkrečiam klientui priskirta saugykla,
 * todėl kito kliento žmogus čia tiesiog „neegzistuoja“ (404).
 */
export class MealEntryService {
  constructor(
    private readonly repo: TenantRepository,
    private readonly productLookup: ProductLookup,
    private readonly estimator: MealEstimator | null,
  ) {}

  // -- Žmonės -------------------------------------------------------------------

  listPeople(): Person[] {
    return this.repo.listPeople();
  }

  addPerson(input: { name: string; goal?: DailyGoal }): Person {
    return this.repo.transaction(() => {
      const person = this.repo.insertPerson(input.name.trim());
      if (input.goal) this.repo.setGoal(person.id, input.goal);
      return person;
    });
  }

  /** Kliento apžvalga: kiekvieno žmogaus dienos suma, tikslas ir trūkstami duomenys. */
  overview(date: string): PersonDayOverview[] {
    return this.repo.listPeople().map((person) => {
      const { date: _date, ...summary } = this.summarize(person.id, date);
      return { ...person, ...summary };
    });
  }

  // -- Įrašas ranka -----------------------------------------------------------

  addManual(input: {
    personId: string;
    date: string;
    name: string;
    grams: number;
    per100g: Nutrients;
    saveToLibrary?: boolean;
  }): MealEntry {
    this.requirePerson(input.personId);
    const nutrients = scaleFromPer100g(input.per100g, input.grams);
    return this.repo.transaction(() => {
      const product = input.saveToLibrary
        ? this.repo.insertProduct({ name: input.name, barcode: null, per100g: input.per100g, source: 'manual' })
        : null;
      return this.repo.insertEntry({
        personId: input.personId,
        date: input.date,
        name: input.name,
        grams: input.grams,
        nutrients,
        source: 'manual',
        productId: product?.id ?? null,
      });
    });
  }

  /** Įrašas iš bibliotekos produkto (R1). */
  addFromProduct(input: { personId: string; date: string; productId: string; grams: number }): MealEntry {
    this.requirePerson(input.personId);
    const product = this.repo.findProduct(input.productId);
    if (!product) throw DomainError.notFound('product_not_found', 'No such product.');
    return this.entryFromProduct(input.personId, product, input.date, input.grams);
  }

  // -- Brūkšninis kodas (R2) ---------------------------------------------------

  /** Pirmiausia vietinė biblioteka, tada internetas. Rastas produktas išsaugomas bibliotekoje. */
  async findByBarcode(barcode: string): Promise<Product> {
    assertValidBarcode(barcode);
    const local = this.repo.findProductByBarcode(barcode);
    if (local) return local;

    const external = await this.productLookup.findByBarcode(barcode);
    if (!external) throw DomainError.notFound('barcode_not_found', NO_PRODUCT_MESSAGE);

    return this.repo.insertProduct({
      name: external.name,
      barcode,
      per100g: external.per100g,
      source: 'barcode',
    });
  }

  async addFromBarcode(input: { personId: string; date: string; barcode: string; grams: number }): Promise<MealEntry> {
    this.requirePerson(input.personId);
    const product = await this.findByBarcode(input.barcode);
    return this.entryFromProduct(input.personId, product, input.date, input.grams);
  }

  // -- AI įvertinimas (R3, R4, R5) -----------------------------------------------

  /**
   * Siunčia nuotrauką ir (ar) tekstą modeliui ir sukuria juodraštį.
   * Dienos suma nepasikeičia, kol juodraštis nepatvirtintas (R5).
   * Gedimas ar nevalidus atsakymas nieko neišsaugo.
   */
  async estimate(input: EstimateRequest & { personId: string; date: string }): Promise<MealDraft> {
    this.requirePerson(input.personId);
    if (!this.estimator) {
      throw new DomainError(503, 'ai_not_configured', 'AI estimates are off. Set GEMINI_API_KEY in .env.');
    }
    assertValidEstimateRequest(input);
    const text = await this.estimator.estimate({
      image: input.image,
      mimeType: input.mimeType,
      hint: input.hint?.trim() || undefined,
    });
    const estimate = parseAiResponse(text);
    return this.repo.insertDraft({ personId: input.personId, date: input.date, status: 'pending', estimate });
  }

  confirmDraft(draftId: string, edits: DraftEdits = {}): MealEntry {
    const draft = this.requireDraft(draftId);
    const meal = confirmDraft(draft, edits);

    return this.repo.transaction(() => {
      // Bibliotekoje pažymimas kaip AI įvertintas (I etapas, 3 skyrius).
      const product = this.repo.insertProduct({
        name: meal.name,
        barcode: null,
        per100g: toPer100g(meal.nutrients, meal.grams),
        source: 'ai',
      });
      this.repo.setDraftStatus(draft.id, 'confirmed');
      return this.repo.insertEntry({
        personId: draft.personId,
        date: draft.date,
        name: meal.name,
        grams: meal.grams,
        nutrients: meal.nutrients,
        source: 'ai',
        productId: product.id,
      });
    });
  }

  discardDraft(draftId: string): void {
    const draft = this.requireDraft(draftId);
    assertPending(draft);
    this.repo.setDraftStatus(draft.id, 'discarded');
  }

  listPendingDrafts(personId: string, date?: string): MealDraft[] {
    this.requirePerson(personId);
    return this.repo.listPendingDrafts({ personId, date });
  }

  // -- Diena ir tikslai ---------------------------------------------------------

  daySummary(personId: string, date: string): DaySummary & { person: Person; entries: MealEntry[] } {
    const person = this.requirePerson(personId);
    return { ...this.summarize(personId, date), person, entries: this.repo.listEntries(personId, date) };
  }

  setGoal(personId: string, goal: DailyGoal): void {
    this.requirePerson(personId);
    this.repo.setGoal(personId, goal);
  }

  deleteEntry(id: string): void {
    if (!this.repo.deleteEntry(id)) throw DomainError.notFound('entry_not_found', 'No such entry.');
  }

  listProducts(): Product[] {
    return this.repo.listProducts();
  }

  // ---------------------------------------------------------------------------

  private summarize(personId: string, date: string): DaySummary {
    const entries = this.repo.listEntries(personId, date);
    const pending = this.repo.listPendingDrafts({ personId, date }).length;
    return summarizeDay(date, entries, this.repo.getGoal(personId), pending);
  }

  private entryFromProduct(personId: string, product: Product, date: string, grams: number): MealEntry {
    return this.repo.insertEntry({
      personId,
      date,
      name: product.name,
      grams,
      nutrients: scaleFromPer100g(product.per100g, grams),
      source: product.source,
      productId: product.id,
    });
  }

  private requirePerson(id: string): Person {
    const person = this.repo.findPerson(id);
    if (!person) throw DomainError.notFound('person_not_found', 'No such person.');
    return person;
  }

  private requireDraft(id: string): MealDraft {
    const draft = this.repo.findDraft(id);
    if (!draft) throw DomainError.notFound('draft_not_found', 'No such estimate.');
    return draft;
  }
}
