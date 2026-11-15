import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { MealEntryService } from '../app/meal-entry-service.ts';
import type { MealEstimator, ProductLookup } from '../app/ports.ts';
import { DomainError } from '../core/errors.ts';
import { MAX_GRAMS, MIN_GRAMS } from '../core/nutrients.ts';
import { findTenantByApiKey, type Tenant } from '../infra/db.ts';
import { SqliteTenantRepository } from '../infra/sqlite-repository.ts';

/**
 * HTTP sluoksnis: tik užklausų skaitymas, kliento nustatymas ir atsakymai.
 * Jokios verslo logikos – ji MealEntryService ir src/core.
 */
export type AppDeps = {
  db: DatabaseSync;
  productLookup: ProductLookup;
  estimator: MealEstimator | null;
  /** Ar tiekti public/ (UI). Testuose nereikia. */
  serveUi?: boolean;
};

// -- Užklausų schemos ---------------------------------------------------------

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
const grams = z.number().int().min(MIN_GRAMS).max(MAX_GRAMS);
const amount = z.number().int().min(0).nullable();
const nutrients = z.object({ kcal: amount, proteinG: amount, carbG: amount, fatG: amount });

const manualBody = z.object({
  date,
  name: z.string().trim().min(1).max(120),
  grams,
  per100g: nutrients,
  saveToLibrary: z.boolean().optional(),
});
const productBody = z.object({ date, productId: z.string().min(1), grams });
const barcodeBody = z.object({ date, barcode: z.string(), grams });
const estimateBody = z.object({
  date,
  image: z.string().min(1).optional(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']).optional(),
  hint: z.string().optional(),
});
const confirmBody = z
  .object({ name: z.string().trim().max(120).optional(), grams: grams.optional(), nutrients: nutrients.optional() })
  .default({});
const personBody = z.object({ name: z.string().trim().min(1).max(80), goal: nutrients.optional() });

// -----------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyRequest {
    tenant: Tenant;
  }
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof DomainError) {
      return reply.status(err.status).send({ error: err.code, message: err.message });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'invalid_request', message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: 'invalid_request', message: (err as Error).message });
    }
    console.error(err);
    return reply.status(500).send({ error: 'internal', message: 'Something went wrong.' });
  });

  if (deps.serveUi) {
    const root = join(import.meta.dirname, '..', '..');
    app.register(fastifyStatic, { root: join(root, 'public') });
    // Brūkšninių kodų dekoderis naršyklei (ZXing), pateikiamas iš node_modules – be CDN.
    app.register(fastifyStatic, {
      root: join(root, 'node_modules', '@zxing', 'library', 'umd'),
      prefix: '/vendor/zxing/',
      decorateReply: false,
    });
  }

  app.register(async (api) => {
    /**
     * Kliento nustatymas: kiekviena /api užklausa turi `x-api-key`. Iš jo
     * randamas klientas, o servisas gauna tik to kliento saugyklą.
     */
    api.addHook('onRequest', async (request) => {
      const key = request.headers['x-api-key'];
      const tenant = typeof key === 'string' ? findTenantByApiKey(deps.db, key) : null;
      if (!tenant) throw new DomainError(401, 'unauthorized', 'Send a valid x-api-key header.');
      request.tenant = tenant;
    });

    const service = (request: FastifyRequest) =>
      new MealEntryService(
        new SqliteTenantRepository(deps.db, request.tenant.id),
        deps.productLookup,
        deps.estimator,
      );
    const param = (request: FastifyRequest, name: string) => (request.params as Record<string, string>)[name]!;

    api.get('/tenant', async (request) => request.tenant);

    // Kliento žmonės ir jų dienos apžvalga ---------------------------------------

    api.get('/people', async (request) => {
      const q = request.query as { date?: string };
      return service(request).overview(date.parse(q.date ?? new Date().toISOString().slice(0, 10)));
    });

    api.post('/people', async (request, reply) => {
      const person = service(request).addPerson(personBody.parse(request.body));
      return reply.status(201).send(person);
    });

    api.get('/people/:personId/days/:date', async (request) =>
      service(request).daySummary(param(request, 'personId'), date.parse(param(request, 'date'))),
    );

    api.put('/people/:personId/goal', async (request) => {
      service(request).setGoal(param(request, 'personId'), nutrients.parse(request.body));
      return { ok: true };
    });

    // Trys įrašymo būdai --------------------------------------------------------

    api.post('/people/:personId/entries/manual', async (request, reply) => {
      const entry = service(request).addManual({ personId: param(request, 'personId'), ...manualBody.parse(request.body) });
      return reply.status(201).send(entry);
    });

    api.post('/people/:personId/entries/product', async (request, reply) => {
      const entry = service(request).addFromProduct({ personId: param(request, 'personId'), ...productBody.parse(request.body) });
      return reply.status(201).send(entry);
    });

    api.post('/people/:personId/entries/barcode', async (request, reply) => {
      const entry = await service(request).addFromBarcode({ personId: param(request, 'personId'), ...barcodeBody.parse(request.body) });
      return reply.status(201).send(entry);
    });

    api.delete('/entries/:id', async (request) => {
      service(request).deleteEntry(param(request, 'id'));
      return { ok: true };
    });

    // Biblioteka ir brūkšninis kodas (bendra visam klientui) ---------------------

    api.get('/products', async (request) => service(request).listProducts());

    api.get('/barcode/:code', async (request) => service(request).findByBarcode(param(request, 'code')));

    // AI: juodraštis -> patvirtinimas arba atmetimas ------------------------------

    api.post('/people/:personId/estimates', async (request, reply) => {
      const draft = await service(request).estimate({ personId: param(request, 'personId'), ...estimateBody.parse(request.body) });
      return reply.status(201).send(draft);
    });

    api.get('/people/:personId/estimates', async (request) => {
      const q = request.query as { date?: string };
      return service(request).listPendingDrafts(param(request, 'personId'), q.date ? date.parse(q.date) : undefined);
    });

    api.post('/estimates/:id/confirm', async (request, reply) => {
      const edits = confirmBody.parse(request.body ?? {});
      const entry = service(request).confirmDraft(param(request, 'id'), edits);
      return reply.status(201).send(entry);
    });

    api.post('/estimates/:id/discard', async (request) => {
      service(request).discardDraft(param(request, 'id'));
      return { ok: true };
    });
  }, { prefix: '/api' });

  return app;
}
