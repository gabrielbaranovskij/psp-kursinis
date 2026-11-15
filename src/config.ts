import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
}

/** `--lan` (npm run phone): serveris pasiekiamas ir iš telefono tame pačiame Wi-Fi. */
const lan = process.argv.includes('--lan');

export const config = {
  port: Number(str('PORT', '3000')),
  host: lan ? '0.0.0.0' : str('HOST', '127.0.0.1'),
  dbPath: str('DB_PATH', 'data/food.db'),
  gemini: {
    apiKey: str('GEMINI_API_KEY', ''),
    models: str('GEMINI_MODELS', 'gemini-3.8-flash,gemini-3.5-flash-lite')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    attemptTimeoutMs: Number(str('GEMINI_ATTEMPT_TIMEOUT_MS', '30000')),
  },
};
