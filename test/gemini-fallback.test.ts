import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GeminiEstimator } from '../src/infra/gemini.ts';
import { aiJson } from './fakes.ts';

/** R4: modelio gedimas → bandomas kitas; nepavykus visiems – klaida. */

const ok = (text: string) =>
  new Response(JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'text', text }] }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

function recordingFetch(handler: (model: string, signal: AbortSignal) => Promise<Response>) {
  const models: string[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    const model = (JSON.parse(String(init.body)) as { model: string }).model;
    models.push(model);
    return handler(model, init.signal as AbortSignal);
  }) as unknown as typeof fetch;
  return { impl, models };
}

describe('R4 – AI iškvietimo gedimai', () => {
  it('pirmas modelis grąžina 503 → atsakymas gaunamas iš antro', async () => {
    const f = recordingFetch(async (model) => (model === 'm1' ? new Response('busy', { status: 503 }) : ok(aiJson())));
    const estimator = new GeminiEstimator({ apiKey: 'k', models: ['m1', 'm2'], attemptTimeoutMs: 1000, fetchImpl: f.impl });

    const text = await estimator.estimate({ hint: 'sriuba' });

    assert.equal(JSON.parse(text).kcal, 420);
    assert.deepEqual(f.models, ['m1', 'm2']);
  });

  it('modelis neatsako per bandymo laiką → bandomas kitas', async () => {
    const f = recordingFetch((model, signal) =>
      model === 'slow'
        ? new Promise((_resolve, reject) => {
            // AbortSignal.timeout laikmatis neišlaiko proceso gyvo, todėl laikome jį patys.
            const keepAlive = setTimeout(() => {}, 5_000);
            signal.addEventListener('abort', () => {
              clearTimeout(keepAlive);
              reject(signal.reason);
            });
          })
        : Promise.resolve(ok(aiJson())),
    );
    const estimator = new GeminiEstimator({ apiKey: 'k', models: ['slow', 'fast'], attemptTimeoutMs: 50, fetchImpl: f.impl });
    assert.equal(JSON.parse(await estimator.estimate({ hint: 'x' })).kcal, 420);
    assert.deepEqual(f.models, ['slow', 'fast']);
  });

  it('visi modeliai nepasiekiami → 502 ai_unavailable', async () => {
    const f = recordingFetch(async () => {
      throw new TypeError('fetch failed');
    });
    const estimator = new GeminiEstimator({ apiKey: 'k', models: ['m1', 'm2', 'm3'], attemptTimeoutMs: 50, fetchImpl: f.impl });
    await assert.rejects(estimator.estimate({ hint: 'x' }), { status: 502, code: 'ai_unavailable' });
    assert.deepEqual(f.models, ['m1', 'm2', 'm3']);
  });

  it('netinkamas raktas (401) → iš karto klaida, kiti modeliai nebandomi', async () => {
    const f = recordingFetch(async () => new Response('denied', { status: 401 }));
    const estimator = new GeminiEstimator({ apiKey: 'bad', models: ['m1', 'm2'], attemptTimeoutMs: 50, fetchImpl: f.impl });
    await assert.rejects(estimator.estimate({ hint: 'x' }), { code: 'ai_auth' });
    assert.deepEqual(f.models, ['m1']);
  });
});
