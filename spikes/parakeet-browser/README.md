# Spike: Parakeet local en el navegador

Este harness responde una pregunta antes de construir Veritas Live: ¿puede un navegador de escritorio descargar Parakeet TDT 0.6B v3 una vez y transcribir audio español con retraso suficientemente bajo para seguir un vídeo en directo?

## Resultado

El usuario no instala Hex ni otra aplicación. La web descarga el modelo, lo guarda en OPFS y procesa el audio localmente. El backend de Veritas recibirá únicamente segmentos de texto y timestamps.

El benchmark en el portátil de desarrollo dio **3,66 s de carga desde caché** y procesó **32,58 s de español en 649 ms (50,18× tiempo real)**. La descarga inicial tardó 133,61 s y ocupó 1,257 GB. La captura automatizada de pestaña quedó bloqueada por macOS y conserva una puerta de prueba manual. El detalle y la decisión están en [`RESULTS.md`](RESULTS.md).

## Ejecutar

Requisitos: Chrome de escritorio con WebGPU y al menos 2 GB libres para la prueba.

```bash
cd spikes/parakeet-browser
npm install
npm run dev
```

Abrir <http://127.0.0.1:5173> y seguir este orden:

1. Confirmar que WebGPU, `shader-f16` y aislamiento aparecen en el diagnóstico.
2. Elegir `fp16` si `shader-f16` está disponible; en caso contrario usar `q8`.
3. Pulsar **Descargar y cargar**. La variante fp16 ronda 1,26 GB.
4. Transcribir un archivo español de 30–60 segundos.
5. Iniciar **Escuchar pestaña**, seleccionar una pestaña con audio y dejarla sonar al menos 30 segundos.
6. Exportar el JSON de resultados.

La segunda carga debe reutilizar OPFS y ser claramente más rápida que la primera.

## Qué mide

| Métrica | Para qué sirve |
|---|---|
| `downloadAndLoadMs` | Coste de la primera carga y eficacia de la caché |
| `firstSegmentMs` | Tiempo hasta obtener texto visible |
| `wallMs` | Duración de cada inferencia |
| `realtimeFactor` | Audio procesado / tiempo de inferencia; debe ser mayor que 1 |
| `skippedBusyWindows` | Indica que el modelo no mantiene la cadencia del directo |
| memoria antes/después | Aproximación al coste del modelo en el navegador |

La memoria usa el heap JS expuesto por Chrome y puede devolver `null`; no incluye de forma fiable toda la memoria GPU. La API precisa de memoria queda fuera del camino crítico porque puede pausar la página durante cerca de un minuto.

## Implementación del directo

El spike no afirma que Parakeet sea un decoder streaming nativo. Captura PCM con `AudioWorklet`, conserva una ventana móvil de 12 segundos y ejecuta una inferencia cada 4 segundos. Si una inferencia sigue activa, omite el siguiente ciclo en lugar de acumular retraso.

Los resultados de ventanas solapadas se muestran completos para facilitar la inspección. La deduplicación y el commit estable de palabras pertenecen al MVP, no a este spike.

## Puerta de decisión

Parakeet pasa al MVP si, en el portátil de la demo:

- WebGPU carga el modelo dos veces seguidas sin errores;
- el segundo arranque reutiliza la caché;
- `realtimeFactor > 1.5` en un archivo español representativo;
- el modo pestaña no omite más de una ventana en 30 segundos;
- la transcripción conserva suficiente precisión para extraer afirmaciones;
- detener la captura libera pistas y permite iniciar otra sesión.

Si falla por rendimiento, se compara `whisper-small_timestamped` con el mismo contrato. Si falla por disponibilidad de WebGPU, el modo fixture sigue siendo el respaldo de la demo; no se sube audio a la nube sin consentimiento.

## Verificación de código

```bash
npm run check
```

Ejecuta TypeScript estricto, pruebas del resampler/buffer y build de producción.

Con el servidor de desarrollo abierto, el smoke test carga la página en Chrome y verifica COOP/COEP y el diagnóstico de WebGPU:

```bash
npm run smoke
```

Chrome headless puede comportarse de forma distinta al Chrome visible. El smoke comprueba que la interfaz detecta y explica el estado de WebGPU; no sustituye el benchmark interactivo de captura.

Para medir únicamente descarga, carga y caché de Parakeet en un perfil persistente de Chrome:

```bash
npm run benchmark:model
```

Por defecto usa fp16, conserva la caché en `/tmp/veritas-parakeet-chrome-profile` y espera hasta 15 minutos. Se puede cambiar con `SPIKE_QUANTIZATION`, `SPIKE_PROFILE` y `SPIKE_TIMEOUT_MS`.

Con un archivo ya disponible, el benchmark automatizado de inferencia reutiliza el mismo perfil:

```bash
SPIKE_AUDIO=/ruta/audio-espanol.mp3 npm run benchmark:file
```

El benchmark de directo crea una pestaña fuente, reproduce ese mismo audio y solicita su captura durante 30 segundos:

```bash
SPIKE_AUDIO=/ruta/audio-espanol.mp3 npm run benchmark:live
```

Usa flags de Chrome para seleccionar la fuente automáticamente. Si macOS rechaza la fuente en modo headless, ejecutar Chrome visible con `SPIKE_HEADLESS=false npm run benchmark:live`; la prueba interactiva sigue siendo la autoridad.

## Alcance deliberadamente excluido

- extracción de afirmaciones;
- búsqueda y fact-check;
- deduplicación final entre ventanas;
- soporte móvil;
- benchmark de precisión formal;
- publicación del modelo desde infraestructura propia.

## Dependencias y licencias

- `browser-whisper` 2.0.0: MIT.
- Parakeet TDT 0.6B v3: CC BY 4.0.
- Conversión ONNX: modelos de `istupakov`/`ysdede` consumidos por `browser-whisper`.
- ONNX Runtime Web/parakeet.js: cargados por la librería para este modelo.

El código no redistribuye los pesos: el navegador los obtiene en el primer uso desde el repositorio configurado por la librería.
