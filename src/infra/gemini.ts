import { AI_RESPONSE_JSON_SCHEMA, type EstimateRequest } from '../core/ai-estimate.ts';
import { DomainError } from '../core/errors.ts';
import type { MealEstimator } from '../app/ports.ts';

type Fetch = typeof fetch;

export type GeminiOptions = {
  apiKey: string;
  /** Bandomi iš eilės (R4). */
  models: string[];
  /** Vieno bandymo laikas, numatytai 30 s (R4). */
  attemptTimeoutMs: number;
  fetchImpl?: Fetch;
};

const PHOTO_PROMPT = [
  'Identify the food in this photo and estimate its nutrition for the portion shown.',
  'Assume a normal home serving unless the photo gives a reference for scale.',
  'State the portion you assumed in the note, briefly.',
  'If the photo is not food, use the name "Not food", zero for every number,',
  'confidence "low", and say so in the note.',
].join(' ');

const HINT_PROMPT = [
  'The person who ate this describes it below.',
  'Treat that description as fact and prefer it over what the photo suggests,',
  'especially for portion size, weights, ingredients and how it was cooked.',
].join(' ');

const TEXT_PROMPT = [
  'Estimate the nutrition of the food described below, for the amount described.',
  'Where it states an amount, compute the numbers for that amount; otherwise assume a normal home serving.',
  'State the portion you assumed in the note, briefly.',
  'If the description is not food, use the name "Not food", zero for every number,',
  'confidence "low", and say so in the note.',
].join(' ');

type GeminiInput = { type: 'text'; text: string } | { type: 'image'; data: string; mime_type: string };

/**
 * Google Gemini adapteris su R4 logika: kiekvienas modelis bandomas iki
 * `attemptTimeoutMs`; nepavykus (laikas, 5xx, kvota, nepasiekiamas) bandomas
 * kitas. Jei nepavyko nė vienas – DomainError(502), o kviečiantis kodas nieko
 * neišsaugo. Netinkamas raktas (401/403) nutraukia iš karto: jis bendras visiems modeliams.
 *
 * Grąžina žalią tekstą – jo tikrinimas (R3) yra core/ai-estimate.ts.
 */
export class GeminiEstimator implements MealEstimator {
  private readonly fetchImpl: Fetch;

  constructor(private readonly options: GeminiOptions) {
    if (options.models.length === 0) throw new Error('At least one Gemini model is required.');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async estimate(request: EstimateRequest): Promise<string> {
    const input = buildInput(request);
    for (const model of this.options.models) {
      try {
        return await this.callModel(model, input);
      } catch (err) {
        if (err instanceof DomainError && err.code === 'ai_auth') throw err;
        // kitas modelis
      }
    }
    throw DomainError.upstream('ai_unavailable', 'The AI is unavailable right now. Nothing was saved.');
  }

  private async callModel(model: string, input: GeminiInput[]): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'x-goog-api-key': this.options.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          input,
          response_format: { type: 'text', mime_type: 'application/json', schema: AI_RESPONSE_JSON_SCHEMA },
        }),
        signal: AbortSignal.timeout(this.options.attemptTimeoutMs),
      });
    } catch {
      throw DomainError.upstream('ai_attempt_failed', `${model} did not answer in time.`);
    }

    if (response.status === 401 || response.status === 403) {
      throw DomainError.upstream('ai_auth', "The AI rejected this server's key. Check GEMINI_API_KEY.");
    }
    if (!response.ok) {
      throw DomainError.upstream('ai_attempt_failed', `${model} answered ${response.status}.`);
    }
    const payload = await response.json().catch(() => null);
    return outputText(payload);
  }
}

function buildInput({ image, mimeType, hint }: EstimateRequest): GeminiInput[] {
  if (!image) return [{ type: 'text', text: `${TEXT_PROMPT}\n\nDescription: ${hint ?? ''}` }];
  return [
    { type: 'text', text: hint ? `${PHOTO_PROMPT} ${HINT_PROMPT}\n\nDescription: ${hint}` : PHOTO_PROMPT },
    { type: 'image', data: image, mime_type: mimeType ?? 'image/jpeg' },
  ];
}

/** Modelio tekstas iš Interactions API atsakymo (`steps[].content[].text`). */
export function outputText(payload: unknown): string {
  const steps = (payload as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps)) return '';
  const chunks: string[] = [];
  for (const step of steps) {
    const s = step as { type?: string; content?: unknown };
    if (s.type !== 'model_output' || !Array.isArray(s.content)) continue;
    for (const part of s.content) {
      const p = part as { type?: string; text?: unknown };
      if (p.type === 'text' && typeof p.text === 'string') chunks.push(p.text);
    }
  }
  return chunks.join('');
}
