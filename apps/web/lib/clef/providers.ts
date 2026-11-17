/**
 * Evaluadores System One, en orden de preferencia.
 *
 * Clef y Jev hablan exactamente el mismo protocolo: `POST /v1/systemone` con
 * `{model, state, questions}` y los mismos tipos de pregunta (`noul`,
 * `choice`, `score`) y de respuesta. Por eso el relevo es cuestión de a quién
 * se le pregunta, y ni el gate ni la política de veredictos cambian.
 *
 * El orden importa poco mientras ambos respondan; importa cuando uno deja de
 * existir, que es lo que pasó con Clef. Un proveedor retirado se salta y se
 * pasa al siguiente, y solo si no queda ninguno se recurre al clasificador
 * local, que va etiquetado como simulado.
 */

export type SystemOneProvider = {
  id: string;
  label: string;
  url: string;
  model: string;
  envKey: string;
};

const PROVIDERS: SystemOneProvider[] = [
  {
    id: "clef",
    label: "Clef · NaN",
    url: "https://api.nan.builders/v1/systemone",
    model: "clef",
    envKey: "NAN_KEY",
  },
  {
    id: "jev",
    label: "Jev · TypeSafe",
    url: "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
    envKey: "TYPESAFE_API_KEY",
  },
];

/** Los que tienen clave, respondan o no. */
export function configuredProviders(): SystemOneProvider[] {
  return PROVIDERS.filter((provider) => Boolean(process.env[provider.envKey]?.trim()));
}

export function providerKey(provider: SystemOneProvider): string {
  return process.env[provider.envKey]?.trim() ?? "";
}

export function allProviders(): SystemOneProvider[] {
  return PROVIDERS;
}

/**
 * Umbral de «harían falta más fuentes» por modelo.
 *
 * No es transferible entre evaluadores: Clef y Jev responden la misma
 * pregunta en escalas distintas. Medido sobre diez casos etiquetados a mano,
 * Jev puntúa entre 0,16 y 0,88 lo que sí se puede cerrar y entre 0,94 y 0,97
 * lo que no, así que el corte cae en el hueco. Con el 0,65 de Clef, Jev
 * marcaba como provisional hasta un dato de Eurostat con fuente oficial.
 *
 * El conjunto de calibración es pequeño; conviene rehacerlo sobre capturas
 * reales como se hizo con Clef.
 */
const NEEDS_MORE_DEFAULT = 0.65;
const NEEDS_MORE_BY_MODEL: Array<[RegExp, number]> = [[/^jev/i, 0.9]];

export function needsMoreThreshold(model: string | undefined): number {
  if (!model) return NEEDS_MORE_DEFAULT;
  for (const [pattern, value] of NEEDS_MORE_BY_MODEL) {
    if (pattern.test(model)) return value;
  }
  return NEEDS_MORE_DEFAULT;
}

/**
 * Umbrales del gate por modelo. Tampoco son transferibles.
 *
 * Medido sobre catorce fragmentos reales etiquetados a mano: con Jev el ruido
 * puntúa `factual` entre 0,10 y 0,75 y lo publicable entre 0,81 y 0,94, así
 * que el corte cae en el hueco. Con el 0,6 calibrado para Clef entraban
 * anécdotas personales como «mis abuelos no sabían leer ni escribir» (0,75).
 *
 * La precisión sigue SIN filtrar, también con Jev. Sobre frases limpias
 * parecía separar (ruido hasta 0,16, señal desde 0,20), pero sobre el texto
 * crudo del ASR se desploma incluso en afirmaciones buenas: «15 años hemos
 * tardado en revertir esos recortes» puntúa 0,11 y «hemos multiplicado por
 * veinte la inversión» 0,17. Medido: filtrar ahí costaba dos de las seis
 * afirmaciones de referencia del banco.
 *
 * Catorce casos son pocos: conviene rehacerlo sobre capturas completas.
 */
export type GateThresholds = { factual: number; precision: number };

const GATE_DEFAULT: GateThresholds = { factual: 0.6, precision: 0 };
const GATE_BY_MODEL: Array<[RegExp, GateThresholds]> = [
  [/^jev/i, { factual: 0.78, precision: 0 }],
];

export function gateThresholds(model: string | undefined): GateThresholds {
  if (!model) return GATE_DEFAULT;
  for (const [pattern, value] of GATE_BY_MODEL) {
    if (pattern.test(model)) return value;
  }
  return GATE_DEFAULT;
}
