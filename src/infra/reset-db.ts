import { rmSync } from 'node:fs';
import { config } from '../config.ts';
import { openDatabase } from './db.ts';

/** Ištrina DB ir sukuria iš naujo su pavyzdiniais duomenimis (šiandienos data). */
rmSync(config.dbPath, { force: true });
openDatabase(config.dbPath).close();
console.log(`Duomenų bazė atkurta: ${config.dbPath}`);
