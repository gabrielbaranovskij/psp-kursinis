# Maisto sekimas: valgio įrašo sudarymas (PSP kursinis, II etapas)

Veikiantis pagrindinio modulio „Valgio įrašo sudarymas“ prototipas. Sistemą kaip
SaaS naudoja **dietologų kabinetai (klientai, tenants)**, kurie seka savo **pacientų**
mitybą. Pacientui valgį galima įrašyti ranka, iš bibliotekos, pagal brūkšninį kodą (Open Food Facts) arba pagal
nuotrauką ir (ar) tekstą (Google Gemini). Sistema apskaičiuoja dienos sumą ir likutį
iki tikslo. Projektavimo dokumentas: [projektavimo-dokumentas.md](projektavimo-dokumentas.md).

## Reikalingi įrankiai

| Įrankis | Versija |
|---|---|
| Node.js | **22.13 arba naujesnė** (naudojamas įtaisytas `node:sqlite`) |
| npm | 10+ (kartu su Node) |

Duomenų bazės diegti nereikia: SQLite failas sukuriamas automatiškai.

## Paleidimas

```bash
npm install           # vieną kartą
cp .env.example .env  # Windows: copy .env.example .env  (neprivaloma, žr. žemiau)
npm start             # paleidžia prototipą viena komanda
```

Atsidarykite **http://localhost:3000**. Pirmo paleidimo metu sukuriama `data/food.db`
su pavyzdiniais duomenimis. `npm run reset-db` atkuria juos iš naujo (šiandienos data).

### Demonstracija telefonu

```bash
npm run phone
```

Serveris pasiekiamas tame pačiame Wi-Fi tinkle. Konsolėje atspausdinamas adresas, pvz.
`http://192.168.1.23:3000`: jį atidarykite telefone. Windows pirmą kartą paklaus, ar leisti
Node.js prieigą prie tinklo, tad leiskite **privačiam** tinklui.

„📷 Skenuoti kamera“ atidaro telefono kamerą: nufotografavus brūkšninį kodą, jis
nuskaitomas naršyklėje (įtaisytas `BarcodeDetector` arba ZXing biblioteka) ir produktas
iškart ieškomas. Tas pats veikia ir AI nuotraukai. Gyvam kameros vaizdui naršyklėje
reikėtų HTTPS, todėl naudojamas nuotraukos režimas, kuris veikia ir per paprastą `http`.

### Konfigūracija (`.env`)

| Kintamasis | Numatyta | Paskirtis |
|---|---|---|
| `PORT` | `3000` | serverio prievadas |
| `HOST` | `127.0.0.1` | `0.0.0.0` – pasiekiama tinkle (`npm run phone` tai nustato pats) |
| `DB_PATH` | `data/food.db` | SQLite failas |
| `GEMINI_API_KEY` | – | Gemini raktas ([aistudio.google.com/apikey](https://aistudio.google.com/apikey)). Be jo AI įvertinimas grąžina 503, visa kita veikia |
| `GEMINI_MODELS` | `gemini-3.8-flash,gemini-3.5-flash-lite` | modeliai bandomi iš eilės (R4) |
| `GEMINI_ATTEMPT_TIMEOUT_MS` | `30000` | vieno bandymo laikas (R4) |

Tikrų raktų repozitorijoje nėra; `.env` įtrauktas į `.gitignore`.

## Testai

```bash
npm test        # 38 testai, AI ir Open Food Facts imituojami, tinklo nereikia
npm run typecheck
```

| Failas | Kas tikrinama |
|---|---|
| `test/core.test.ts` | R1–R3, juodraščio patvirtinimas, trūkstamos vertės suvestinėje (gryna logika) |
| `test/meal-entry-service.test.ts` | pagrindinis modulis su SQLite: įprastas, ribinis/konfliktinis ir klaidos atvejai, įtaka dienos sumai, sumos atskirai kiekvienam pacientui |
| `test/gemini-fallback.test.ts` | R4: kitas modelis po 503 / laiko viršijimo, visi nepasiekiami, netinkamas raktas |
| `test/tenant-isolation.test.ts` | klientų izoliavimas per visą HTTP kelią |

Svarbiausi scenarijai iš I etapo:

| Scenarijus | Testas |
|---|---|
| Įprastas: 250 kcal / 100 g × 150 g → 375 kcal, B 15, A 45, R 15, dienos suma +375 | `meal-entry-service` › Įprastas atvejis |
| Ribinis: AI grąžina neigiamą reikšmę → pataisoma, laukia patvirtinimo, suma keičiasi tik patvirtinus | `meal-entry-service` › AI: įtaka dienos sumai |
| Ribinis: tik kJ (1046 kJ) → 250 kcal | `core` › R2 |
| Konfliktas: „Not food“ be verčių nepatvirtinamas (409) | `meal-entry-service` › AI |
| Klaida: kodas 4000000000000 → „No product with that barcode“, įrašas nesukuriamas | `meal-entry-service` › Klaidos |
| Klaida: AI nepasiekiamas → 502, nieko neišsaugoma | `meal-entry-service` › Klaidos, `gemini-fallback` |
| Izoliavimas: kabinetas B nemato A pacientų ir negali skaityti, keisti ar įrašyti jų duomenų | `tenant-isolation` |

## Pavyzdiniai duomenys ir klientai

Klientas (kabinetas) nustatomas pagal `x-api-key` antraštę (UI viršuje – pasirinkimas).
Kabinetas turi savo pacientus ir bendrą produktų biblioteką; valgio įrašai, AI
juodraščiai ir dienos tikslai priklauso pacientui.

| Klientas | `x-api-key` | Pacientai | Biblioteka |
|---|---|---|---|
| Dietologų kabinetas „Balansas“ | `demo-balansas` | Jonas Petraitis (2500 kcal, 2 įrašai, vienam trūksta baltymų), Ona Kazlauskienė (1800 kcal, 2 įrašai), Lukas Stankevičius (be tikslo) | košė 250 kcal/100 g, jogurtas (kodas `4770000000017`), duona **be baltymų duomenų** (kodas `4770000000024`), obuolys |
| Mitybos centras „NutriPlan“ | `demo-nutriplan` | Tomas Jankauskas (3000 kcal, 2 įrašai), Rūta Vaitkutė (2000 kcal) | vištiena, ryžiai |

## Demonstravimo žingsniai

1. `npm start` (arba `npm run phone`), atidaryti http://localhost:3000, klientas „Balansas“. Viršuje – **kabineto pacientų lentelė**: kiekvieno dienos kcal, tikslas, likutis, įrašai, laukiantys patvirtinimo ir kurių duomenų trūksta. Paspaudus pacientą, žemiau dirbama su juo.
2. **Įprastas scenarijus:** pacientas Jonas → „Iš bibliotekos“ → *Grikių košė su vištiena*, 150 g → įrašas 375 kcal; Jono dienos suma (ir eilutė lentelėje) padidėja 375.
3. **Trūkstamos vertės:** Jono suvestinėje baltymai rodomi kaip „≥ 15 g, trūksta 1 įraš.“, duonos eilutėje baltymai „—“ (ne 0), likutis baltymams nerodomas; lentelėje stulpelyje „Trūksta duomenų“ – „baltymai“.
4. **Brūkšninis kodas:** telefone „📷 Skenuoti kamera“ ir nufotografuoti tikrą pakuotę, arba įvesti ranka: `4770000000017` (randamas vietinėje bibliotekoje); tikras kodas, pvz. `5449000000996`, ieškomas Open Food Facts; `4000000000000` → „No product with that barcode“, įrašas nesukuriamas.
5. **AI (tikra integracija, reikia `GEMINI_API_KEY`):** nufotografuoti valgį ar parašyti „200 g makaronų su sūriu“ → atsiranda „Laukia patvirtinimo“, dienos suma **nepasikeičia**; „Patvirtinti“ (galima pakeisti gramus) → suma padidėja; „Atmesti“ → nieko neįrašoma. Ne maisto nuotrauka → „Not food“, patvirtinti galima tik įvedus vertes.
6. **Klaida:** su `GEMINI_MODELS=neegzistuojantis-modelis` arba be interneto AI grąžina klaidą, juodraštis nesukuriamas.
7. **Klientų atskyrimas:** perjungti į „NutriPlan“ – matomi tik Tomas ir Rūta, kita biblioteka. API lygiu:
   ```bash
   curl http://localhost:3000/api/people/<Jono id>/days/2026-11-16 -H "x-api-key: demo-nutriplan"   # → 404
   curl -X DELETE http://localhost:3000/api/entries/<Jono įrašo id> -H "x-api-key: demo-nutriplan"    # → 404
   ```
8. `npm test` – visi testai žali.

## Struktūra

```
src/
  core/        gryna logika be HTTP, DB ir tinklo
    nutrients.ts      R1 skaičiavimas pagal gramus, null ≠ 0
    barcode.ts        R2 kodo tikrinimas, Open Food Facts normalizavimas (kJ → kcal)
    ai-estimate.ts    R3 AI atsakymo schema, neigiamų reikšmių korekcija, „Not food“
    draft.ts          AI juodraščio patvirtinimo taisyklės
    day-summary.ts    dienos suma su trūkstamomis vertėmis ir likučiu
  app/
    ports.ts          sąsajos: TenantRepository, ProductLookup, MealEstimator
    meal-entry-service.ts   pagrindinis modulis – sujungia logiką su saugykla ir paslaugomis
  infra/
    db.ts, seed.ts    SQLite schema (tenants → people → įrašai; visos lentelės su tenant_id) ir pavyzdiniai duomenys
    sqlite-repository.ts    kliento saugykla – kiekviena užklausa filtruojama pagal tenant_id
    open-food-facts.ts      Open Food Facts HTTP klientas
    gemini.ts         Gemini klientas su R4 (30 s bandymas, kitas modelis)
  http/app.ts   Fastify maršrutai, kliento nustatymas pagal x-api-key, klaidų atsakymai
public/index.html  paprasta sąsaja
test/              automatiniai testai
```

Priklausomybės nukreiptos į vidų: `core` nieko nežino apie kitus sluoksnius, `app`
priklauso tik nuo `core` ir savo sąsajų (ports), o `infra` ir `http` jas įgyvendina.
Todėl visą logiką galima testuoti su netikromis paslaugomis.

## API

Visoms užklausoms reikia `x-api-key`.

| Metodas | Kelias | Paskirtis |
|---|---|---|
| GET | `/api/people?date=` | kabineto pacientai su dienos suvestine |
| POST | `/api/people` | naujas pacientas (vardas, tikslas) |
| GET | `/api/people/:id/days/:date` | paciento dienos suvestinė ir įrašai |
| PUT | `/api/people/:id/goal` | paciento dienos tikslas |
| POST | `/api/people/:id/entries/manual` | įrašas ranka (vertė 100 g + gramai) |
| POST | `/api/people/:id/entries/product` | įrašas iš bibliotekos |
| POST | `/api/people/:id/entries/barcode` | įrašas pagal kodą |
| POST | `/api/people/:id/estimates` | AI įvertinimas → juodraštis |
| GET | `/api/people/:id/estimates?date=` | laukiantys patvirtinimo |
| DELETE | `/api/entries/:id` | ištrinti įrašą |
| GET | `/api/products` | kabineto produktų biblioteka |
| GET | `/api/barcode/:code` | produkto paieška pagal kodą |
| POST | `/api/estimates/:id/confirm` | patvirtinti (galima keisti gramus, pavadinimą, vertes) |
| POST | `/api/estimates/:id/discard` | atmesti |

## Ribojimai (III etapui)

Prisijungimo ir rolių nėra (klientas = API raktas, pacientai savo duomenų atskirai nemato – tai III etapo rolės), konteinerizavimo ir diegimo
debesyje nėra, kokybės atributo matavimai (20 nuotraukų paklaida, 10 gedimo
bandymų) bus pateikti III etape.
