# Resultados del spike Parakeet

## Estado

**GO condicionado para el MVP.** La descarga, la caché y la inferencia local de Parakeet funcionan con margen amplio. La única comprobación pendiente es aceptar manualmente la captura de una pestaña con audio en el Chrome que se usará para la demo; macOS bloqueó la fuente de captura en los dos intentos automatizados, incluso con Chrome visible.

Esto no obliga a instalar Hex ni otro runtime. El navegador descarga el modelo una vez, lo conserva en OPFS y el audio no sale del equipo.

## Entorno medido

| Campo | Valor observado |
|---|---|
| Fecha | 2026-11-14 |
| Equipo | Apple M5 Pro, GPU integrada de 16 núcleos |
| Sistema | macOS |
| Navegador | Google Chrome 157.0.8103.51 |
| Node.js | 26.8.1 |
| `browser-whisper` | 2.0.0 |
| Modelo | `parakeet-tdt-0.6b-v3`, fp16 |
| WebGPU / `shader-f16` | Disponible / disponible |
| Aislamiento COOP/COEP | Activo |

## Resultado resumido

| Escenario | Resultado |
|---|---:|
| Primera descarga y carga | 133,61 s |
| Modelo guardado en OPFS | 1.257.267.110 bytes, 6 archivos |
| Segunda carga desde caché | 3,66 s |
| Audio español analizado | 32,58 s |
| Inferencia completa | 649 ms |
| Primer segmento | 394 ms |
| Velocidad respecto a tiempo real | 50,18× |
| Segmentos producidos | 8 |
| Errores de página en los benchmarks | 0 |

El heap JS pasó de 9.437.101 a 10.030.468 bytes durante la inferencia. Es una aproximación y no representa la memoria del modelo ni toda la memoria GPU. La medición precisa de Chrome no se usa en el camino crítico porque, en este equipo, llegó a pausar la página cerca de un minuto y falseaba el tiempo de inferencia.

## Calidad de la transcripción

Se generó una locución española reproducible de 32,5 segundos con afirmaciones factuales, una opinión y nombres propios. La salida conservó correctamente el contenido, la puntuación y los límites de frase. Entre otros fragmentos:

> Madrid es la capital de España y tiene más de 3 millones de habitantes. El agua hierve a 100 grados Celsius al nivel del mar.

También distinguió literalmente la frase que indicaba que la paella era una opinión y transcribió correctamente la referencia a la Eurocopa de 2024. La única rareza visible fue separar «de una transcripción local en español» como frase propia; no impide extraer afirmaciones.

Esto no es un benchmark formal de WER, pero sí valida la calidad necesaria para comenzar el extractor de claims del MVP.

## Verificaciones automáticas

| Comprobación | Resultado |
|---|---|
| TypeScript estricto | OK |
| Pruebas unitarias | OK, 4/4 |
| Build de producción | OK |
| Smoke de Chrome | OK |
| Auditoría npm, nivel moderado | 0 vulnerabilidades |

El smoke verificó que la página carga, queda `crossOriginIsolated`, detecta WebGPU y `shader-f16`, y dispone de una cuota de almacenamiento de 10 GB.

## Captura de una pestaña

El pipeline está implementado con `getDisplayMedia`, `AudioWorklet`, resampling a 16 kHz y una ventana móvil de 12 segundos cada 4 segundos. La prueba automatizada llegó a cargar el modelo desde caché en 3,11 s, pero Chrome devolvió `Could not start video source` tanto en modo headless como visible.

Este resultado señala un permiso/capacidad de captura del entorno de automatización de macOS, no un fallo de Parakeet. Antes de comenzar el Hito 2 hay que ejecutar una vez el flujo manual:

1. Abrir la página en Chrome normal con `npm run dev`.
2. Pulsar **Escuchar pestaña** mediante un gesto del usuario.
3. Elegir una pestaña de Chrome y activar **Compartir también el audio de la pestaña**.
4. Reproducir 30 segundos y confirmar que aparecen al menos dos ventanas.
5. Detener, comprobar que las pistas quedan cerradas y repetir una segunda sesión.
6. Exportar el JSON y anotar `skippedBusyWindows`; el criterio es como máximo una ventana omitida.

Una ventana o la pantalla completa puede no ofrecer audio en macOS. Para la demo se debe seleccionar una **pestaña de Chrome**. Si el sistema no lo permite, el vídeo local y `FixtureTranscriber` siguen siendo los caminos reproducibles.

## Decisión

Parakeet fp16 pasa como transcriptor principal: carga desde caché rápidamente, la inferencia supera ampliamente el umbral de 1,5× y la muestra española conserva suficiente precisión. No hace falta evaluar Whisper por rendimiento en este equipo.

La arquitectura debe mantener el adaptador intercambiable y el modo fixture. La captura de pestaña permanece como una puerta manual separada; no se considerará terminada hasta verificar el permiso real del Chrome de la demo.
