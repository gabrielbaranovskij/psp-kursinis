import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appFixture, DATE } from './fakes.ts';

/**
 * Klientų duomenų izoliavimas per visą HTTP kelią: kliento B raktu negalima
 * nei perskaityti, nei pakeisti kliento A duomenų (žmonių, įrašų, produktų,
 * AI juodraščių), net žinant jų id.
 */

const A = { 'x-api-key': 'key-a' };
const B = { 'x-api-key': 'key-b' };

async function setup() {
  const fx = appFixture();
  const entry = await fx.app.inject({
    method: 'POST',
    url: `/api/people/${fx.personA}/entries/manual`,
    headers: A,
    payload: { date: DATE, name: 'A sumuštinis', grams: 200, per100g: { kcal: 250, proteinG: 10, carbG: 30, fatG: 10 }, saveToLibrary: true },
  });
  assert.equal(entry.statusCode, 201);
  const draft = await fx.app.inject({
    method: 'POST',
    url: `/api/people/${fx.personA}/estimates`,
    headers: A,
    payload: { date: DATE, hint: 'makaronai' },
  });
  assert.equal(draft.statusCode, 201);
  return { ...fx, entry: entry.json(), draft: draft.json() };
}

describe('Klientų duomenų izoliavimas', () => {
  it('klientas B mato tik savo žmones; A žmogaus duomenų, produktų ir juodraščių nemato', async () => {
    const { app, personA, personB } = await setup();

    const peopleB = (await app.inject({ method: 'GET', url: `/api/people?date=${DATE}`, headers: B })).json();
    assert.deepEqual(peopleB.map((p: { id: string }) => p.id), [personB]);

    const dayOfA = await app.inject({ method: 'GET', url: `/api/people/${personA}/days/${DATE}`, headers: B });
    assert.equal(dayOfA.statusCode, 404);

    const draftsOfA = await app.inject({ method: 'GET', url: `/api/people/${personA}/estimates`, headers: B });
    assert.equal(draftsOfA.statusCode, 404);

    const productsB = (await app.inject({ method: 'GET', url: '/api/products', headers: B })).json();
    assert.deepEqual(productsB, []);

    const peopleA = (await app.inject({ method: 'GET', url: `/api/people?date=${DATE}`, headers: A })).json();
    assert.equal(peopleA.length, 1);
    assert.equal(peopleA[0].totals.kcal.value, 500);
    assert.equal(peopleA[0].pendingDrafts, 1);
  });

  it('klientas B negali keisti A duomenų nei įrašyti A žmogui (404), A duomenys nepakinta', async () => {
    const { app, personA, personB, entry, draft } = await setup();

    const writeForA = await app.inject({
      method: 'POST',
      url: `/api/people/${personA}/entries/manual`,
      headers: B,
      payload: { date: DATE, name: 'Svetimas', grams: 100, per100g: { kcal: 999, proteinG: 0, carbG: 0, fatG: 0 } },
    });
    assert.equal(writeForA.statusCode, 404);

    const goalForA = await app.inject({
      method: 'PUT',
      url: `/api/people/${personA}/goal`,
      headers: B,
      payload: { kcal: 1, proteinG: null, carbG: null, fatG: null },
    });
    assert.equal(goalForA.statusCode, 404);

    const del = await app.inject({ method: 'DELETE', url: `/api/entries/${entry.id}`, headers: B });
    assert.equal(del.statusCode, 404);

    const confirm = await app.inject({ method: 'POST', url: `/api/estimates/${draft.id}/confirm`, headers: B, payload: {} });
    assert.equal(confirm.statusCode, 404);

    const discard = await app.inject({ method: 'POST', url: `/api/estimates/${draft.id}/discard`, headers: B });
    assert.equal(discard.statusCode, 404);

    // A produktas B žmogui irgi nepasiekiamas.
    const useProduct = await app.inject({
      method: 'POST',
      url: `/api/people/${personB}/entries/product`,
      headers: B,
      payload: { date: DATE, productId: entry.productId, grams: 100 },
    });
    assert.equal(useProduct.statusCode, 404);

    const dayA = (await app.inject({ method: 'GET', url: `/api/people/${personA}/days/${DATE}`, headers: A })).json();
    assert.equal(dayA.entryCount, 1);
    assert.equal(dayA.totals.kcal.value, 500);
    assert.equal(dayA.totals.kcal.goal, null);
    assert.equal(dayA.pendingDrafts, 1);
  });

  it('be rakto arba su nežinomu raktu → 401', async () => {
    const { app } = appFixture();
    assert.equal((await app.inject({ method: 'GET', url: '/api/people' })).statusCode, 401);
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/people', headers: { 'x-api-key': 'nope' } })).statusCode,
      401,
    );
  });
});
