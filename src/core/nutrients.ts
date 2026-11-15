import { DomainError } from './errors.ts';

/**
 * Maistinė vertė. Visos reikšmės sveikieji skaičiai (kcal ir gramai).
 *
 * `null` reiškia „nežinoma“ (pvz. Open Food Facts jos nenurodo), o ne 0.
 * Tai skirtingi teiginiai: produktas be baltymų duomenų neturi atrodyti kaip
 * produktas, kuriame baltymų nėra.
 */
export type Nutrients = {
  kcal: number | null;
  proteinG: number | null;
  carbG: number | null;
  fatG: number | null;
};

export const NUTRIENT_KEYS = ['kcal', 'proteinG', 'carbG', 'fatG'] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

export const MIN_GRAMS = 1;
export const MAX_GRAMS = 5000;

export function assertValidGrams(grams: number): void {
  if (!Number.isInteger(grams) || grams < MIN_GRAMS || grams > MAX_GRAMS) {
    throw DomainError.badRequest(
      'invalid_grams',
      `Grams must be a whole number from ${MIN_GRAMS} to ${MAX_GRAMS}.`,
    );
  }
}

/**
 * R1: vertė = round(vertė_100g · gramai / 100). Nežinoma vertė lieka nežinoma.
 */
export function scaleFromPer100g(per100g: Nutrients, grams: number): Nutrients {
  assertValidGrams(grams);
  return mapNutrients(per100g, (v) => Math.round((v * grams) / 100));
}

/** Porcijos vertę perskaičiuoja kitam kiekiui (naudojama tvirtinant AI juodraštį). */
export function rescalePortion(portion: Nutrients, portionGrams: number, grams: number): Nutrients {
  assertValidGrams(grams);
  return mapNutrients(portion, (v) => Math.round((v * grams) / portionGrams));
}

/** Porcijos vertė, paversta 100 g verte (AI įvertinimą įrašant į biblioteką). */
export function toPer100g(portion: Nutrients, portionGrams: number): Nutrients {
  return mapNutrients(portion, (v) => Math.round((v * 100) / portionGrams));
}

function mapNutrients(n: Nutrients, f: (v: number) => number): Nutrients {
  return {
    kcal: n.kcal === null ? null : f(n.kcal),
    proteinG: n.proteinG === null ? null : f(n.proteinG),
    carbG: n.carbG === null ? null : f(n.carbG),
    fatG: n.fatG === null ? null : f(n.fatG),
  };
}
