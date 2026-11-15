import { NUTRIENT_KEYS, type NutrientKey, type Nutrients } from './nutrients.ts';

export type EntrySource = 'manual' | 'barcode' | 'ai';

export type MealEntry = {
  id: string;
  /** Kas valgė: kliento (organizacijos) žmogus. */
  personId: string;
  date: string;
  name: string;
  grams: number;
  nutrients: Nutrients;
  source: EntrySource;
  productId: string | null;
  createdAt: string;
};

/** Dienos tikslas. `null` – tikslas tai maistinei vertei nenustatytas. */
export type DailyGoal = Nutrients;

/**
 * Vienos maistinės vertės dienos suma.
 *
 * Trūkstamos vertės nesumuojamos kaip 0: `known` yra tik žinomų verčių suma, o
 * `missingIn` – kiek įrašų šios vertės neturi. Kai `missingIn > 0`, suma yra
 * apatinė riba („bent tiek“), ir sąsaja ją taip ir rodo. Kai nežinoma nė viena
 * reikšmė, `value` yra `null` ir rodomas brūkšnys, o ne 0.
 */
export type NutrientTotal = {
  value: number | null;
  missingIn: number;
  complete: boolean;
  goal: number | null;
  /** Likutis iki tikslo; `null`, jei tikslo nėra arba suma nepilna. */
  remaining: number | null;
};

export type DaySummary = {
  date: string;
  entryCount: number;
  pendingDrafts: number;
  totals: Record<NutrientKey, NutrientTotal>;
};

export function summarizeDay(
  date: string,
  entries: MealEntry[],
  goal: DailyGoal | null,
  pendingDrafts = 0,
): DaySummary {
  const totals = {} as Record<NutrientKey, NutrientTotal>;
  for (const key of NUTRIENT_KEYS) {
    let known = 0;
    let knownCount = 0;
    let missingIn = 0;
    for (const entry of entries) {
      const v = entry.nutrients[key];
      if (v === null) missingIn++;
      else {
        known += v;
        knownCount++;
      }
    }
    const value = entries.length > 0 && knownCount === 0 ? null : known;
    const complete = missingIn === 0;
    const target = goal?.[key] ?? null;
    totals[key] = {
      value,
      missingIn,
      complete,
      goal: target,
      remaining: target !== null && complete && value !== null ? target - value : null,
    };
  }
  return { date, entryCount: entries.length, pendingDrafts, totals };
}
