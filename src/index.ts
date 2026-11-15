import { networkInterfaces } from 'node:os';
import { config } from './config.ts';
import { buildApp } from './http/app.ts';
import { openDatabase } from './infra/db.ts';
import { DEMO_TENANTS } from './infra/seed.ts';
import { GeminiEstimator } from './infra/gemini.ts';
import { OpenFoodFactsClient } from './infra/open-food-facts.ts';

const db = openDatabase(config.dbPath);

const estimator = config.gemini.apiKey
  ? new GeminiEstimator({
      apiKey: config.gemini.apiKey,
      models: config.gemini.models,
      attemptTimeoutMs: config.gemini.attemptTimeoutMs,
    })
  : null;

const app = buildApp({ db, productLookup: new OpenFoodFactsClient(), estimator, serveUi: true });

await app.listen({ port: config.port, host: config.host });

console.log(`\nMaisto įrašų prototipas: http://localhost:${config.port}`);
if (config.host === '0.0.0.0') {
  const lanAddresses = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => `http://${a!.address}:${config.port}`);
  console.log(`Telefone (tas pats Wi-Fi): ${lanAddresses.join('  arba  ') || 'IP nerastas'}`);
}
console.log(`Duomenų bazė: ${config.dbPath}`);
console.log(`AI: ${estimator ? `įjungtas (${config.gemini.models.join(' → ')})` : 'išjungtas (nėra GEMINI_API_KEY)'}`);
console.log('Demo klientai (x-api-key):');
for (const t of DEMO_TENANTS) console.log(`  ${t.apiKey.padEnd(14)} ${t.name}`);
