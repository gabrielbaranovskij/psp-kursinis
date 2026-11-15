import { normalizeOpenFoodFacts, type ExternalProduct } from '../core/barcode.ts';
import { DomainError } from '../core/errors.ts';
import type { ProductLookup } from '../app/ports.ts';

type Fetch = typeof fetch;

/**
 * Open Food Facts klientas. Tik HTTP: atsakymo aiškinimas (kJ → kcal, null ≠ 0)
 * yra core/barcode.ts, kad būtų testuojamas be tinklo.
 */
export class OpenFoodFactsClient implements ProductLookup {
  constructor(
    private readonly fetchImpl: Fetch = fetch,
    private readonly baseUrl = 'https://world.openfoodfacts.org',
  ) {}

  async findByBarcode(barcode: string): Promise<ExternalProduct | null> {
    const url =
      `${this.baseUrl}/api/v2/product/${barcode}.json` +
      '?fields=product_name,product_name_en,nutriments';

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { 'user-agent': 'PSP-kursinis-food-prototype/0.2 (student project)', accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw DomainError.upstream('upstream_failed', 'Could not reach the food database. Try again.');
    }

    if (response.status === 404) return null;
    if (!response.ok) {
      throw DomainError.upstream('upstream_failed', 'The food database refused that barcode.');
    }

    const payload = await response.json().catch(() => {
      throw DomainError.upstream('upstream_invalid', 'The food database sent something unreadable.');
    });
    return normalizeOpenFoodFacts(barcode, payload);
  }
}
