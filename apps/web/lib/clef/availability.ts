/**
 * Si Clef sigue existiendo en el servicio.
 *
 * Vive en su propio módulo, sin importar nada, a propósito: tanto la
 * configuración como el cliente de Clef necesitan este dato, y hacer que uno
 * importase al otro creaba un ciclo que dejaba la página en blanco.
 *
 * NaN retiró el modelo y `/v1/systemone` empezó a devolver 404 para cualquier
 * petición. Eso no es un fallo pasajero, así que se recuerda en el proceso y
 * la app se pasa al clasificador local, que sí va etiquetado como simulado.
 */
type GlobalWithClef = typeof globalThis & { __veritasClefGone?: string };

export function clefUnavailableReason(): string | null {
  return (globalThis as GlobalWithClef).__veritasClefGone ?? null;
}

export function markClefUnavailable(reason: string): void {
  (globalThis as GlobalWithClef).__veritasClefGone = reason;
}

/** Solo para las pruebas: olvida el diagnóstico. */
export function resetClefAvailability(): void {
  delete (globalThis as GlobalWithClef).__veritasClefGone;
}
