import { z } from 'zod';
import { DomainError } from './errors.ts';
import type { Nutrients } from './nutrients.ts';

/**
 * R3: AI atsakymo patikra.
 *
 * Modelio atsakymas laikomas nepatikima įvestimi: JSON schema, kurią siunčiame
 * modeliui, yra prašymas, o ne garantija. Todėl čia:
 *   1. tekstas turi būti JSON ir atitikti schemą, kitaip klaida 502 (nieko neišsaugoma);
 *   2. neigiamos reikšmės keičiamos minimumu (0, porcija 1 g), o kiekvienas
 *      pakeitimas užrašomas į `corrections`, kad naudotojas jį matytų prieš tvirtindamas;
 *   3. „Not food“ atpažįstamas ir pažymimas.
 * Viršutinių ribų nėra (I etapo sprendimas).
 */
export const aiResponseSchema = z.object({
  name: z.string(),
  kcal: z.number(),
  protein_grams: z.number(),
  carb_grams: z.number(),
  fat_grams: z.number(),
  portion_grams: z.number(),
  confidence: z.enum(['high', 'medium', 'low']),
  note: z.string(),
});

/** Ta pati schema JSON Schema formatu, siunčiama Gemini (`response_format`). */
export const AI_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Short dish name.' },
    kcal: { type: 'integer', minimum: 0 },
    protein_grams: { type: 'integer', minimum: 0 },
    carb_grams: { type: 'integer', minimum: 0 },
    fat_grams: { type: 'integer', minimum: 0 },
    portion_grams: { type: 'integer', minimum: 1, description: 'Weight of the portion shown, in grams.' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    note: { type: 'string', description: 'One short line on what was assumed.' },
  },
  required: ['name', 'kcal', 'protein_grams', 'carb_grams', 'fat_grams', 'portion_grams', 'confidence', 'note'],
} as const;

export type Confidence = 'high' | 'medium' | 'low';

export type Correction = { field: string; from: number; to: number };

export type AiEstimate = {
  name: string;
  /** Vertė visai porcijai (`portionGrams`), ne 100 g. */
  nutrients: Nutrients;
  portionGrams: number;
  confidence: Confidence;
  note: string;
  corrections: Correction[];
  notFood: boolean;
};

export const NOT_FOOD = 'Not food';

export function parseAiResponse(text: string): AiEstimate {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw DomainError.upstream('ai_invalid_response', 'The AI sent something unreadable. Nothing was saved.');
  }
  const parsed = aiResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw DomainError.upstream('ai_invalid_response', 'The AI answer did not match the schema. Nothing was saved.');
  }
  const raw = parsed.data;
  const corrections: Correction[] = [];
  const atLeast = (field: string, value: number, min: number): number => {
    const rounded = Math.round(value);
    if (rounded < min) {
      corrections.push({ field, from: rounded, to: min });
      return min;
    }
    return rounded;
  };

  const name = raw.name.trim().slice(0, 120) || 'Meal';
  return {
    name,
    nutrients: {
      kcal: atLeast('kcal', raw.kcal, 0),
      proteinG: atLeast('proteinG', raw.protein_grams, 0),
      carbG: atLeast('carbG', raw.carb_grams, 0),
      fatG: atLeast('fatG', raw.fat_grams, 0),
    },
    portionGrams: atLeast('portionGrams', raw.portion_grams, 1),
    confidence: raw.confidence,
    note: raw.note.slice(0, 280),
    corrections,
    notFood: name.toLowerCase() === NOT_FOOD.toLowerCase(),
  };
}

// ---------------------------------------------------------------------------
// AI užklausos įvestis
// ---------------------------------------------------------------------------

export const MAX_HINT_CHARS = 280;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export type EstimateRequest = { image?: string; mimeType?: string; hint?: string };

/** Reikia nuotraukos arba teksto; tekstas ≤ 280 simbolių; nuotrauka ≤ 4 MB. */
export function assertValidEstimateRequest(req: EstimateRequest): void {
  const hint = req.hint?.trim() ?? '';
  if (!req.image && !hint) {
    throw DomainError.badRequest('empty_estimate', 'Send a photo, a description, or both.');
  }
  if (hint.length > MAX_HINT_CHARS) {
    throw DomainError.badRequest('hint_too_long', `The description is limited to ${MAX_HINT_CHARS} characters.`);
  }
  if (req.image) {
    if (!req.mimeType) throw DomainError.badRequest('missing_mime', 'A photo needs its mimeType.');
    const bytes = Buffer.byteLength(req.image, 'base64');
    if (bytes > MAX_IMAGE_BYTES) {
      throw new DomainError(413, 'image_too_large', 'The photo must be 4 MB or smaller.');
    }
  }
}
