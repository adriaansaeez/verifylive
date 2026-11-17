/**
 * Qué evaluadores han dejado de existir.
 *
 * Vive en su propio módulo, sin importar nada, a propósito: tanto la
 * configuración como el cliente necesitan este dato, y que uno importase al
 * otro creaba un ciclo que dejaba la página en blanco.
 *
 * Un 404 no es un fallo pasajero: NaN retiró el modelo «clef» y su endpoint
 * empezó a devolver 404 para cualquier petición. Reintentarlo solo retrasa
 * cada ficha, así que se anota por proveedor y se deja de preguntar.
 */
type Retired = Record<string, string>;
type GlobalWithState = typeof globalThis & { __verifyliveRetired?: Retired };

function store(): Retired {
  const global = globalThis as GlobalWithState;
  global.__verifyliveRetired ??= {};
  return global.__verifyliveRetired;
}

export function retiredReason(id: string): string | null {
  return store()[id] ?? null;
}

export function markRetired(id: string, reason: string): void {
  store()[id] = reason;
}

export function retiredProviders(): Retired {
  return { ...store() };
}

/** Solo para las pruebas: olvida los diagnósticos. */
export function resetAvailability(): void {
  delete (globalThis as GlobalWithState).__verifyliveRetired;
}
