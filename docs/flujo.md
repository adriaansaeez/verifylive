# Flujo completo de Veritas Live

Este documento explica, etapa por etapa, qué entra y qué sale en cada paso y
dónde vive el código. La idea que lo ordena: **Clef decide; el resto del sistema
solo prepara la decisión, la contrasta con reglas deterministas y la muestra sin
inventar.**

```text
audio o fixture
      │
      ▼
1. Captura y transcripción local (navegador)
      │  segmentos con timestamps
      ▼
2. Ventana de ASR y gate de dos preguntas (Clef)
      │  tramo exacto + probabilidades
      ▼
3. Afirmación canónica (chat NaN opcional / heurística local)
      │  1..n hechos atómicos + consultas + cita literal
      ▼
4. Evidencia multi-fuente (Wikipedia + buscador + Jina)
      │  fuentes ranqueadas, deduplicadas por medio
      ▼
5. Veredicto de Clef (choice + score + noul)
      │  probabilidades
      ▼
6. Política determinista (números, superlativos, provisional, simulado)
      │  veredicto final con confianza
      ▼
7. Persistencia + SSE + UI
      │  timeline, evidencia, historial de revisiones
      ▼
8. Cierre de sesión y exportación de la evidencia
```

## Etapa 0 — Preparación

| Qué | Dónde |
|---|---|
| La app arranca sin ninguna variable de entorno. Sin `NAN_KEY`, Clef no se llama y todo se marca como **simulado**. | `apps/web/lib/config.ts` |
| `/api/config` publica solo capacidades (`clefMode`, `rerank`, `search`, conectores activos), nunca secretos. | `apps/web/app/api/config/route.ts` |
| Si `VERITAS_API_TOKEN` está definido, las rutas mutantes exigen un token intercambiado por una cookie `HttpOnly` en `/api/access`. Cuotas en memoria por IP y sesión. | `apps/web/app/api/_security.ts`, `apps/web/app/api/access/route.ts` |

## Etapa 1 — Captura y transcripción local

**Entrada:** micrófono, pestaña del navegador (`getDisplayMedia`) o el fixture
guionizado de 90 s (`apps/web/fixtures/transcripts/demo.json`).

**Qué pasa:**

- `browser-whisper` ejecuta **Parakeet TDT 0.6B v3** en WebGPU, dentro del navegador. Los pesos (~1,26 GB) se descargan una vez y quedan en la caché OPFS; el audio no sale del dispositivo.
- Parakeet procesa **ventanas incrementales** que se cierran en una pausa del habla (mínimo 3 s, máximo 10 s), no cortes fijos cada 6 s. Así la ventana suele terminar donde termina la frase.
- El solape entre ventanas se reconcilia por **subsecuencia común con tolerancia de raíz**, exigiendo anclaje en ambos extremos. Si una frase se repite de forma natural («el AVE Madrid-Ourense, el AVE Madrid-Murcia»), se prefiere dejar una repetición antes que borrar algo que se dijo.

**Salida:** segmentos de transcripción con `startMs`, `endMs` y texto.

**Código:** `apps/web/lib/client/audio.ts`, `apps/web/lib/client/transcriber.ts`, `apps/web/lib/client/transcript-merge.ts`, `apps/web/lib/client/session-lifecycle.ts`.

## Etapa 2 — Ventana de ASR y gate de dos preguntas (Clef)

**Entrada:** el fragmento más reciente, enviado a `POST /api/sessions/[id]/segments`.

**Qué pasa:**

- El servidor mantiene una **ventana de hasta seis fragmentos ASR**. Las ventanas de ASR no son frases, así que el sistema ofrece a Clef **tramos exactos de lo dicho**: terminan en el fragmento más reciente o en uno que cierra una frase. Nunca genera ni reescribe lo que se dijo.
- Clef responde **dos preguntas independientes** (`noul`) por cada tramo:
  - `closed`: ¿la idea termina dentro de este tramo? Solo juzga el final, porque el corte del ASR decide dónde empieza, no el hablante.
  - `factual`: ¿hay un hecho contrastable por debajo de muletillas y ruido?
- Umbrales, calibrados sobre dos capturas reales: `GATE_MIN_CLOSED = 0.5`, `GATE_MIN_FACTUAL = 0.6`, `GATE_MIN_SCORE = 0.3`, `GATE_TIE_MARGIN = 0.2`.

**Por qué dos preguntas y no una:** una única pregunta combinada puntuaba un fragmento truncado («Yo he inaugurado pues el ave madrid», 0,56) **por encima** de la frase completa que lo contenía (0,23), y publicaba cortes. Con dos preguntas, ese fragmento baja a 0,02 y su tramo completo sube a 0,88.

**Salida:** tramo aprobado (o ninguno) + probabilidades para diagnóstico.

**Código:** `apps/web/lib/claims/claim-window.ts`, `apps/web/lib/claims/gate.ts`.

## Etapa 3 — Afirmación canónica

**Entrada:** tramo aprobado por el gate.

**Qué pasa:**

- Si hay un modelo de chat de NaN configurado (`NAN_CHAT_MODEL`), convierte el tramo en **uno o varios hechos atómicos** con consultas concisas, conservando el sujeto tal y como se dijo. La llamada usa `enable_thinking: false`: con razonamiento activado tardaba 16 s, agotaba el timeout y cada tramo sucio acababa buscando la frase hablada entera.
- Sin modelo de chat, un **extractor determinista local** clasifica verificabilidad y construye las consultas.
- La **cita literal** se guarda aparte para subrayarla y auditar qué se dijo exactamente.

**Salida:** hechos canónicos + consultas + cita, con id estable (`fnv1a`).

**Código:** `apps/web/lib/claims/canonicalize.ts`, `apps/web/lib/claims/heuristic.ts`, `apps/web/lib/claims/anchors.ts`.

## Etapa 4 — Evidencia

**Entrada:** consultas de la etapa 3.

**Qué pasa:**

1. **Wikipedia** (servidor) aporta definición y contexto.
2. **Buscador web**: por defecto SearXNG autoalojado si `VERITAS_SEARXNG_URL` existe; si no, Google Custom Search o Brave con clave; si no, RSS de Bing Noticias sin clave. Una sola petición a SearXNG consulta varios motores y devuelve URL del medio, extracto y fecha, sin claves.
3. **Jina Reader** opcional enriquece el contenido.
4. **Guard SSRF**: solo HTTP(S), bloquea loopback y redes privadas salvo `VERITAS_ALLOW_PRIVATE_NETWORK=true`.
5. **Sanitización**: la evidencia remota se trata como datos (`sanitizeUntrusted`) y el prompt la delimita. Si una página contiene instrucciones, no se obedecen.
6. **Rerank**: el reranker semántico de NaN si está configurado; si no, léxico local. Descarta por debajo de **0,3** y excluye tiendas y agregadores.
7. **Deduplicación por medio**: `distinctPublishers` evita que cinco copias del mismo cable inflen la confianza.

**Salida:** lista de fuentes con medio, URL, extracto, fecha, tier (`primary` / `reliable_secondary` / resto), stance y score.

**Código:** `apps/web/lib/evidence/` (`index.ts`, `wikipedia.ts`, `searxng.ts`, `websearch.ts`, `jina.ts`, `rank.ts`, `sources.ts`, `ssrf.ts`).

## Etapa 5 — Clef toma el veredicto

**Entrada:** afirmación + evidencia numerada.

**Qué pasa:** una única llamada a `POST /v1/systemone` con `model: "clef"`, el estado en texto y cuatro preguntas:

| `id` | Tipo | Pregunta | Uso |
|---|---|---|---|
| `verdict` | `choice` | ¿Qué veredicto justifica **solo** la evidencia aportada? | `supported` / `contradicted` / `misleading` / `unverifiable` |
| `is_checkable` | `noul` | ¿Es un hecho concreto y no opinión, predicción, broma o juicio de valor? | descarta lo opinable |
| `evidence_quality` | `score` | ¿Qué fuerza y relevancia directa tiene la evidencia? | `None` → `Primary and conclusive` |
| `needs_more_sources` | `noul` | ¿Haría falta más o mejor evidencia para verificar con responsabilidad? | activa el badge **provisional** |

**Reglas de llamada:** cola con **una petición en vuelo como máximo**; reintentos en `429`, `502` y `504`; timeout de 50 s (`CLEF_TIMEOUT_MS`). Se descarta el conocimiento externo del modelo: la instrucción prohíbe responder con lo que Clef «sabe».

**Salida:** `verdict` con `probabilities`, `confidence`, `evidence_quality`, `needs_more_sources` e `is_checkable`.

**Código:** `apps/web/lib/clef/client.ts`, `apps/web/lib/clef/queue.ts`.

## Etapa 6 — Política determinista

Clef decide, pero no se publica a ciegas. `apps/web/lib/verdict/policy.ts` aplica reglas que no dependen del modelo:

- **Dos medios distintos y confianza ≥ 0,65** para un veredicto firme; menos fuentes ⇒ **provisional**.
- **Techo de confianza**: 0,6 si todas las fuentes son sitios no acreditados, y 0,6 si la afirmación no es lo bastante específica (sin cifra, fecha o entidad).
- **Verificación numérica determinista**: si la cifra dicha y la de la fuente difieren ≥ 10 %, el veredicto se corrige a **contradicha** (`lib/verdict/numeric.ts`).
- **Superlativos**: si las fuentes cubren la cifra pero no el superlativo («récord histórico», «el mejor»), el veredicto pasa a **engañosa** (`lib/verdict/superlative.ts`).
- **Modo simulado**: sin `NAN_KEY` no hay llamada a Clef; los veredictos salen de heurísticas locales y llevan la insignia *simulado*. Nunca se presenta un resultado simulado como si fuera de Clef.
- **Filtro de conversación**: saludos, opiniones, preguntas y predicciones se conservan en la transcripción, pero no abren búsqueda ni veredicto. Solo las afirmaciones factuales llegan al pipeline.

**Salida:** `verdict`, `confidence`, `provisional`, `simulated`, `checkableProbability`, `evidenceQualityScore`, `needsMoreSourcesProbability`, `summary` y `rationale`.

## Etapa 7 — Persistencia, SSE y UI

- **SQLite (`node:sqlite`, Node ≥ 22)** guarda sesiones, segmentos, claims, evidencia y **revisiones**. Cada evaluación queda registrada con confianza, calidad de evidencia y si fue provisional o simulada; una corrección posterior no borra el veredicto anterior.
- **SSE** (`GET /api/sessions/[id]/stream`) empuja eventos de segmentos, claims y veredictos mientras el discurso sigue.
- **UI**: timeline de afirmaciones, tarjeta por claim, cajón de evidencia con URL, medio, extracto, tier y stance, contador de cola Clef y badges **live/simulado** y **provisional**.

**Rutas HTTP:**

| Ruta | Función |
|---|---|
| `GET /api/config` | capacidades activas sin secretos |
| `POST /api/access` | token → cookie HttpOnly |
| `POST /api/fixtures/demo` | carga el discurso demo |
| `GET/POST /api/sessions` | listar / crear sesión |
| `GET /api/sessions/[id]` | snapshot de la sesión |
| `POST /api/sessions/[id]/segments` | añadir transcripción |
| `GET /api/sessions/[id]/stream` | SSE de eventos |
| `POST /api/sessions/[id]/finish` | cerrar sesión |

**Código:** `apps/web/lib/db/repo.ts`, `apps/web/lib/events.ts`, `apps/web/lib/orchestrator/index.ts`, `apps/web/components/veritas-app.tsx`.

## Etapa 8 — Cierre y resultados

Al cerrar la sesión se espera a que termine el trabajo pendiente de esa sesión
(`pendingWork`), se persiste el estado final y la UI muestra la línea temporal
completa. El corpus curado (`apps/web/fixtures/evidence/corpus.json`) garantiza
que la demo funciona incluso sin red.

## Los cinco desenlaces que hay que saber leer

| Estado | Cuándo | Ejemplo de la demo |
|---|---|---|
| **Respaldada** | ≥ 2 medios distintos y confianza ≥ 0,79 | «En 2024 la selección española ganó la Eurocopa» |
| **Contradicha** | La evidencia contradice el hecho; la verificación numérica corrige diferencias ≥ 10 % | «La Tierra tiene una circunferencia de 400.000 km» |
| **Engañosa** | Una parte es cierta, pero falta el contexto que cambia el significado | «España creó 500.000 empleos, un récord histórico» |
| **No verificable** | Evidencia insuficiente, irrelevante o contradictoria; incluye opiniones | «La paella es, sin duda, el mejor plato del mundo» |
| **Provisional** | Veredicto con poca verificabilidad, evidencia débil o menos de dos fuentes | «El agua hierve a cien grados» con una sola fuente |

## Ruta de fallo (lo que **no** hace)

- Si no hay `NAN_KEY`: **no** llama a Clef; marca todo como simulado.
- Si el buscador cae: **no** inventa fuentes; usa Wikipedia y el corpus, y deja el claim como no verificable/provisional.
- Si el gate no aprueba un tramo: **no** publica un corte a mitad de frase.
- Si la evidencia es débil: **no** fuerza un veredicto; abstiene.
- Si una página remota trae instrucciones: **no** las obedece; las trata como datos.
