import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseAiResponse } from '../src/core/ai-estimate.ts';
import { assertValidBarcode, normalizeOpenFoodFacts } from '../src/core/barcode.ts';
import { summarizeDay, type MealEntry } from '../src/core/day-summary.ts';
import { confirmDraft, type MealDraft } from '../src/core/draft.ts';
import { DomainError } from '../src/core/errors.ts';
import { scaleFromPer100g } from '../src/core/nutrients.ts';
import { aiJson, DATE } from './fakes.ts';

/** Grynosios logikos testai: be DB, be HTTP, be tinklo. */

describe('R1 – skaičiavimas pagal gramus', () => {
  it('įprastas: 250 kcal, B10 A30 R10 / 100 g × 150 g = 375 kcal, B15 A45 R15', () => {
    assert.deepEqual(scaleFromPer100g({ kcal: 250, proteinG: 10, carbG: 30, fatG: 10 }, 150), {
      kcal: 375,
      proteinG: 15,
      carbG: 45,
      fatG: 15,
    });
  });

  it('nežinoma vertė lieka null, o ne 0', () => {
    const r = scaleFromPer100g({ kcal: 220, proteinG: null, carbG: 41, fatG: 1 }, 50);
    assert.equal(r.proteinG, null);
    assert.equal(r.kcal, 110);
  });

  it('ribinis: 0 g ir trupmeniniai gramai atmetami', () => {
    assert.throws(() => scaleFromPer100g({ kcal: 1, proteinG: 1, carbG: 1, fatG: 1 }, 0), { code: 'invalid_grams' });
    assert.throws(() => scaleFromPer100g({ kcal: 1, proteinG: 1, carbG: 1, fatG: 1 }, 1.5), { code: 'invalid_grams' });
  });
});

describe('R2 – brūkšninis kodas', () => {
  it('ribinis: tik kJ – 1046 kJ / 100 g = 250 kcal / 100 g', () => {
    const p = normalizeOpenFoodFacts('4770000000000', {
      status: 1,
      product: { product_name: 'Sausainiai', nutriments: { 'energy-kj_100g': 1046, carbohydrates_100g: 60 } },
    });
    assert.equal(p?.per100g.kcal, 250);
  });

  it('trūkstamos vertės lieka null (ne 0)', () => {
    const p = normalizeOpenFoodFacts('4770000000000', {
      status: 1,
      product: { product_name: 'X', nutriments: { 'energy-kcal_100g': 100 } },
    });
    assert.deepEqual(p?.per100g, { kcal: 100, proteinG: null, carbG: null, fatG: null });
  });

  it('OFF status 0 reiškia „produkto nėra“', () => {
    assert.equal(normalizeOpenFoodFacts('4000000000000', { status: 0 }), null);
  });

  it('kodas turi būti 6–14 skaitmenų', () => {
    assert.doesNotThrow(() => assertValidBarcode('123456'));
    assert.doesNotThrow(() => assertValidBarcode('12345678901234'));
    assert.throws(() => assertValidBarcode('12345'), { code: 'invalid_barcode' });
    assert.throws(() => assertValidBarcode('123456789012345'), { code: 'invalid_barcode' });
    assert.throws(() => assertValidBarcode('47700abc'), { code: 'invalid_barcode' });
  });
});

describe('R3 – AI atsakymo tikrinimas', () => {
  it('ribinis: kcal −50 ir porcija 0 → kcal 0, porcija 1, pakeitimai užrašomi', () => {
    const e = parseAiResponse(aiJson({ kcal: -50, portion_grams: 0 }));
    assert.equal(e.nutrients.kcal, 0);
    assert.equal(e.portionGrams, 1);
    assert.deepEqual(e.corrections, [
      { field: 'kcal', from: -50, to: 0 },
      { field: 'portionGrams', from: 0, to: 1 },
    ]);
  });

  it('viršutinių ribų nėra: 6000 kcal paliekama', () => {
    assert.equal(parseAiResponse(aiJson({ kcal: 6000 })).nutrients.kcal, 6000);
  });

  it('klaida: nevalidus JSON → 502', () => {
    assert.throws(() => parseAiResponse('{"name": "pica", kcal: '), (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal(err.status, 502);
      assert.equal(err.code, 'ai_invalid_response');
      return true;
    });
  });

  it('klaida: trūksta lauko arba neteisingas tipas → 502', () => {
    const missing = JSON.parse(aiJson()) as Record<string, unknown>;
    delete missing.kcal;
    assert.throws(() => parseAiResponse(JSON.stringify(missing)), { status: 502 });
    assert.throws(() => parseAiResponse(aiJson({ kcal: '420' })), { status: 502 });
    assert.throws(() => parseAiResponse(aiJson({ confidence: 'sure' })), { status: 502 });
  });

  it('„Not food“ atpažįstamas', () => {
    const e = parseAiResponse(aiJson({ name: 'Not food', kcal: 0, protein_grams: 0, carb_grams: 0, fat_grams: 0, confidence: 'low' }));
    assert.equal(e.notFood, true);
  });
});

describe('Juodraščio patvirtinimas', () => {
  const draft = (overrides: Record<string, unknown> = {}): MealDraft => ({
    id: 'd1',
    personId: 'p1',
    date: DATE,
    status: 'pending',
    estimate: parseAiResponse(aiJson(overrides)),
    createdAt: '',
  });

  it('„Not food“ be naudotojo verčių patvirtinti negalima (409)', () => {
    assert.throws(() => confirmDraft(draft({ name: 'Not food' })), { status: 409, code: 'not_food' });
  });

  it('„Not food“ su naudotojo įvestomis vertėmis – galima', () => {
    const meal = confirmDraft(draft({ name: 'Not food' }), {
      name: 'Arbata su medumi',
      grams: 250,
      nutrients: { kcal: 60, proteinG: 0, carbG: 16, fatG: 0 },
    });
    assert.equal(meal.nutrients.kcal, 60);
  });

  it('pakeitus gramus vertės perskaičiuojamos nuo AI porcijos', () => {
    const meal = confirmDraft(draft(), { grams: 150 }); // 300 g → 150 g
    assert.deepEqual(meal.nutrients, { kcal: 210, proteinG: 8, carbG: 30, fatG: 6 });
  });

  it('jau patvirtinto antrą kartą patvirtinti negalima (409)', () => {
    assert.throws(() => confirmDraft({ ...draft(), status: 'confirmed' }), { status: 409 });
  });
});

describe('Dienos suvestinė – trūkstamos vertės', () => {
  const entry = (kcal: number | null, proteinG: number | null): MealEntry => ({
    id: String(Math.random()),
    personId: 'p1',
    date: DATE,
    name: 'x',
    grams: 100,
    nutrients: { kcal, proteinG, carbG: null, fatG: 0 },
    source: 'manual',
    productId: null,
    createdAt: '',
  });

  it('trūkstama vertė nesumuojama kaip 0: suma nepilna, likutis nerodomas', () => {
    const s = summarizeDay(DATE, [entry(375, 15), entry(110, null)], { kcal: 2500, proteinG: 150, carbG: null, fatG: null });
    assert.deepEqual(s.totals.kcal, { value: 485, missingIn: 0, complete: true, goal: 2500, remaining: 2015 });
    assert.deepEqual(s.totals.proteinG, { value: 15, missingIn: 1, complete: false, goal: 150, remaining: null });
  });

  it('kai nežinoma nė viena vertė – null („—“), o ne 0', () => {
    const s = summarizeDay(DATE, [entry(100, 1), entry(50, 2)], null);
    assert.equal(s.totals.carbG.value, null);
    assert.equal(s.totals.carbG.missingIn, 2);
    assert.equal(s.totals.fatG.value, 0); // tikras nulis lieka nuliu
    assert.equal(s.totals.fatG.complete, true);
  });
});
