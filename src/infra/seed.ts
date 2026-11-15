import type { DatabaseSync } from 'node:sqlite';
import { SqliteTenantRepository } from './sqlite-repository.ts';

/**
 * Pavyzdiniai duomenys: du klientai – dietologų kabinetai, kurie sistemą naudoja
 * savo pacientų mitybai sekti. Kiekvienas turi savo pacientus, bendrą produktų
 * biblioteką ir šios dienos įrašus. API raktai skirti tik demonstracijai.
 */
export const DEMO_TENANTS = [
  { id: 't-balansas', name: 'Dietologų kabinetas „Balansas“', apiKey: 'demo-balansas' },
  { id: 't-nutriplan', name: 'Mitybos centras „NutriPlan“', apiKey: 'demo-nutriplan' },
] as const;

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function seed(db: DatabaseSync): void {
  const insertTenant = db.prepare('INSERT INTO tenants (id, name, api_key) VALUES (?, ?, ?)');
  for (const t of DEMO_TENANTS) insertTenant.run(t.id, t.name, t.apiKey);

  const date = today();

  // -- „Balansas“ ---------------------------------------------------------------
  const a = new SqliteTenantRepository(db, 't-balansas');
  const porridge = a.insertProduct({
    name: 'Grikių košė su vištiena',
    barcode: null,
    per100g: { kcal: 250, proteinG: 10, carbG: 30, fatG: 10 },
    source: 'manual',
  });
  const yogurt = a.insertProduct({
    name: 'Graikiškas jogurtas',
    barcode: '4770000000017',
    per100g: { kcal: 80, proteinG: 7, carbG: 4, fatG: 4 },
    source: 'barcode',
  });
  // Produktas be baltymų duomenų: rodo, kad trūkstama vertė ≠ 0.
  const bread = a.insertProduct({
    name: 'Ruginė duona (be baltymų duomenų)',
    barcode: '4770000000024',
    per100g: { kcal: 220, proteinG: null, carbG: 41, fatG: 1 },
    source: 'barcode',
  });
  const apple = a.insertProduct({
    name: 'Obuolys',
    barcode: null,
    per100g: { kcal: 52, proteinG: 0, carbG: 14, fatG: 0 },
    source: 'manual',
  });

  const jonas = a.insertPerson('Jonas Petraitis');
  a.setGoal(jonas.id, { kcal: 2500, proteinG: 150, carbG: 300, fatG: 80 });
  a.insertEntry({
    personId: jonas.id,
    date,
    name: porridge.name,
    grams: 150,
    nutrients: { kcal: 375, proteinG: 15, carbG: 45, fatG: 15 },
    source: 'manual',
    productId: porridge.id,
  });
  a.insertEntry({
    personId: jonas.id,
    date,
    name: bread.name,
    grams: 50,
    nutrients: { kcal: 110, proteinG: null, carbG: 21, fatG: 1 },
    source: 'barcode',
    productId: bread.id,
  });

  const ona = a.insertPerson('Ona Kazlauskienė');
  a.setGoal(ona.id, { kcal: 1800, proteinG: 90, carbG: null, fatG: null });
  a.insertEntry({
    personId: ona.id,
    date,
    name: yogurt.name,
    grams: 200,
    nutrients: { kcal: 160, proteinG: 14, carbG: 8, fatG: 8 },
    source: 'barcode',
    productId: yogurt.id,
  });
  a.insertEntry({
    personId: ona.id,
    date,
    name: apple.name,
    grams: 180,
    nutrients: { kcal: 94, proteinG: 0, carbG: 25, fatG: 0 },
    source: 'manual',
    productId: apple.id,
  });

  a.insertPerson('Lukas Stankevičius'); // dar be tikslo ir įrašų

  // -- „NutriPlan“ ----------------------------------------------------------------
  const b = new SqliteTenantRepository(db, 't-nutriplan');
  const chicken = b.insertProduct({
    name: 'Vištienos krūtinėlė (kepta)',
    barcode: null,
    per100g: { kcal: 165, proteinG: 31, carbG: 0, fatG: 4 },
    source: 'manual',
  });
  const rice = b.insertProduct({
    name: 'Ryžiai (virti)',
    barcode: null,
    per100g: { kcal: 130, proteinG: 3, carbG: 28, fatG: 0 },
    source: 'manual',
  });

  const tomas = b.insertPerson('Tomas Jankauskas');
  b.setGoal(tomas.id, { kcal: 3000, proteinG: 180, carbG: 350, fatG: 90 });
  b.insertEntry({
    personId: tomas.id,
    date,
    name: chicken.name,
    grams: 200,
    nutrients: { kcal: 330, proteinG: 62, carbG: 0, fatG: 8 },
    source: 'manual',
    productId: chicken.id,
  });
  b.insertEntry({
    personId: tomas.id,
    date,
    name: rice.name,
    grams: 250,
    nutrients: { kcal: 325, proteinG: 8, carbG: 70, fatG: 0 },
    source: 'manual',
    productId: rice.id,
  });

  const ruta = b.insertPerson('Rūta Vaitkutė');
  b.setGoal(ruta.id, { kcal: 2000, proteinG: 100, carbG: null, fatG: null });
}
