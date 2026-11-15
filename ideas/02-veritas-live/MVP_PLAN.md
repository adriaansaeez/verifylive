# Plan de desarrollo — Veritas Live MVP

## Decisión ejecutiva

Construiremos primero una aplicación web en Next.js que escucha el audio que el usuario ya está reproduciendo, lo transcribe dentro del navegador y muestra a la derecha afirmaciones verificables con su estado, veredicto y fuentes.

El MVP no descargará vídeos de YouTube o X. Tendrá tres entradas, en este orden:

1. **Escuchar una pestaña o ventana:** captura consentida con `getDisplayMedia`.
2. **Abrir un vídeo local:** reproducción con `<video>` y lectura de su pista de audio.
3. **Modo demo reproducible:** vídeo y transcripción preparados para que la presentación no dependa de permisos, red ni inferencia local.

Veritas descargará el modelo de transcripción en el primer uso, lo guardará en el almacenamiento local del navegador y lo ejecutará con WebGPU. El usuario no tendrá que instalar Hex ni ninguna aplicación auxiliar. Clef intervendrá una sola vez, después de recuperar y ordenar las evidencias, para emitir el veredicto final. La extensión de Chrome queda como fase siguiente, pero compartirá los mismos contratos de audio, transcripción y verificación.

## Qué entra en el MVP

| Incluido | Fuera del MVP |
|---|---|
| Captura consentida de audio de una pestaña/ventana | Descargar vídeos o saltarse protecciones de una plataforma |
| Reproducción de un archivo local sin subir el vídeo | Soporte completo de Firefox y Safari |
| Transcripción incremental dentro del navegador | Diarización de varios hablantes |
| Extracción de afirmaciones atómicas | Fact-check perfecto de cualquier tema |
| Evidencia desde corpus, Wikipedia y URLs conocidas | Crawler general de toda la web |
| NaN Rerank para ordenar evidencia y Clef para el veredicto | Publicación automática sin revisión humana |
| Fuentes y nivel de incertidumbre visibles | Extensión de Chrome publicada en la Store |
| Historial de revisiones del veredicto | Autenticación multiusuario |

El camino feliz de la demo debe funcionar sin instalar software auxiliar. El modelo local no necesita una clave; el backend usará `NAN_KEY` para Rerank y Clef, y `JINA_API_KEY` solo si se activa Jina Search.

## Experiencia del usuario

```text
1. En el primer uso, Veritas descarga y guarda el modelo de transcripción.
2. El usuario pulsa “Escuchar contenido”.
3. Chrome le pide elegir una pestaña o ventana y compartir su audio.
4. El contenido continúa sonando; el audio permanece en el equipo.
5. La transcripción aparece por segmentos debajo del reproductor.
6. Una frase factual crea una tarjeta a la derecha.
7. La tarjeta avanza: detectada → buscando → evaluando → resuelta.
8. El usuario abre la tarjeta y ve evidencia, contraevidencia y enlaces.
9. Si llega evidencia mejor, aparece una nueva revisión sin borrar la anterior.
```

La pantalla del MVP tendrá dos columnas:

- **Izquierda, 60 %:** vídeo o estado de captura, controles y transcripción sincronizada.
- **Derecha, 40 %:** timeline de afirmaciones. Las fuentes se abren dentro de cada tarjeta.

No se mostrará únicamente “verdadero” o “falso”. Los resultados serán:

- `supported`: respaldada por las fuentes;
- `contradicted`: contradicha por las fuentes;
- `misleading`: contiene una parte cierta pero omite contexto material;
- `unverifiable`: evidencia insuficiente, conflictiva o afirmación no factual.

## Arquitectura propuesta

```text
┌──────────────────────────── navegador ─────────────────────────────┐
│ pestaña/ventana o vídeo local                                      │
│          │                                                         │
│          ▼                                                         │
│ AudioWorklet: mono, PCM f32, 16 kHz                                │
│          │                                                         │
│          ▼                                                         │
│ Web Worker + WebGPU                                                │
│ Parakeet TDT 0.6B v3 (ONNX, cacheado en OPFS)                      │
│          │ segmentos + timestamps                                  │
│          ▼                                                         │
│ cliente de sesión ◀────────────── SSE: estados y resultados        │
└──────────┼───────────────────────────────────────────▲──────────────┘
           │ texto                                      │
           ▼                                             │
┌──────────────────────── backend Next.js ──────────────┴───────────┐
│ Session orchestrator                                               │
│   ├── ClaimExtractor ───▶ modelo de chat de NaN                    │
│   ├── EvidencePipeline                                            │
│   │     ├── Jina Search / corpus / URLs / Wikipedia               │
│   │     ├── normalización y deduplicación                         │
│   │     └── NaN Rerank: relevancia                               │
│   ├── VerdictQueue ─────▶ Clef: veredicto final                   │
│   └── SQLite: sesión, claims, fuentes y revisiones                 │
└────────────────────────────────────────────────────────────────────┘
```

El audio y el modelo permanecen en el navegador. El backend recibe texto y timestamps, nunca audio ni vídeo. Para la demo se ejecutará Next.js con runtime Node y SQLite; esta decisión no condiciona una futura versión desplegada.

## Captura de audio

### Opción A — Escuchar otra pestaña o ventana

La web solicitará:

```ts
navigator.mediaDevices.getDisplayMedia({
  video: true,
  audio: {
    suppressLocalAudioPlayback: false,
  },
});
```

Aunque solo necesitemos audio, `getDisplayMedia` requiere solicitar vídeo. La pista de vídeo no se enviará ni guardará. El usuario tendrá que dar permiso en cada sesión y deberá marcar que comparte audio.

Limitaciones que la interfaz debe explicar:

- Chrome puede devolver un stream sin audio según el sistema operativo y el origen elegido.
- No podemos seleccionar una pestaña por el usuario ni conservar el permiso.
- Si no hay pista de audio, la sesión no empieza y se muestra una instrucción concreta para reintentar.
- YouTube, X y otras plataformas se escuchan como contenido reproducido; no se scrapea ni descarga su archivo multimedia.

### Opción B — Vídeo local

El usuario selecciona un archivo y el navegador crea un `ObjectURL`. El archivo se reproduce localmente en `<video>` y su audio entra al mismo pipeline mediante Web Audio. El vídeo completo no se sube al servidor.

### Normalización común

Un `AudioWorkletProcessor` convertirá ambas entradas a:

- un canal;
- 16.000 Hz;
- `Float32` little-endian;
- bloques de 250–500 ms;
- contador monotónico `audioOffsetMs` por sesión.

El cliente aplicará backpressure: no acumulará audio indefinidamente si la inferencia va más lenta que el directo. La cadencia se adaptará al tiempo real de inferencia; al terminar se procesará la última ventana y se cerrarán todas las pistas.

## Transcripción local integrada

### Modelo elegido

El candidato principal es **NVIDIA Parakeet TDT 0.6B v3**, el mismo modelo base disponible en Hex, pero convertido a ONNX para ejecutarlo en el navegador:

- 25 idiomas europeos, incluido español;
- detección automática de idioma;
- puntuación, mayúsculas y timestamps de palabra;
- licencia CC BY 4.0;
- ejecución local mediante WebGPU.

No reutilizaremos directamente el GGUF de Hex. Ese artefacto necesita su runtime nativo; la web utilizará los pesos ONNX compatibles con `parakeet.js`/ONNX Runtime Web.

### Descarga y almacenamiento

En el primer uso:

1. Veritas comprueba WebGPU y espacio disponible.
2. Explica que descargará aproximadamente 1,26 GB y pide confirmación.
3. Descarga los pesos mostrando progreso y posibilidad de cancelar.
4. Los guarda en OPFS/cache del navegador.
5. Calienta el modelo con un audio corto antes de habilitar “Escuchar contenido”.

Las siguientes sesiones reutilizan el modelo sin descargarlo otra vez. La configuración ofrecerá “Eliminar modelo local”. Una actualización de versión utilizará una clave de caché distinta y eliminará la anterior solo después de validar la nueva.

Chrome de escritorio con WebGPU es el objetivo del MVP. Si WebGPU no está disponible, se ofrecerá `whisper-small` mediante WASM como fallback posterior al spike; no se enviará audio a la nube silenciosamente.

### Transcripción casi en directo

Parakeet TDT v3 no es un decoder de streaming puro en esta integración. Mantendremos un buffer deslizante:

1. Conservar los últimos 10–20 segundos de PCM.
2. Ejecutar una inferencia cada 2–4 segundos, según el rendimiento observado.
3. Considerar tentativas las palabras de los últimos 3 segundos.
4. Congelar las palabras anteriores y emitir un segmento estable.
5. Retroceder la cadencia si una inferencia tarda demasiado, evitando crear cola.

La reproducción nunca esperará al transcriptor. La interfaz mostrará la distancia entre el tiempo reproducido y el último segmento estable.

### Contrato intercambiable

```ts
interface LocalTranscriberPort {
  prepare(input: {
    model: "parakeet-tdt-0.6b-v3" | "whisper-small";
    onProgress: (progress: ModelProgress) => void;
  }): Promise<void>;
  start(input: { sessionId: string }): Promise<void>;
  pushPcm(chunk: Float32Array, audioOffsetMs: number): void;
  finish(): Promise<TranscriptSegment[]>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
  events(): AsyncIterable<LocalTranscriberEvent>;
}
```

Habrá dos adaptadores desde el primer día:

- `ParakeetWebTranscriber`: camino real local en Web Worker/WebGPU.
- `FixtureTranscriber`: reproduce una transcripción con timestamps para pruebas y demo de respaldo.

### Spike obligatorio antes de construir la UI

El harness ejecutable está en [`../../spikes/parakeet-browser/`](../../spikes/parakeet-browser/) y sus mediciones en [`RESULTS.md`](../../spikes/parakeet-browser/RESULTS.md). Parakeet fp16 pasa la puerta de rendimiento: 3,66 s desde caché y 50,18× tiempo real sobre 32,58 s de español. La captura de pestaña mantiene una validación manual pendiente porque macOS rechazó la fuente en el navegador automatizado.

Antes de construir la UI final hay que medir en el portátil de la demo:

- tiempo y fiabilidad de la descarga inicial;
- español e inglés con audio real de YouTube;
- calidad de segmentos tentativos y finales;
- tiempo desde frase terminada hasta segmento;
- consumo de CPU/RAM;
- soporte de `shader-f16` y comportamiento con cuantización `q8`;
- comportamiento al pausar y reanudar;
- limpieza real de workers, GPU y pistas al cancelar.

Si Parakeet no mantiene una latencia aceptable en el portátil de la demo, se comparará `whisper-small` antes de fijar el adaptador. El modo preparado seguirá garantizando la presentación.

## De transcripción a afirmaciones

No se mandará cada palabra al modelo. Solo se procesarán segmentos finales.

1. Acumular 1–3 frases o hasta 8 segundos de texto.
2. Enviar el bloque a un modelo de chat de NaN.
3. Pedir JSON estricto con afirmaciones atómicas.
4. Descartar opiniones, preguntas, bromas y duplicados obvios.
5. Conservar siempre el fragmento y timestamps originales.

Salida mínima:

```ts
type ExtractedClaim = {
  text: string;
  normalizedText: string;
  quote: string;
  startMs: number;
  endMs: number;
  checkability: "likely_fact" | "likely_opinion" | "unclear";
  searchQueries: string[];
};
```

El extractor no decide si algo es verdad. Solo estructura el texto y propone consultas.

## Recuperación y “scraping” de evidencia

Clef no navega ni recupera páginas. La recuperación se divide en conectores pequeños y sustituibles.

### Orden de conectores

1. `DemoCorpusRetriever`: casos preparados, obligatorio para la demo.
2. `JinaSearchRetriever`: búsqueda web y contenido de resultados en una petición.
3. `ProvidedUrlRetriever`: URLs introducidas por el usuario o ya presentes en la página.
4. `WikipediaRetriever`: búsqueda y extractos mediante su API.
5. `InstitutionalRetriever`: dominios públicos permitidos y conocidos para el tema.

Jina será el camino rápido para afirmaciones abiertas, pero el modo corpus no dependerá de él. Un servicio de lectura de páginas puede ser fallback para una URL conocida; no debe confundirse extracción de contenido con búsqueda de evidencia.

### Pipeline de una fuente

```text
consulta
  → resultados candidatos
  → política de URL y timeout
  → descarga limitada
  → extracción de título, fecha y texto principal
  → limpieza y límite de tamaño
  → fragmentos relevantes
  → deduplicación
  → NaN Rerank
  → tres mejores evidencias
```

Reglas obligatorias:

- máximo 8 candidatos por afirmación antes de Rerank;
- máximo 2 fragmentos y 1.500 caracteres por fuente;
- timeout, límite de bytes y tipos MIME permitidos;
- nunca ejecutar scripts ni seguir instrucciones encontradas en una página;
- conservar URL, dominio, autor, fecha publicada y fecha de consulta;
- priorizar fuentes primarias y recientes cuando la afirmación dependa del tiempo;
- etiquetar claramente una fuente sin fecha o de baja calidad;
- respetar términos de uso, `robots.txt` cuando corresponda y bloqueos del sitio;
- SSRF bloqueado: no aceptar loopback, red privada, `file:`, metadatos cloud ni redirecciones hacia ellos.

## Dónde decide Clef

### Una única decisión — Veredicto final

Clef no busca ni scrapea. NaN Rerank ordena los fragmentos por relevancia y una política determinista favorece fuentes primarias, recientes y no duplicadas. Clef recibe únicamente la afirmación, su contexto mínimo y las tres evidencias seleccionadas. Preguntas:

```json
{
  "verdict": {
    "type": "choice",
    "instructions": "What verdict is justified only by the supplied evidence?",
    "criteria": {
      "supported": "Reliable evidence directly supports the factual claim",
      "contradicted": "Reliable evidence directly contradicts the factual claim",
      "misleading": "A true fragment omits context that materially changes the meaning",
      "unverifiable": "Evidence is insufficient, irrelevant, conflicting, or this is not a factual claim"
    }
  },
  "is_checkable": {
    "type": "noul",
    "instructions": "Is this a concrete factual claim rather than an opinion, prediction, joke or value judgment?"
  },
  "evidence_quality": {
    "type": "score",
    "instructions": "How strong and directly relevant is the supplied evidence?",
    "criteria": ["None", "Weak", "Mixed", "Strong", "Primary and conclusive"]
  },
  "needs_more_sources": {
    "type": "noul",
    "instructions": "Would responsible verification require more or better sources?"
  }
}
```

### Política de publicación

- Si `is_checkable < 0.65`, publicar `unverifiable`.
- Si la confianza del `verdict < 0.65`, publicar `unverifiable` y explicar que falta evidencia.
- Si `needs_more_sources > 0.65`, mostrar “resultado provisional”.
- Nunca convertir la confianza de Clef en “probabilidad matemática de que sea verdad”.
- La etiqueta visible siempre dirá “según estas fuentes”.

Estos umbrales son iniciales; se calibrarán contra el corpus antes de la demo.

### Cola y latencia

La API de Clef solo admite una petición concurrente por persona. Los veredictos pasarán por una única `ClefQueue`:

- una petición en vuelo;
- reintento con backoff para `429`, `502` y `504`;
- prioridad a veredictos finales frente a reanálisis no visible;
- deduplicación por hash de afirmación + evidencia;
- timeout explícito;
- métricas de espera y ejecución.

Objetivo del MVP: tarjeta detectada en menos de 3 segundos tras cerrar una frase y primer veredicto en menos de 12 segundos cuando los conectores responden.

## Modelo de datos

```ts
type Session = {
  id: string;
  sourceType: "tab" | "local_file" | "fixture";
  status: "idle" | "capturing" | "finishing" | "finished" | "failed";
  createdAt: string;
};

type TranscriptSegment = {
  id: string;
  sessionId: string;
  startMs: number;
  endMs: number;
  text: string;
  final: boolean;
};

type Claim = {
  id: string;
  sessionId: string;
  segmentId: string;
  text: string;
  quote: string;
  startMs: number;
  endMs: number;
  status: "detected" | "searching" | "evaluating" | "resolved" | "failed";
};

type Evidence = {
  id: string;
  claimId: string;
  url: string;
  title: string;
  publisher?: string;
  publishedAt?: string;
  retrievedAt: string;
  excerpt: string;
  sourceTier: "primary" | "reliable_secondary" | "other";
  stance?: "supports" | "contradicts" | "context";
};

type DecisionRevision = {
  id: string;
  claimId: string;
  revision: number;
  verdict: "supported" | "contradicted" | "misleading" | "unverifiable";
  confidence: number;
  checkableProbability: number;
  evidenceQualityScore: number;
  needsMoreSourcesProbability: number;
  evidenceIds: string[];
  createdAt: string;
};
```

SQLite será la fuente de verdad. SSE solo transporta cambios; al reconectar, el cliente recupera el snapshot de la sesión y continúa desde el último evento conocido.

## Contratos internos y estructura prevista

```text
apps/web/
  app/
    page.tsx
    api/sessions/...
  components/
    capture-panel.tsx
    transcript-timeline.tsx
    claim-card.tsx
    evidence-drawer.tsx
  lib/
    audio/
      pcm-worklet.ts
      capture-controller.ts
    transcribers/
      port.ts
      parakeet-web.ts
      fixture.ts
    model-cache/
      download.ts
      storage.ts
    claims/
      extract.ts
      schema.ts
    evidence/
      port.ts
      corpus.ts
      wikipedia.ts
      provided-url.ts
      jina-search.ts
      normalize.ts
      rank.ts
    rerank/
      client.ts
    clef/
      client.ts
      queue.ts
      verdict.ts
    sessions/
      orchestrator.ts
      events.ts
    db/
      schema.ts
      client.ts
fixtures/
  claims.json
  transcripts/
  evidence/
```

Endpoints mínimos:

| Endpoint | Uso |
|---|---|
| `POST /api/sessions` | Crear sesión; el audio permanece en el navegador |
| `POST /api/sessions/:id/segments` | Recibir segmentos estables con timestamps |
| `POST /api/sessions/:id/finish` | Marcar el final de la transcripción local |
| `DELETE /api/sessions/:id` | Cancelar la sesión de verificación |
| `GET /api/sessions/:id` | Snapshot para carga o reconexión |
| `GET /api/sessions/:id/events` | SSE de transcript, claims y decisiones |
| `POST /api/claims/:id/recheck` | Reevaluar tras añadir evidencia |

## Orden de implementación

### Hito 0 — Spikes y contratos (2–3 horas)

- [ ] Probar una llamada real a Clef e imprimir la respuesta completa.
- [ ] Verificar la cola de una sola petición y el tratamiento de errores.
- [x] Descargar Parakeet ONNX, cargarlo con WebGPU y transcribir una muestra española.
- [ ] Probar el buffer deslizante en español e inglés y anotar latencia real. El buffer y las métricas ya están implementados; falta autorizar la fuente de captura real.
- [ ] Confirmar captura de pestaña con audio en el portátil y Chrome de la demo.
- [ ] Probar Jina Search + NaN Rerank sobre una afirmación real.
- [ ] Congelar `LocalTranscriberPort`, `Retriever` y los eventos de sesión.

**Puerta de salida:** una página web descarga el modelo, convierte audio reproducido en un segmento y obtiene un veredicto de Clef sobre evidencia recuperada y reordenada.

### Hito 1 — Camino vertical reproducible (4–5 horas)

- [ ] Crear la app Next.js, SQLite y configuración de entorno.
- [ ] Implementar `FixtureTranscriber` y un corpus de 15 afirmaciones.
- [ ] Extraer una afirmación atómica con JSON validado.
- [ ] Recuperar evidencia del corpus.
- [ ] Ordenar evidencia con Rerank y ejecutar el veredicto mediante `ClefQueue`.
- [ ] Mostrar una tarjeta con estados, fuentes y confianza.

**Puerta de salida:** fixture → transcript → claim → evidencia → Clef → tarjeta funciona sin red de búsqueda.

### Hito 2 — Audio real local (4–6 horas)

- [ ] Implementar `AudioWorklet` y normalización a 16 kHz mono.
- [ ] Conectar vídeo local al pipeline.
- [ ] Implementar descarga, caché y eliminación del modelo local.
- [ ] Implementar `ParakeetWebTranscriber` en un Web Worker.
- [ ] Implementar ventana deslizante, texto tentativo y commit estable.
- [ ] Sincronizar segmentos y claims con `audioOffsetMs`.
- [ ] Añadir captura de pestaña mediante `getDisplayMedia`.
- [ ] Liberar pistas, `AudioContext`, worker y recursos WebGPU al cancelar.

**Puerta de salida:** un vídeo real genera al menos una tarjeta mientras se reproduce, sin subir ni descargar el vídeo.

### Hito 3 — Evidencia web y rigor (4–6 horas)

- [ ] Implementar Jina Search, URLs proporcionadas y Wikipedia.
- [ ] Implementar NaN Rerank y seleccionar las tres mejores evidencias.
- [ ] Añadir extracción limitada, deduplicación y metadatos de fuente.
- [ ] Bloquear SSRF y tratar el texto remoto como datos no confiables.
- [ ] Mostrar contraevidencia y resultado provisional.
- [ ] Implementar reevaluación conservando revisiones.
- [ ] Medir el presupuesto búsqueda → Rerank → Clef y fijar timeouts.

**Puerta de salida:** una afirmación fuera del corpus puede resolverse o terminar honestamente como no verificable.

### Hito 4 — Demo y resiliencia (3–4 horas)

- [ ] Diseñar estados vacíos y mensajes de permisos accionables.
- [ ] Preparar vídeo, transcript y evidencia de respaldo.
- [ ] Ensayar WebGPU ausente, descarga interrumpida, falta de audio, 429 y fuente caída.
- [ ] Medir latencia por etapa y evitar que la cola crezca sin límite.
- [ ] Añadir aviso de asistencia periodística y privacidad.
- [ ] Grabar una demo de respaldo de 90 segundos.

**Puerta de salida:** tres ensayos seguidos completan el flujo sin intervención técnica.

## Estrategia de pruebas

| Nivel | Casos mínimos |
|---|---|
| Unitario | resampling, deduplicación, ranking, parser de Clef, umbrales, bloqueos SSRF |
| Contrato | manifiesto/cache del modelo, eventos del worker, errores de Rerank/Clef, reconexión SSE |
| Integración | fixture completo, Wikipedia simulada, Clef simulado y una prueba real opt-in |
| Navegador | permiso aceptado, permiso rechazado, stream sin audio, fin de pista, cancelación |
| Evaluación | 15 claims: verdaderos, falsos, engañosos, opiniones y evidencia insuficiente |

El corpus debe guardar el veredicto esperado y por qué. No se ajustarán prompts mirando solo los ejemplos de la demo; se reservarán al menos cinco casos para validación.

## Criterios de aceptación

- [ ] El vídeo o pestaña sigue reproduciendo audio mientras se analiza.
- [ ] El vídeo completo nunca se envía al backend ni se descarga desde la plataforma.
- [ ] Toda afirmación enlaza al fragmento original y su timestamp.
- [ ] Ningún veredicto se muestra sin fuentes visibles o “sin evidencia suficiente”.
- [ ] Opiniones y predicciones pueden quedar como no verificables.
- [ ] El audio nunca sale del navegador; el backend solo recibe texto y timestamps.
- [ ] Clef participa de forma observable en el veredicto final.
- [ ] La confianza se presenta como confianza de la decisión, no como certeza factual.
- [ ] Solo hay una petición de Clef en vuelo.
- [ ] Añadir evidencia crea una revisión y conserva la anterior.
- [ ] Cancelar una sesión libera pistas, contexto de audio, worker, WebGPU y conexión SSE.
- [ ] La demo completa puede ejecutarse con fixtures si falla WebGPU o una fuente externa.

## Camino hacia la extensión de Chrome

La extensión no debe tener un segundo backend ni otro sistema de verificación. Sustituirá únicamente la captura y la presentación:

```text
MVP web                         Extensión Chrome
getDisplayMedia                chrome.tabCapture
página de Veritas              Side Panel
AudioWorklet                   AudioWorklet en offscreen document
misma Session API         ───▶ misma Session API
misma timeline                 tarjetas en Side Panel / overlay opcional
```

La extensión Manifest V3 requerirá gesto del usuario para iniciar `tabCapture`. Un `offscreen document` mantendrá el stream aunque se cierre el popup o la pestaña navegue. El Side Panel mostrará las tarjetas; no inyectaremos un overlay en YouTube/X durante el primer prototipo para reducir permisos y fragilidad.

## Riesgos y decisiones ya tomadas

| Riesgo | Decisión |
|---|---|
| Primera descarga de aproximadamente 1,26 GB | Progreso visible, caché persistente y descarga previa a la demo |
| WebGPU no disponible o GPU incompatible | Diagnóstico previo, cuantización `q8` y spike de fallback Whisper/WASM |
| Parakeet no ofrece streaming nativo | Ventana deslizante, commit a 3 s y cadencia adaptativa |
| Chrome no entrega audio | Detectar ausencia de pista y guiar al usuario |
| Una búsqueda gratuita cambia o falla | Corpus obligatorio y conectores intercambiables |
| Clef se convierte en decorativo | Es la única autoridad del veredicto final y su salida queda visible |
| La cola de Clef crece durante un discurso rápido | Debounce, deduplicación y máximo de claims pendientes |
| Una fuente intenta prompt injection | Contenido delimitado, truncado y sin capacidad de ejecutar herramientas |
| Una URL accede a red interna | Política SSRF antes y después de redirecciones |
| Resultado potencialmente difamatorio | “Según estas fuentes”, provisional, historial y revisión humana |

## Documentación técnica de referencia

- Parakeet TDT 0.6B v3: <https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3>
- Runtime web evaluado: <https://github.com/tanpreetjolly/browser-whisper>
- Referencia de transcripción deslizante: <https://github.com/ajsteiger/parakeet_web>
- Transformers.js: <https://huggingface.co/docs/transformers.js/index>
- Captura web: <https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia>
- Captura en extensiones: <https://developer.chrome.com/docs/extensions/reference/api/tabCapture>
- Referencia de Clef de este repositorio: [`../../docs/api.md`](../../docs/api.md)

## Primera tarea de desarrollo

Ejecutar el **Hito 0** sin construir todavía la interfaz final. Sus resultados decidirán cuantización, tamaño de ventana, fallback y presupuesto real de latencia. Cuando los spikes funcionen, se congela el contrato y comienza el camino vertical del Hito 1.
