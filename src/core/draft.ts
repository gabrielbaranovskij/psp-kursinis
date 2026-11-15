import type { AiEstimate } from './ai-estimate.ts';
import { DomainError } from './errors.ts';
import { assertValidGrams, NUTRIENT_KEYS, rescalePortion, type Nutrients } from './nutrients.ts';

/**
 * AI įvertinimas niekada neįrašomas tiesiai į dienos sumą: jis tampa
 * juodraščiu (`pending`), kurį naudotojas patvirtina arba atmeta.
 *
 * Tai atsakymas į I etapo pastabą: pataisytos neigiamos reikšmės ir „Not food“
 * dienos sumos nepaveikia, kol naudotojas jų nepatvirtina.
 *   - Pataisytą įvertinimą galima patvirtinti (naudotojas mato `corrections`).
 *   - „Not food“ patvirtinti be naudotojo įvestų verčių negalima (409):
 *     nulinis „ne maisto“ įrašas dienoje būtų triukšmas.
 */
export type DraftStatus = 'pending' | 'confirmed' | 'discarded';

export type MealDraft = {
  id: string;
  personId: string;
  date: string;
  status: DraftStatus;
  estimate: AiEstimate;
  createdAt: string;
};

/** Ką naudotojas gali pakeisti tvirtindamas. */
export type DraftEdits = {
  name?: string;
  /** Kiek iš tikrųjų suvalgyta: vertės perskaičiuojamos nuo AI porcijos. */
  grams?: number;
  /** Naudotojo įvestos vertės suvalgytam kiekiui; nustelbia AI vertes. */
  nutrients?: Nutrients;
};

export type ConfirmedMeal = { name: string; grams: number; nutrients: Nutrients };

export function assertPending(draft: MealDraft): void {
  if (draft.status !== 'pending') {
    throw DomainError.conflict('draft_not_pending', `This estimate is already ${draft.status}.`);
  }
}

export function confirmDraft(draft: MealDraft, edits: DraftEdits = {}): ConfirmedMeal {
  assertPending(draft);
  const { estimate } = draft;

  if (estimate.notFood && !edits.nutrients) {
    throw DomainError.conflict(
      'not_food',
      'The AI says this is not food. Enter the values yourself or discard the estimate.',
    );
  }
  if (edits.nutrients) assertNonNegative(edits.nutrients);

  const grams = edits.grams ?? estimate.portionGrams;
  assertValidGrams(grams);

  const nutrients =
    edits.nutrients ??
    (grams === estimate.portionGrams
      ? estimate.nutrients
      : rescalePortion(estimate.nutrients, estimate.portionGrams, grams));

  const name = edits.name?.trim() || estimate.name;
  return { name, grams, nutrients };
}

function assertNonNegative(n: Nutrients): void {
  for (const key of NUTRIENT_KEYS) {
    const v = n[key];
    if (v !== null && (!Number.isInteger(v) || v < 0)) {
      throw DomainError.badRequest('invalid_nutrients', `${key} must be a whole number, 0 or more.`);
    }
  }
}
