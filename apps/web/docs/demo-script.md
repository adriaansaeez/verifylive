# Guion de demo en vivo · Veritas Live (3 minutos)

Objetivo: mostrar que la app verifica en directo **sin inventar** y que distingue
lo comprobado de lo provisional, lo opinable y lo simulado.

Preparación (antes de empezar): `npm run dev`, pestaña en
http://localhost:3000, volumen del sistema audible, `.env.local` cargado si hay
`NAN_KEY`. Ten abierto el fixture por si falla el micrófono.

## 0:00 — Intro (20 s)

> «Veritas Live escucha un discurso en español, detecta afirmaciones
> verificables y busca evidencia para cada una. La regla es simple: si no hay
> evidencia suficiente, lo dice; no rellena huecos.»

Señala los dos badges de la cabecera: **live/simulado** y el contador de cola.

## 0:20 — Arranque: fixture vs micrófono (40 s)

- Pulsa **Fixture** (discurso de 90 s) para una demo reproducible.
- Alternativa: **Micrófono** y di en voz alta: «Madrid es la capital de España.
  La Tierra tiene una circunferencia de cuatrocientos mil kilómetros.»
- Mientras aparecen los primeros segmentos, explica: la transcripción ocurre en
  el navegador (Whisper/ONNX) y cada frase pasa por el extractor de claims.

## 1:00 — Los cinco resultados que hay que señalar (60 s)

1. **Respaldada** — «En 2024 la selección española ganó la Eurocopa» o «la
   tasa de paro juvenil ronda el 27 %»: dos o más fuentes de medios distintos y
   confianza ≥ 0,79. La tarjeta muestra el veredicto en verde.
2. **Contradicha** — «La Tierra tiene una circunferencia de 400.000 km». Lo real
   ronda los 40.000 km: confianza 0,95 y la tarjeta enseña la evidencia que lo
   contradice (NASA vía buscador web + Wikipedia, no solo Wikipedia).
3. **Engañosa** — «España creó quinientos mil empleos, un récord histórico»:
   las fuentes cubren la cifra pero no el superlativo, así que el veredicto es
   **engañosa** (0,90) con la nota «el superlativo de la frase no aparece en las
   fuentes consultadas». Es el mejor momento para explicar que un número
   correcto no convierte toda la frase en cierta.
4. **Opinión** — «La paella es, sin duda, el mejor plato del mundo». No se
   descarta: se etiqueta `likely_opinion` y Clef la marca **no verificable** con
   confianza 0,99.
5. **Provisional** — «El agua hierve a cien grados» con una sola fuente, o la
   predicción sobre la IA: la política exige ≥ 2 medios distintos y confianza ≥ 0,65, así
   que se muestra **no verificable + badge provisional** en lugar de inventar un
   veredicto.

Frase clave: «Fíjate en que la opinión no recibe un veredicto falso, y que una
sola fuente nunca basta para afirmar: el badge *provisional* es parte del
producto.»

## 2:00 — Evidencia y revisiones (40 s)

- Antes: cada claim consulta **Wikipedia + un buscador web** (Bing sin clave por
  defecto; Google Custom Search o Brave si hay clave en `.env.local`). Los hits
  del buscador pasan un filtro de relevancia: si la página no comparte términos
  con la afirmación, se descarta. Eso evita que resultados genéricos ("año",
  "RAE") inflen la confianza.
- Abre el **evidence drawer** de la claim contradicha: URL, medio, extracto,
  tier de fuente y stance.
- Enseña el **historial de revisiones**: cada evaluación queda registrada con
  confianza, calidad de evidencia y si fue provisional o simulada.
- Menciona la **verificación numérica determinista**: cuando la cifra hablada y
  la de la fuente difieren ≥ 10 % el veredicto se corrige a *contradicha*
  (Tierra: 400.000 vs 40.075 km); si difieren ≤ 2 % se considera redondeo y no
  se marca contradicha (Everest: 8.840 vs 8.848,86 m). El LLM no tiene la
  última palabra sobre aritmética.
- Recuerda la cola: una petición a Clef cada vez, con reintentos ante 429/502/504
  y timeout de 50 s; la UI nunca se bloquea.

## 2:40 — Qué es real y qué es simulado (20 s)

> «Con `NAN_KEY`, los veredictos vienen de Clef y la app lo marca como live. Sin
> clave, las heurísticas locales producen el mismo flujo pero todo lleva el
> badge **simulado**. La demo nunca oculta esa diferencia.»

Cierre: «La honestidad no es un detalle de UI: es la política del producto.»

---

## Si se cae el Wi-Fi

- Cambia a **Fixture**: el discurso y el corpus de evidencia son locales.
- Sin red no hay conectores remotos: las claims sin evidencia suficiente se
  muestran como **no verificables/provisionales**, que es el comportamiento
  correcto y una buena historia de honestidad.
- Si Clef no responde, la app sigue en modo local/simulado; no reinicies la
  demo, explica el badge y continúa con el fixture.
- Ten capturas o un vídeo corto de respaldo de las cinco tarjetas por si el
  proyector o el audio fallan.
