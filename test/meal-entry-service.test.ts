import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aiJson, DATE, FakeEstimator, FakeProductLookup, serviceFixture, unavailable } from './fakes.ts';

/**
 * Pagrindinio modulio („Valgio įrašo sudarymas“) testai su tikra SQLite (atmintyje)
 * ir imituotomis išorinėmis paslaugomis. Kiekvienas tikrina ir dienos sumą.
 */

type Fixture = ReturnType<typeof serviceFixture>;
const kcalOfDay = (f: Fixture) => f.service.daySummary(f.personId, DATE).totals.kcal.value ?? 0;

describe('Įprastas atvejis', () => {
  it('bibliotekos produktas 250 kcal/100 g × 150 g → įrašas 375 kcal, B15 A45 R15; dienos suma +375', () => {
    const f = serviceFixture();
    const p = f.repo.insertProduct({
      name: 'Grikių košė',
      barcode: null,
      per100g: { kcal: 250, proteinG: 10, carbG: 30, fatG: 10 },
      source: 'manual',
    });
    const before = kcalOfDay(f);

    const entry = f.service.addFromProduct({ personId: f.personId, date: DATE, productId: p.id, grams: 150 });

    assert.deepEqual(entry.nutrients, { kcal: 375, proteinG: 15, carbG: 45, fatG: 15 });
    assert.equal(entry.source, 'manual');
    assert.equal(kcalOfDay(f) - before, 375);
  });

  it('brūkšninis kodas: pirmiausia vietinė biblioteka, internetas nekviečiamas', async () => {
    const lookup = new FakeProductLookup();
    const f = serviceFixture({ lookup });
    f.repo.insertProduct({
      name: 'Jogurtas',
      barcode: '4770000000017',
      per100g: { kcal: 80, proteinG: 7, carbG: 4, fatG: 4 },
      source: 'barcode',
    });
    const entry = await f.service.addFromBarcode({ personId: f.personId, date: DATE, barcode: '4770000000017', grams: 200 });
    assert.equal(entry.nutrients.kcal, 160);
    assert.equal(entry.source, 'barcode');
    assert.equal(lookup.calls, 0);
  });

  it('brūkšninis kodas iš interneto (tik kJ) išsaugomas bibliotekoje ir įrašomas', async () => {
    const lookup = new FakeProductLookup({
      '5449000000996': {
        barcode: '5449000000996',
        name: 'Sausainiai',
        per100g: { kcal: 250, proteinG: null, carbG: 60, fatG: 8 },
      },
    });
    const f = serviceFixture({ lookup });
    const entry = await f.service.addFromBarcode({ personId: f.personId, date: DATE, barcode: '5449000000996', grams: 40 });
    assert.deepEqual(entry.nutrients, { kcal: 100, proteinG: null, carbG: 24, fatG: 3 });
    assert.ok(f.service.listProducts().some((p) => p.barcode === '5449000000996'));
  });
});

describe('AI: įtaka dienos sumai tik po patvirtinimo', () => {
  it('ribinis: neigiama reikšmė pataisoma, įrašas laukia patvirtinimo; suma keičiasi tik patvirtinus', async () => {
    const f = serviceFixture({ estimator: new FakeEstimator(aiJson({ kcal: 420, protein_grams: -5 })) });
    const before = kcalOfDay(f);

    const draft = await f.service.estimate({ personId: f.personId, date: DATE, hint: '300 g makaronų su sūriu' });

    assert.equal(draft.status, 'pending');
    assert.equal(draft.estimate.nutrients.proteinG, 0);
    assert.deepEqual(draft.estimate.corrections, [{ field: 'proteinG', from: -5, to: 0 }]);
    assert.equal(kcalOfDay(f), before, 'nepatvirtintas AI įvertinimas dienos sumos nekeičia');
    assert.equal(f.service.daySummary(f.personId, DATE).pendingDrafts, 1);

    const entry = f.service.confirmDraft(draft.id);
    assert.equal(entry.source, 'ai');
    assert.equal(kcalOfDay(f), before + 420);
    assert.equal(f.service.daySummary(f.personId, DATE).pendingDrafts, 0);
  });

  it('atmestas AI įvertinimas dienos sumos nekeičia', async () => {
    const f = serviceFixture({ estimator: new FakeEstimator(aiJson()) });
    const draft = await f.service.estimate({ personId: f.personId, date: DATE, hint: 'makaronai' });
    f.service.discardDraft(draft.id);
    assert.equal(kcalOfDay(f), 0);
    assert.throws(() => f.service.confirmDraft(draft.id), { status: 409 });
  });

  it('konfliktas: „Not food“ be verčių nepatvirtinamas (409), suma nepakinta', async () => {
    const notFood = aiJson({ name: 'Not food', kcal: 0, protein_grams: 0, carb_grams: 0, fat_grams: 0, confidence: 'low' });
    const f = serviceFixture({ estimator: new FakeEstimator(notFood) });
    const draft = await f.service.estimate({ personId: f.personId, date: DATE, image: 'aGVsbG8=', mimeType: 'image/jpeg' });

    assert.equal(draft.estimate.notFood, true);
    assert.throws(() => f.service.confirmDraft(draft.id), { status: 409, code: 'not_food' });
    assert.equal(f.service.daySummary(f.personId, DATE).entryCount, 0);
  });
});

describe('Klaidos – įrašas nesukuriamas', () => {
  it('nėra produkto: kodas 4000000000000 → 404 „No product with that barcode“', async () => {
    const f = serviceFixture({ lookup: new FakeProductLookup() });
    await assert.rejects(f.service.addFromBarcode({ personId: f.personId, date: DATE, barcode: '4000000000000', grams: 100 }), {
      status: 404,
      message: 'No product with that barcode',
    });
    assert.equal(f.service.daySummary(f.personId, DATE).entryCount, 0);
    assert.equal(f.service.listProducts().length, 0);
  });

  it('AI nepasiekiamas → 502, nesukuriamas nei juodraštis, nei įrašas', async () => {
    const f = serviceFixture({ estimator: new FakeEstimator(unavailable) });
    await assert.rejects(f.service.estimate({ personId: f.personId, date: DATE, hint: 'sriuba' }), { status: 502, code: 'ai_unavailable' });
    assert.equal(f.service.listPendingDrafts(f.personId).length, 0);
    assert.equal(f.service.daySummary(f.personId, DATE).entryCount, 0);
  });

  it('AI grąžina nevalidų JSON → 502, niekas neišsaugoma', async () => {
    const f = serviceFixture({ estimator: new FakeEstimator('Sorry, I cannot help with that.') });
    await assert.rejects(f.service.estimate({ personId: f.personId, date: DATE, hint: 'sriuba' }), { status: 502, code: 'ai_invalid_response' });
    assert.equal(f.service.listPendingDrafts(f.personId).length, 0);
  });

  it('be nuotraukos ir teksto, arba tekstas > 280 simbolių → 400, AI nekviečiamas', async () => {
    const estimator = new FakeEstimator(aiJson());
    const f = serviceFixture({ estimator });
    await assert.rejects(f.service.estimate({ personId: f.personId, date: DATE }), { status: 400 });
    await assert.rejects(f.service.estimate({ personId: f.personId, date: DATE, hint: 'x'.repeat(281) }), { status: 400 });
    assert.equal(estimator.calls, 0);
  });
});

describe('Trūkstamos vertės dienos suvestinėje', () => {
  it('produktas be baltymų: baltymų suma pažymima kaip nepilna, o ne 0', () => {
    const f = serviceFixture();
    const bread = f.repo.insertProduct({
      name: 'Duona',
      barcode: null,
      per100g: { kcal: 220, proteinG: null, carbG: 41, fatG: 1 },
      source: 'barcode',
    });
    f.service.addFromProduct({ personId: f.personId, date: DATE, productId: bread.id, grams: 50 });

    const protein = f.service.daySummary(f.personId, DATE).totals.proteinG;
    assert.equal(protein.value, null);
    assert.equal(protein.missingIn, 1);
    assert.equal(protein.complete, false);
  });
});

describe('Žmonės kliento viduje', () => {
  it('įrašai ir dienos suma skaičiuojami kiekvienam žmogui atskirai; apžvalgoje matomi visi kliento žmonės', () => {
    const f = serviceFixture();
    const ona = f.service.addPerson({ name: 'Ona', goal: { kcal: 1800, proteinG: null, carbG: null, fatG: null } });
    const p = f.repo.insertProduct({ name: 'Košė', barcode: null, per100g: { kcal: 250, proteinG: 10, carbG: 30, fatG: 10 }, source: 'manual' });

    f.service.addFromProduct({ personId: f.personId, date: DATE, productId: p.id, grams: 150 });
    f.service.addFromProduct({ personId: ona.id, date: DATE, productId: p.id, grams: 100 });

    assert.equal(f.service.daySummary(f.personId, DATE).totals.kcal.value, 375);
    assert.equal(f.service.daySummary(ona.id, DATE).totals.kcal.value, 250);

    const overview = f.service.overview(DATE);
    assert.deepEqual(
      overview.map((o) => [o.name, o.totals.kcal.value, o.totals.kcal.remaining]),
      [['Jonas', 375, null], ['Ona', 250, 1550]],
    );
  });

  it('nežinomas žmogus → 404, įrašas nesukuriamas', () => {
    const f = serviceFixture();
    assert.throws(
      () => f.service.addManual({ personId: 'nera', date: DATE, name: 'x', grams: 100, per100g: { kcal: 1, proteinG: 1, carbG: 1, fatG: 1 } }),
      { status: 404, code: 'person_not_found' },
    );
  });
});
