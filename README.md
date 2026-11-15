![Veritas Live verificando en directo el debate electoral de laSexta: a la izquierda el vídeo, en el centro la transcripción y a la derecha las afirmaciones con su veredicto y sus fuentes.](assets/banner.png)

# Veritas Live

**Que no te la cuelen.**

Pon un debate, un mitin, una entrevista o cualquier vídeo donde alguien hable.
Veritas lo escucha, separa lo que es una afirmación comprobable de lo que es
ruido, la busca en prensa y en fuentes oficiales, y te enseña en pantalla, en el
momento, si hay algo que la respalde o que la desmienta. Con el enlace, para que
lo mires tú.

No hace falta que te fíes de nadie, ni de nosotros: cada veredicto lleva debajo
las fuentes con las que se tomó.

---

## La idea

En un debate de hora y media se sueltan cifras a un ritmo que nadie puede
comprobar sobre la marcha. Para cuando alguien verifica aquel «hemos
multiplicado por veinte la inversión», el debate terminó hace tres días y el
titular ya lo leyó todo el mundo.

Veritas hace esa comprobación mientras la frase todavía está en el aire. No
sustituye a un periodista: le quita de encima el trabajo mecánico de pillar la
afirmación, buscarla y ponerle una fuente al lado.

## Lo que NO hace

Esto es lo que separa una herramienta útil de un juguete que da la razón al que
lo usa.

**No es una máquina de la verdad.** Un detector de mentiras que acierta siempre
no existe, y el que diga tenerlo miente más que el político. Veritas no dice
«esto es mentira»: dice «estas tres fuentes contradicen lo que acaba de decir»,
y te las enseña.

**No rellena huecos.** Si no encuentra con qué comprobar algo, lo marca como *no
verificable* y se queda callado. Es la respuesta aburrida, y es la honesta.
Preferimos quedarnos cortos a colar una certeza que no tenemos.

**No confunde una opinión con un dato.** «La sanidad va a peor» no es
comprobable, por mucho que se diga con énfasis. «Hemos invertido 19.000 millones
desde 2026» sí lo es. Veritas solo entra al segundo tipo de frase, y lo decide
preguntándole al modelo si dos periodistas con las mismas fuentes delante
llegarían a la misma conclusión.

**No te dice lo que quieres oír.** El veredicto sale de las fuentes, no de quién
habla. Si la afirmación de tu partido está respaldada, lo dirá igual.

## Qué ves en pantalla

A la izquierda, lo que se está diciendo, transcrito en tu propio ordenador. A la
derecha, una ficha por cada afirmación que merece comprobarse, con uno de estos
cinco desenlaces:

| Estado | Qué significa |
|---|---|
| **Respaldada** | Dos medios distintos o más sostienen lo que dijo |
| **Contradicha** | Las fuentes dicen lo contrario |
| **Engañosa** | El dato es cierto, pero falta un contexto que lo cambia todo |
| **No verificable** | No hay con qué comprobarlo, o no era comprobable |
| **Provisional** | Hay indicios, pero no para darlo por zanjado |

**Provisional** es la etiqueta más importante de las cinco. Aparece cuando hay
una sola fuente, cuando ninguna es un medio de referencia, o cuando la frase es
demasiado vaga para resolverse en un sí o un no. Es la manera de no fingir
certeza cuando no la hay.

Un número correcto tampoco hace cierta toda la frase: si las fuentes confirman
la cifra pero no el «récord histórico» que la acompaña, sale **engañosa**. Y una
diferencia del 10 % o más entre lo dicho y lo publicado se corrige sola, sin que
el modelo tenga voz.

## Cómo decide, por dentro

El veredicto no lo escribe un modelo de texto que pueda irse por las ramas. Lo
decide **Clef**, que no redacta: recibe la afirmación con sus fuentes numeradas
y responde con probabilidades a preguntas cerradas.

Son estas cinco:

| Pregunta a Clef | Para qué sirve |
|---|---|
| ¿Qué veredicto justifica **solo** la evidencia aportada? | elige entre respaldada, contradicha, engañosa y no verificable |
| ¿Es un hecho concreto, y no una opinión, una predicción o un juicio de valor? | deja fuera lo opinable |
| ¿Cuánta fuerza y relevancia directa tiene esta evidencia? | de «ninguna» a «primaria y concluyente» |
| ¿Haría falta más o mejor evidencia para verificar esto con responsabilidad? | enciende el aviso de **provisional** |
| ¿Dos periodistas con estas fuentes llegarían a la misma conclusión? | impide zanjar lo que depende de la interpretación |

La instrucción le prohíbe tirar de lo que sabe: solo puede usar las fuentes que
se le entregan. Si no bastan, tiene que decirlo.

**Y Clef tampoco tiene la última palabra.** Por encima hay una política que
rebaja el resultado cuando las fuentes no dan para tanto: menos de dos medios
distintos, ninguna fuente de referencia, o una frase sin una sola cifra, fecha o
nombre propio a la que agarrarse. El modelo propone; las reglas deciden qué se
puede afirmar.

Técnicamente: `POST /v1/systemone` con `model: "clef"`, en una cola de una
petición en vuelo, con reintentos en `429`, `502` y `504` y timeout de 50 s.

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
docs/                     Referencia de la API de Clef y este flujo
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

## Hasta dónde llega, y hasta dónde no

Conviene saberlo antes de confiar en ninguna pantalla:

- **Un veredicto vale lo que valgan sus fuentes.** Si el tema es muy reciente o
  muy de nicho, no habrá con qué comprobarlo y saldrá *no verificable*. No es un
  fallo: es el sistema negándose a inventar.
- **El oído no es perfecto.** La transcripción se equivoca con nombres propios y
  con cifras grandes dichas de corrido. Por eso cada ficha guarda la cita
  literal: puedes ver qué se oyó exactamente.
- **Va con retraso, aunque sea en directo.** Entre que se dice una frase y
  aparece su ficha pasan unos segundos. Es el tiempo de oír, buscar y comprobar.
- **Solo español**, de momento. El transcriptor y las preguntas están ajustados
  a este idioma.
- **Es un prototipo.** Base de datos local, un solo proceso, cuotas en
  memoria. Vale para una demo o para ti; no para abrirlo a medio país.
- **Sin internet** sigue funcionando con el discurso de ejemplo y su corpus,
  pero casi nada recibe fuentes nuevas.

## Documentación

| Documento | Contenido |
|---|---|
| [docs/flujo.md](docs/flujo.md) | Flujo completo, etapa por etapa, con código y rutas de fallo |
| [apps/web/README.md](apps/web/README.md) | Decisiones técnicas detalladas, mediciones y problemas habituales |
| [docs/api.md](docs/api.md) | Referencia de Clef en NaN: petición, tipos, límites y errores |
| [apps/web/docs/demo-script.md](apps/web/docs/demo-script.md) | Guion de demo en vivo (3 minutos) |

## Créditos

- **Clef** — modelo de decisión de Cloudflare (Apache 2.0), servido por NaN.
- **Parakeet TDT 0.6B v3** — NVIDIA, ejecutado en el navegador con `browser-whisper`.
- **Next.js**, **React**, **SQLite (`node:sqlite`)** y **SearXNG**.
- Corpus y discurso de demo: ficticios, creados para el MVP.
