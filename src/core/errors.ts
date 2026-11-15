/**
 * Klaida, kurią pagrindinė logika meta, kai užklausos įvykdyti negalima.
 *
 * Nešioja HTTP būseną ir mašininį kodą, tačiau pati nieko nežino apie HTTP:
 * kaip ją paversti atsakymu, sprendžia http sluoksnis (src/http/app.ts).
 */
export class DomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }

  static badRequest(code: string, message: string): DomainError {
    return new DomainError(400, code, message);
  }

  static notFound(code: string, message: string): DomainError {
    return new DomainError(404, code, message);
  }

  static conflict(code: string, message: string): DomainError {
    return new DomainError(409, code, message);
  }

  static upstream(code: string, message: string): DomainError {
    return new DomainError(502, code, message);
  }
}
