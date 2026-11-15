import { DomainError } from './errors.ts';
import type { Nutrients } from './nutrients.ts';

/** R2: tik skaitmenys, 6–14 (EAN-8 … GTIN-14). */
const BARCODE = /^[0-9]{6,14}$/;

export const NO_PRODUCT_MESSAGE = 'No product with that barcode';

export function assertValidBarcode(code: string): void {
  if (!BARCODE.test(code)) {
    throw DomainError.badRequest('invalid_barcode', 'A barcode is 6 to 14 digits.');
  }
}

/** Produktas, koks jis grįžta iš išorinio šaltinio: vertės 100 g. */
export type ExternalProduct = {
  barcode: string;
  name: string;
  per100g: Nutrients;
};

/** 1 kcal = 4,184 kJ. */
export const KJ_PER_KCAL = 4.184;

/**
 * Open Food Facts atsakymo `product` objektą paverčia mūsų produktu (R2).
 *
 * - Trūkstama vertė lieka `null`, ne 0.
 * - Jei nurodyti tik kilodžauliai, kcal = kJ / 4,184.
 * - Neigiamos ar ne skaitinės reikšmės laikomos nežinomomis.
 *
 * Grąžina `null`, kai produkto nėra (OFF tai praneša `status: 0`).
 */
export function normalizeOpenFoodFacts(barcode: string, payload: unknown): ExternalProduct | null {
  if (typeof payload !== 'object' || payload === null) {
    throw DomainError.upstream('upstream_invalid', 'The food database sent something unreadable.');
  }
  const body = payload as { status?: unknown; product?: unknown };
  if (body.status === 0 || typeof body.product !== 'object' || body.product === null) return null;

  const product = body.product as Record<string, unknown>;
  const nutriments = (product.nutriments ?? {}) as Record<string, unknown>;
  const name =
    String(product.product_name || product.product_name_en || '').trim().slice(0, 120) ||
    'Unnamed product';

  return {
    barcode,
    name,
    per100g: {
      kcal: kcalPer100g(nutriments),
      proteinG: wholeOrNull(nutriments.proteins_100g),
      carbG: wholeOrNull(nutriments.carbohydrates_100g),
      fatG: wholeOrNull(nutriments.fat_100g),
    },
  };
}

function kcalPer100g(nutriments: Record<string, unknown>): number | null {
  const kcal = wholeOrNull(nutriments['energy-kcal_100g']);
  if (kcal !== null && kcal > 0) return kcal;

  const kj = Number(nutriments['energy-kj_100g'] ?? nutriments['energy_100g']);
  if (Number.isFinite(kj) && kj > 0) return Math.round(kj / KJ_PER_KCAL);

  return kcal; // 0 tik tada, kai OFF aiškiai parašė 0
}

function wholeOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}
