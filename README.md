![Veritas Live verificando en directo el debate electoral de laSexta: a la izquierda el vídeo, en el centro la transcripción y a la derecha las afirmaciones con su veredicto y sus fuentes.](assets/banner.png)

# Veritas Live

**Fact-check en directo para discursos en español, con Clef tomando la decisión.**

Veritas Live escucha a alguien hablar —micrófono, pestaña del navegador o un
discurso guionizado—, detecta afirmaciones verificables, busca evidencia pública
y muestra en pantalla un veredicto con fuentes. La regla de producto es simple:
**si no hay evidencia suficiente, lo dice; no rellena huecos.**

> **#2 Hackathon NaN · Reto 3: fact-check.** La app implementa el reto completo y
> añade la parte que lo convierte en experiencia: transcripción local en el navegador,
> línea temporal en vivo, evidencia y contraevidencia visibles, y estados honestos
> (`provisional`, `simulado`, `no verificable`).

---

## El problema

Un fact-checker conversacional tiene tres formas de mentir: inventar evidencia,
confundir una opinión con un hecho y presentar una certeza que no existe. Veritas
Live está diseñada alrededor de esas tres fallas:

- **No inventa.** Si no hay fuentes, el veredicto es *no verificable*.
- **No confunde.** Opiniones, preguntas, saludos y predicciones se conservan en
  la transcripción, pero no abren búsqueda ni veredicto.
- **No exagera.** Menos de dos medios distintos ⇒ badge **provisional**. Sin
  `NAN_KEY` ⇒ todo se marca como **simulado**, nunca como si Clef hubiera
  respondido.

## Clef toma la decisión

Clef no escribe texto: recibe un **estado** (la afirmación + la evidencia
numerada) y responde probabilidades para preguntas tipadas. Veritas Live le
pregunta exactamente esto:

| `id` | Tipo | Pregunta | Decisión |
|---|---|---|---|
| `verdict` | `choice` | ¿Qué veredicto justifica **solo** la evidencia aportada? | `supported` · `contradicted` · `misleading` · `unverifiable` |
| `is_checkable` | `noul` | ¿Es un hecho concreto y no opinión, predicción, broma o juicio de valor? | descarta lo opinable |
| `evidence_quality` | `score` | ¿Qué fuerza y relevancia directa tiene la evidencia? | de `None` a `Primary and conclusive` |
| `needs_more_sources` | `noul` | ¿Haría falta más o mejor evidencia para verificar con responsabilidad? | activa **provisional** |

La instrucción prohíbe explícitamente responder con conocimiento externo: Clef
solo puede usar la evidencia que se le entrega. La llamada va a
`POST /v1/systemone` con `model: "clef"`, en una cola de **una petición en vuelo**
con reintentos en `429`, `502` y `504` y timeout de 50 s.

## Flujo completo

```text
🎙️ micrófono / pestaña ─┐
                        ├─▶ Parakeet TDT 0.6B v3 (WebGPU, en el navegador)
📼 fixture 90 s ────────┘        │  ventanas de 3–10 s que cierran en pausa
                                 ▼
                    POST /api/sessions/[id]/segments
                                 │
                                 ▼
      ClaimWindow: hasta 6 fragmentos ASR → tramos exactos de lo dicho
                                 │
                                 ▼
      Clef · gate de 2 preguntas:  closed ≥ 0.5  ·  factual ≥ 0.6
                    ├─ no cierra / no es factual ──▶ se muestra, no se verifica
                    └─ aprobado
                                 ▼
      Canonicalizador (chat NaN opcional / heurística local)
      → hechos atómicos + consultas + cita literal
                                 ▼
      Evidencia: Wikipedia + SearXNG (o Bing/Google/Brave) + Jina
      → guard SSRF → sanitización → rerank ≥ 0.3 → dedupe por medio
                                 ▼
      Clef · verdict + is_checkable + evidence_quality + needs_more_sources
                                 ▼
      Política determinista: ≥ 2 medios y confianza ≥ 0.65,
      verificación numérica (≥ 10 % ⇒ contradicha),
      superlativo sin respaldo ⇒ engañosa, techos de confianza
                                 ▼
      SQLite (claims · evidence · revisions) ──▶ SSE ──▶ timeline + fuentes
```

Detalle etapa por etapa, con entradas, salidas y archivos: **[docs/flujo.md](docs/flujo.md)**.

## Los cinco desenlaces

| Estado | Cuándo aparece | Ejemplo de la demo |
|---|---|---|
| **Respaldada** | ≥ 2 medios distintos y confianza alta | «En 2024 la selección española ganó la Eurocopa» |
| **Contradicha** | La evidencia contradice el hecho | «La Tierra tiene una circunferencia de 400.000 km» (real: ~40.000) |
| **Engañosa** | Una parte es cierta, falta el contexto | «España creó 500.000 empleos, un récord histórico» |
| **No verificable** | Evidencia insuficiente, irrelevante o contradictoria; incluye opiniones | «La paella es, sin duda, el mejor plato del mundo» |
| **Provisional** | Poca verificabilidad, evidencia débil o < 2 fuentes | «El agua hierve a cien grados» con una sola fuente |

Un número correcto no hace cierta toda la frase: si las fuentes cubren la cifra
pero no el superlativo, el veredicto es **engañosa**. Y una diferencia numérica
del 10 % o más se corrige de forma determinista, sin depender del modelo.

## Decisiones de ingeniería que sostienen la demo

- **Transcripción local, no en la nube.** Parakeet corre en WebGPU; el audio
  nunca se sube. Pesos (~1,26 GB) descargados una vez y cacheados en OPFS.
- **Ventanas ASR no son frases.** El servidor ofrece a Clef tramos exactos de lo
  dicho, nunca texto generado o reescrito.
- **Gate de dos preguntas.** Una sola pregunta puntuaba un fragmento truncado
  (0,56) por encima de la frase completa que lo contenía (0,23). Con `closed`
  + `factual`, ese fragmento baja a 0,02 y el tramo completo sube a 0,88. Los
  umbrales se calibraron sobre capturas reales.
- **Buscador medido, no elegido por intuición.** SearXNG autoalojado encontró
  fuente relevante para 8/8 afirmaciones en español (relevancia media 0,93),
  frente a 6/8 y 0,66 del RSS sin clave. Sin SearXNG, la app sigue funcionando
  con Bing Noticias y cero configuración.
- **Rerank con umbral.** Por debajo de 0,3 la fuente se descarta: «Historia del
  ferrocarril en España» puntuaba 0,198 para una afirmación sobre alta velocidad
  y antes se presentaba como evidencia.
- **Trazabilidad.** Cada veredicto guarda conectores, latencias, consultas,
  fuentes descartadas y probabilidades del gate. Una lista vacía de fuentes ya
  no se parece a un buscador caído.
- **Correcciones sin borrar historia.** Cada evaluación queda como revisión
  numerada con confianza, calidad de evidencia y si fue provisional o simulada.

## Estructura del repositorio

```text
apps/web/                 La aplicación (Next.js 16 + React 19 + TypeScript)
  app/api/                Rutas HTTP y SSE
  components/             Timeline, tarjeta de claim, cajón de evidencia
  lib/
    claims/               Ventana ASR, gate Clef, canonicalizador, anclas
    evidence/             Wikipedia, SearXNG, buscadores, Jina, rerank, SSRF
    clef/                 Cliente, parser y cola 1-a-1 con reintentos
    verdict/              Política, verificación numérica, superlativos
    db/                   node:sqlite + repositorio
    orchestrator/         Une transcripción → claim → evidencia → veredicto
  fixtures/               Discurso demo y corpus curado de evidencia
  docs/demo-script.md     Guion de demo de 3 minutos
  search/                 SearXNG autoalojado (docker-compose)
  scripts/probe-nan.ts    Diagnóstico de una llamada real a NaN/Clef
docs/                     API de Clef, retos del hackathon y este flujo
ideas/                    Exploración y comparación de las tres ideas
examples/                 Llamadas de ejemplo a Clef (curl, Python, Node)
spikes/parakeet-browser/  Spike que valida Parakeet en WebGPU
```

## Arranque rápido

Requisitos: **Node ≥ 22** (usa `node:sqlite`), **Chrome/Chromium** (WebGPU,
micrófono y `getDisplayMedia`) y npm.

```bash
cd apps/web
npm install
cp env.example .env.local   # opcional: NAN_KEY y proveedores
npm run dev                 # http://localhost:3000
```

Sin `.env.local` la app arranca en **modo simulado** y funciona completa con el
fixture y el corpus local. Para activar Clef real:

```bash
# en apps/web/.env.local
NAN_KEY=tu-key-de-nan

# opcional: buscador autoalojado (mejor evidencia sin claves)
npm run search:up
VERITAS_SEARXNG_URL=http://localhost:8099
```

La app necesita COOP/COEP para WebGPU y `SharedArrayBuffer`; `next.config.ts`
las añade. Si la sirves detrás de otro proxy, replícalas.

## Demo

1. Abre http://localhost:3000.
2. Pulsa **Ver demo guionizada** para reproducir el discurso de 90 s sin
   micrófono, o usa micrófono/pestaña para audio real.
3. Observa los cinco desenlaces: respaldada, contradicha, engañosa, opinión
   (no verificable) y provisional.

Guion completo de 3 minutos: **[apps/web/docs/demo-script.md](apps/web/docs/demo-script.md)**.

## Verificación

```bash
cd apps/web
npm run check      # tsc --noEmit + Vitest
npm run probe:nan  # llama al endpoint real con el mismo contrato; sin NAN_KEY no llama
```

Estado actual: **154 tests pasan, 3 se saltan** (los bancos de regresión con
captura real, que requieren red y `NAN_KEY`). Los replay tests se ejecutan
explícitamente:

```bash
VERITAS_REPLAY=1 npx vitest run scripts/replay-detection.test.ts --disable-console-intercept
VERITAS_REPLAY=1 npx vitest run scripts/replay-evidence.test.ts --disable-console-intercept
```

El primer banco vuelve a pasar 56 segmentos reales de Parakeet por la ventana y
el gate; el segundo lleva las afirmaciones por canonicalizador, conectores y
política. Sobre esa captura, la detección pasó de 3 afirmaciones (una cortada a
mitad de frase) a ~20, incluyendo las 6 afirmaciones contrastables de referencia.

## Límites conocidos

- **MVP local, no multi-tenant.** SQLite local, cuotas en memoria y token opcional;
  pensado para demo y un solo proceso.
- **Depende de WebGPU.** Navegador actualizado; la primera transcripción descarga
  ~1,26 GB y prepara el modelo.
- **Español.** El transcriptor y los prompts están ajustados a español.
- **La calidad del veredicto depende de la evidencia recuperada.** Por eso
  SearXNG es la opción recomendada y el reranker descarta fuentes débiles.
- **Sin red** sigue funcionando con el fixture y el corpus, pero menos claims
  reciben evidencia externa.

## Documentación

| Documento | Contenido |
|---|---|
| [docs/flujo.md](docs/flujo.md) | Flujo completo, etapa por etapa, con código y rutas de fallo |
| [apps/web/README.md](apps/web/README.md) | Decisiones técnicas detalladas, mediciones y problemas habituales |
| [docs/api.md](docs/api.md) | Referencia de Clef en NaN: petición, tipos, límites y errores |
| [docs/hackathon.md](docs/hackathon.md) | Bases del #2 Hackathon NaN y especificación de los retos |
| [docs/retos/03-fact-check.md](docs/retos/03-fact-check.md) | Reto 3, el que implementa este repositorio |
| [apps/web/docs/demo-script.md](apps/web/docs/demo-script.md) | Guion de demo en vivo (3 minutos) |
| [ideas/02-veritas-live/](ideas/02-veritas-live/) | Propuesta original y plan del MVP |

## Créditos

- **Clef** — modelo de decisión de Cloudflare (Apache 2.0), servido por NaN.
- **Parakeet TDT 0.6B v3** — NVIDIA, ejecutado en el navegador con `browser-whisper`.
- **Next.js**, **React**, **SQLite (`node:sqlite`)** y **SearXNG**.
- Corpus y discurso de demo: ficticios, creados para el MVP.
