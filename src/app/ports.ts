import type { EstimateRequest } from '../core/ai-estimate.ts';
import type { ExternalProduct } from '../core/barcode.ts';
import type { DailyGoal, MealEntry } from '../core/day-summary.ts';
import type { DraftStatus, MealDraft } from '../core/draft.ts';
import type { Nutrients } from '../core/nutrients.ts';

/**
 * Prievadai (ports): ko modulio logikai reikia iš išorės. Įgyvendinimai yra
 * src/infra, o testuose jie pakeičiami netikrais (fakes).
 */

export type ProductSource = 'manual' | 'barcode' | 'ai';

/** Produktas kliento bibliotekoje (bendra visiems kliento žmonėms). */
export type Product = {
  id: string;
  name: string;
  barcode: string | null;
  per100g: Nutrients;
  source: ProductSource;
};

/** Kliento (organizacijos, pvz. dietologų kabineto) žmogus, kurio mityba sekama. */
export type Person = { id: string; name: string };

/**
 * Vieno kliento (tenant) duomenys. Objektas sukuriamas jau susietas su klientu,
 * todėl kviečiantis kodas negali paprašyti kito kliento įrašo: kiekviena
 * užklausa į saugyklą filtruojama pagal `tenantId`.
 */
export interface TenantRepository {
  readonly tenantId: string;

  listPeople(): Person[];
  findPerson(id: string): Person | null;
  insertPerson(name: string): Person;

  listProducts(): Product[];
  findProduct(id: string): Product | null;
  findProductByBarcode(barcode: string): Product | null;
  insertProduct(product: Omit<Product, 'id'>): Product;

  insertEntry(entry: Omit<MealEntry, 'id' | 'createdAt'>): MealEntry;
  listEntries(personId: string, date: string): MealEntry[];
  /** `false`, jei tokio įrašo šiam klientui nėra. */
  deleteEntry(id: string): boolean;

  insertDraft(draft: Omit<MealDraft, 'id' | 'createdAt'>): MealDraft;
  findDraft(id: string): MealDraft | null;
  setDraftStatus(id: string, status: DraftStatus): void;
  listPendingDrafts(filter?: { personId?: string; date?: string }): MealDraft[];

  getGoal(personId: string): DailyGoal | null;
  setGoal(personId: string, goal: DailyGoal): void;

  /** Įvykdo veiksmus vienoje transakcijoje. */
  transaction<T>(work: () => T): T;
}

/** Produkto paieška internete pagal brūkšninį kodą (Open Food Facts). */
export interface ProductLookup {
  /** `null`, kai produkto nėra; tinklo ar formato klaida meta DomainError(502). */
  findByBarcode(barcode: string): Promise<ExternalProduct | null>;
}

/** AI valgio įvertinimas. Grąžina žalią modelio tekstą; jį tikrina core (R3). */
export interface MealEstimator {
  estimate(request: EstimateRequest): Promise<string>;
}
