# Veritas Live

Verificación de afirmaciones **en directo** sobre un discurso en español. La app
escucha (micrófono real o un fixture pregrabado), extrae afirmaciones
verificables, busca evidencia y muestra un veredicto con fuentes — sin inventar
lo que no se puede comprobar.

## Reglas de honestidad

- **Provisional**: cualquier veredicto con poca verificabilidad, evidencia débil
  o menos de dos fuentes se etiqueta como provisional. La política vive en
  `lib/verdict/policy.ts` (umbrales en `lib/config.ts`).
- **Simulado**: sin `NAN_KEY` no se llama a Clef. Los veredictos se calculan con
  heurísticas locales y se marcan con la insignia *simulado*. Nunca se presenta
  un resultado simulado como si fuera de Clef.
- **Filtro de conversación**: saludos, opiniones, preguntas y predicciones se
  conservan en la transcripción, pero no abren una búsqueda ni un veredicto.
  Solo las afirmaciones factuales llegan al pipeline de evidencia.
- **Sin invención**: la evidencia remota se trata como datos (filtro de
  inyección en `sanitizeUntrusted`) y el prompt delimita el texto recuperado.
  Si no hay evidencia suficiente, el veredicto es "No verificable".

## Arquitectura

```
app/api/                  Rutas HTTP (App Router)
  config/                 Capacidades activas (sin secretos)
  access/                 Intercambio de token por cookie HttpOnly
  fixtures/demo/          Carga el discurso de demostración
  sessions/               Crear/listar sesiones
  sessions/[id]/          Snapshot de sesión
  sessions/[id]/segments/ Añadir transcripciones
  sessions/[id]/finish/   Cerrar sesión
  sessions/[id]/stream/   SSE de eventos (segmentos, claims, veredictos)
components/               UI: veritas-app, claim-card, evidence-drawer, format
lib/
  db/                     node:sqlite (Node >= 22) + repositorio
  claims/                 Buffer de frases + extractor determinista/chat opcional
  evidence/               Conectores (Wikipedia, buscador web, Jina), ranker y guard SSRF
  clef/                   Cliente Clef, parser y cola 1-a-1 con reintentos
  verdict/                Política de veredictos y modo simulado
  orchestrator/           Une ventanas ASR → frase completa → filtro Clef → evidencia → veredicto
  text.ts, types.ts, config.ts, events.ts, fixtures.ts
fixtures/                 Discurso demo y corpus curado de evidencia
scripts/probe-nan.ts      Diagnóstico de una llamada real a NaN/Clef
```

- **Cola Clef**: una petición en vuelo como máximo; reintenta `429`, `502` y
  `504`; timeout de 50 s (`CLEF_TIMEOUT_MS`). Ver `lib/clef/queue.ts`.
- **SSRF**: `lib/evidence/ssrf.ts` bloquea esquemas no HTTP(S), loopback y redes
  privadas salvo que `VERITAS_ALLOW_PRIVATE_NETWORK=true`.
- **Protección de escritura**: los POST aceptan un token opcional para demos
  públicas y aplican cuotas en memoria por IP y sesión. Sin token configurado,
  el desarrollo local conserva el flujo directo.
- **Transcripción actual**: `browser-whisper` ejecuta Parakeet TDT 0.6B v3 en
  WebGPU. Sus pesos (~1,26 GB) se descargan una vez y quedan en la caché OPFS.
- **Transcripción incremental**: Parakeet procesa ventanas que se cierran en
  una pausa del habla, con un mínimo de tres segundos y un máximo de diez, en
  lugar de cortar cada seis segundos pase lo que pase. Así una ventana suele
  acabar donde acaba la frase.
- **Reconciliación del solape**: el modelo redecodifica el audio compartido de
  forma distinta cada vez («los controles» vuelve como «los controladores»), así
  que el solape se alinea por subsecuencia común con tolerancia de raíz, no por
  igualdad exacta. La alineación exige anclaje en ambos extremos: si una frase
  se repite de forma natural («el AVE Madrid-Ourense, el AVE Madrid-Murcia») se
  prefiere dejar una repetición antes que borrar algo que se dijo.
- **Ventanas ASR no son frases**: el servidor mantiene hasta seis fragmentos y
  ofrece a Clef tramos exactos de lo dicho, que acaban en el fragmento más
  reciente o en uno que cierra una frase. Nunca genera ni reescribe lo dicho.
- **Gate de dos preguntas**: por cada tramo, Clef responde si la idea termina
  dentro del tramo (`closed`) y si hay un hecho contrastable por debajo de las
  muletillas (`factual`). Una sola pregunta combinada se desplomaba con texto de
  ASR y, peor, puntuaba un fragmento truncado («Yo he inaugurado pues el ave
  madrid», 0,56) por encima de la frase completa que lo contenía (0,23). Con las
  dos preguntas, ese fragmento baja a 0,02 y su tramo completo sube a 0,88. Los
  umbrales viven en `lib/claims/gate.ts` y se calibraron sobre una captura real.
- **Afirmación canónica**: un modelo de chat transforma el tramo aprobado por
  Clef en uno o varios hechos atómicos y consultas concisas, conservando el
  sujeto tal y como se dijo. La cita literal se guarda aparte para subrayarla y
  auditar qué se dijo. La llamada desactiva el razonamiento del modelo
  (`enable_thinking: false`): con él activado tardaba 16 s, agotaba el timeout y
  cada tramo sucio acababa buscando la frase hablada entera.
- **Buscador**: un SearXNG autoalojado (`npm run search:up`) es el proveedor
  por defecto cuando está configurado. Una sola petición consulta varios
  motores y devuelve la URL del medio, un extracto real y la fecha, sin
  claves. Es el resultado de medir todas las alternativas sin clave (ver
  «Elección del buscador»). Sin él, la app cae al RSS de Bing Noticias y sigue
  funcionando sin configurar nada.
- **Quién publica**: el nivel de una fuente (primaria, medio de referencia u
  otra) no sale de una lista fija de dominios: esa lista dejaba a La Razón,
  Infobae o Las Provincias en el mismo cajón que un portal de empleo. Los
  dominios que la lista no conoce se clasifican una vez con el modelo de chat
  y se recuerdan en SQLite, con una lista de exclusión para lo que nunca es
  periodismo. Medido sobre los 41 dominios que citaron las capturas reales:
  98 % de acierto, 31 medios rescatados del cajón «otra».
- **Nada se da por zanjado sin anclaje**: una afirmación que no cita ninguna
  cifra, fecha ni entidad («los servicios públicos empeoran») queda siempre
  como provisional, por mucha evidencia que la acompañe. Las que sí nombran
  algo («cada año se forman 240.000 familias») mantienen el veredicto firme.
- **Selección de fuentes**: el reranker semántico descarta por debajo de 0,3.
  Una fuente que responde a la afirmación puntúa entre 0,89 y 0,99, mientras que
  «Historia del ferrocarril en España» puntuaba 0,198 para una afirmación sobre
  qué territorios piden más alta velocidad: con el umbral anterior de 0,05 se
  presentaba como evidencia. Además se excluyen por dominio las tiendas y los
  agregadores: preguntado por la inauguración del AVE Madrid-Ourense, el
  buscador keyless devolvía cuatro webs de venta de billetes.
- **Trazabilidad**: cada veredicto guarda qué conector corrió, cuántos
  resultados dio, cuánto tardó, qué consultas se lanzaron, cuántas fuentes
  descartó el reranker y con qué probabilidades pasó el gate. El panel de
  detalle lo muestra, así que una lista de fuentes vacía y un buscador caído ya
  no se parecen.
- **Cabeceras**: `next.config.ts` activa COOP/COEP porque WebGPU,
  SharedArrayBuffer y el modelo Parakeet/ONNX lo necesitan en el navegador.

## Requisitos

- **Node ≥ 22** (usa `node:sqlite`; probado con Node 26).
- **Chrome** (o Chromium) para `getDisplayMedia`/micrófono y WebGPU.
- Las cabeceras COOP/COEP ya vienen configuradas en `next.config.ts`; si sirves
  la app detrás de otro proxy, replícalas.
- npm.

## Instalación y arranque

```bash
npm install
cp env.example .env.local    # opcional: rellena NAN_KEY
npm run dev                  # http://localhost:3000
```

Sin `.env.local` la app arranca en modo simulado.

## Variables de entorno

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `NAN_KEY` | vacío | Clave de NaN. Sin ella, modo simulado. |
| `NAN_BASE_URL` | `https://api.nan.builders` | Origen para `npm run probe:nan`. |
| `NAN_CHAT_MODEL` | vacío | Modelo de chat para extraer claims. Vacío = heurístico. |
| `NAN_CHAT_URL` | `https://api.nan.builders/v1/chat/completions` | Endpoint del extractor chat. |
| `NAN_RERANK_URL` | vacío | Endpoint de rerank opcional. |
| `NAN_RERANK_MODEL` | vacío | Modelo de rerank. Ambos vacíos = ranker local. |
| `JINA_API_KEY` | vacío | Jina Reader para evidencia web. |
| `VERITAS_SEARXNG_URL` | vacío | SearXNG autoalojado (`npm run search:up` lo deja en `http://localhost:8099`). Es el mejor buscador medido y no necesita claves. |
| `VERITAS_SEARXNG_LANGUAGE` | `es` | Idioma que se le pide a SearXNG. |
| `VERITAS_SEARXNG_RESULTS` | `8` | Resultados que se le piden por consulta. |
| `VERITAS_SEARCH_PROVIDER` | auto | `auto`, `searxng`, `google`, `brave`, `bingnews`, `bing`, `gdelt` o `none`. `auto` usa SearXNG si está configurado, luego Google o Brave si hay clave, y si no `bingnews`. |
| `GOOGLE_API_KEY` + `GOOGLE_CSE_ID` | vacío | Google Custom Search (API oficial, 100 consultas/día gratis). |
| `BRAVE_SEARCH_API_KEY` | vacío | Brave Search API (2.000 consultas/mes gratis). |
| `VERITAS_ENABLE_WIKIPEDIA` | `true` | Wikipedia del lado servidor. |
| `VERITAS_ALLOW_PRIVATE_NETWORK` | `false` | Desactiva el guard SSRF (solo desarrollo). |
| `VERITAS_DB` | `~/.cache/veritas-live/veritas.sqlite` | Ruta de SQLite. Vive fuera del proyecto a propósito: si está dentro, cada escritura dispara un recompilado de Turbopack y la página entra en bucle de recarga. |
| `VERITAS_API_TOKEN` | vacío | Token opcional para POST mutantes. Vacío no exige login; para una demo pública usa un secreto largo. |
| `VERITAS_TRUST_PROXY` | `false` | Usa `X-Forwarded-For`/`X-Real-IP` para la cuota solo si el proxy los sanea. |
| `VERITAS_RATE_WINDOW_MS` | `60000` | Ventana de las cuotas MVP en memoria. |
| `VERITAS_RATE_IP_LIMIT` | `120` | Máximo por ventana, IP y tipo de operación. |
| `VERITAS_RATE_SESSION_LIMIT` | `90` | Máximo por ventana, sesión y tipo de operación. |
| `VERITAS_ACCESS_ATTEMPT_LIMIT` | `10` | Intentos de validar el token por IP; la ventana es de 15 min como mínimo. |
| `NEXT_PUBLIC_WHISPER_LANGUAGE` | `es` | Idioma del transcriptor. |

Nota: el endpoint de Clef (`https://api.nan.builders/v1/systemone`) está fijado
en `lib/config.ts`; `NAN_BASE_URL` solo afecta al script de diagnóstico.

Para una demo pública, define `VERITAS_API_TOKEN` solo en el servidor. El
usuario lo introduce en «Token de demo pública»: `/api/access` lo valida y
devuelve una cookie `HttpOnly`, sin incluir el secreto ni su valor configurado
en `/api/config`. Los clientes no navegador también pueden enviar
`Authorization: Bearer <token>` o `X-Veritas-Token`. El limitador es deliberadamente
MVP y por proceso; en despliegues con varias réplicas debe sustituirse por un
almacén compartido.

## Elección del buscador

La calidad de las fuentes la decide el buscador, así que se midieron todas las
opciones sin clave sobre las mismas ocho afirmaciones en español, puntuando
cada resultado con el reranker de NaN (relevancia 0-1, se cuenta «relevante» a
partir de 0,3):

| Proveedor | Afirmaciones con fuente relevante | Relevancia media | Latencia |
| --- | --- | --- | --- |
| **SearXNG autoalojado** | **8/8** | **0,93** | 1,1 s |
| Google News RSS | 7/8 | 0,82 | 0,4 s |
| SearXNG instancia pública | 7/8 | 0,77 | 5,6 s |
| Bing web RSS | 6/8 | 0,68 | 0,2 s |
| Bing Noticias RSS | 6/8 | 0,66 | 0,3 s |
| DuckDuckGo (html y lite) | 0/8 | — | responde un captcha |
| Mojeek | 0/8 | — | 403 a consultas automatizadas |

Notas de lo que se descartó y por qué:

- **DuckDuckGo** sirve un captcha («selecciona los patos») a cualquier petición
  de servidor, así que todas las librerías que lo raspan (`duck-duck-scrape`,
  `ddgs` y derivadas) son inservibles desde el backend. Dentro de SearXNG sí
  funciona, porque usa otro flujo.
- **Google News RSS** es el más relevante de los directos, pero sus enlaces van
  cifrados tras un muro de consentimiento y su descripción es solo el titular,
  sin texto del artículo que citar.
- **Instancias públicas de SearXNG**: de 40 instancias sanas, solo 1 respondía
  a `format=json`; el resto devuelve 403, 429 o HTML. Depender de una sola
  instancia voluntaria no es una base para un producto.
- **APIs con clave** (Brave, Google CSE, Tavily, Exa, Serper) siguen soportadas
  y son buenas, pero obligan a dar de alta una cuenta.

Para levantarlo:

```bash
npm run search:up      # SearXNG en http://localhost:8099
echo 'VERITAS_SEARXNG_URL=http://localhost:8099' >> .env.local
npm run search:down    # cuando acabes
```

La configuración vive en `search/settings.yml` (motores elegidos, JSON
activado, formato y limitador) y la imagen está fijada a una versión concreta
en `search/docker-compose.yml`, porque `latest` cambia a diario y con ella la
calidad de las búsquedas. El contenedor escucha solo en `127.0.0.1`.

## Demo

1. Abre http://localhost:3000.
2. Elige **Ver demo guionizada** para reproducir el discurso de 90 s sin
   micrófono, o usa pestaña/micrófono para audio real.
3. Observa los cinco tipos de resultado: respaldada, contradicha, engañosa,
   opinión y pendiente/no verificable.

El corpus está en `fixtures/evidence/corpus.json` y el discurso en
`fixtures/transcripts/demo.json`.

## Comprobar la integración con NaN

```bash
# Lee .env.local / .env; sin NAN_KEY no falla y no llama a nadie.
npm run probe:nan
```

El script llama al mismo endpoint `/v1/systemone` con el mismo contrato
`model/state/questions` que la app. Imprime estado HTTP, latencia, modelo,
tokens, probabilidades y PASS/FAIL de las expectativas (suma ≈ 1, rangos
válidos). Sale con código 1 ante un fallo HTTP, de parseo o de expectativas.

## Tests

```bash
npm test          # Vitest
npm run typecheck # tsc --noEmit
npm run check     # ambos
```

### Bancos de regresión con una captura real

`fixtures/transcripts/youtube-rail.json` son los 56 segmentos que Parakeet
produjo de verdad sobre una pestaña de YouTube, con sus repeticiones y su
ruido. Los dos bancos llaman a NaN y a la red, así que `npm test` los salta:

```bash
VERITAS_REPLAY=1 npx vitest run scripts/replay-detection.test.ts --disable-console-intercept
VERITAS_REPLAY=1 npx vitest run scripts/replay-evidence.test.ts --disable-console-intercept
VERITAS_REPLAY=1 npx vitest run scripts/replay-publishers.test.ts --disable-console-intercept
```

El primero vuelve a pasar la transcripción por la ventana y el gate e imprime
cada afirmación que publicaría, con sus probabilidades. El segundo lleva esas
afirmaciones por el canonicalizador, los conectores y la política de veredictos,
e imprime las fuentes que cita cada una. El tercero clasifica los dominios que
citaron las capturas reales contra una clave de respuestas hecha a mano. Son la referencia con la que se
calibraron los umbrales: sobre esa captura, la detección pasó de 3 afirmaciones
(una de ellas cortada a mitad de frase) a unas 20, con las 6 afirmaciones
contrastables de referencia encontradas.

## Problemas habituales

- **El micrófono no arranca**: concede permiso en el navegador; `getDisplayMedia`
  y el micrófono requieren HTTPS o `localhost`. Usa Chrome actualizado.
- **La primera transcripción tarda**: se descargan ~1,26 GB y se prepara el
  modelo en WebGPU. Espera a que termine y no recargues.
- **`SharedArrayBuffer is not defined` o el modelo no compila**: faltan
  COOP/COEP. Usa `npm run dev` (ya las añade) y no sirvas la app desde un proxy
  que las elimine.
- **Todo aparece como simulado**: falta `NAN_KEY` o está vacía. Es el
  comportamiento intencional; añade la clave y reinicia.
- **Error de `node:sqlite`**: estás en Node < 22. Cambia de versión de Node.
- **`no such table` o `no column named` tras tocar el esquema**: la conexión
  vive en `globalThis` y sobrevive al hot reload, así que un esquema escrito
  con el servidor en marcha no llegaba a aplicarse. `lib/db/client.ts` sella
  una versión de esquema y migra la conexión viva al detectar que está
  anticuada; si añades una tabla o una columna, sube `SCHEMA_VERSION`.
- **Sin red**: la app sigue funcionando con el fixture y el corpus local; los
  veredictos sin evidencia quedan como no verificables/provisionales.
