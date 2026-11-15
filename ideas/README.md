# Recomendación: construir ClefRoute

Las tres ideas son viables como producto, pero **ClefRoute** es la apuesta más fuerte para esta hackathon: hace que Clef tome una decisión imprescindible, convierte el ahorro en una visualización inmediata y funciona como demo comercial reutilizable para Helmcode.

## Decisión rápida

| Posición | Idea | Encaje con Clef | Impacto visual | Valor para Helmcode | Riesgo en 48 h |
|---:|---|---:|---:|---:|---:|
| 1 | [ClefRoute](01-clef-route/README.md) | 5/5 | 5/5 | 5/5 | Bajo |
| 2 | [Veritas Live](02-veritas-live/README.md) | 5/5 | 5/5 | 3/5 | Medio |
| 3 | [Radar de precios](03-radar-precios/README.md) | 3/5 | 4/5 | 2/5 | Alto |

La puntuación no mide el potencial a largo plazo, sino la probabilidad de conseguir una demo redonda durante el fin de semana.

## Qué construiría

**ClefRoute — el control de tráfico para IA soberana.** Cada prompt pasa por Clef, que decide:

1. qué clase de modelo necesita;
2. si contiene datos sensibles;
3. si puede salir de infraestructura europea;
4. si debe ejecutarse, anonimizarse o pedir confirmación.

El panel muestra el recorrido de cada petición y acumula ahorro estimado, latencia, decisiones privadas y porcentaje de tráfico servido por modelos abiertos. Es una prueba visible de la propuesta de Helmcode: modelos abiertos, datos en Europa y coste previsible.

## Por qué no empezaría por el scraper

El problema principal no es la IA, sino mantener conectores para tiendas que cambian HTML, bloquean bots, muestran precios distintos por ubicación y pueden prohibir el scraping en sus términos. Además, “encontrar el precio menor” es una comparación determinista; hay que diseñar otra decisión real para que Clef no sea decorativo.

Como alternativa de alcance, el plan propone comparar solo tres tiendas o feeds permitidos y usar Clef para decidir el **mejor valor real**, no el precio numérico más bajo.

## Cómo diferenciar el fact-check

El fact-check ya es un reto oficial. Para destacar, la demo debe centrarse en un formato distinto: un discurso en directo, afirmaciones que aparecen como tarjetas en una línea temporal y veredictos que cambian de “buscando” a “verificado”, siempre con fuente visible y la opción honesta “no verificable”.

## Restricciones confirmadas

- El objetivo oficial es que **Clef tome la decisión central**.
- Clef devuelve decisiones tipadas: `noul`, `choice` y `score`; no redacta texto.
- Conviene agrupar preguntas sobre un mismo estado en una llamada.
- La API permite una petición de Clef en vuelo por persona; la aplicación necesita una cola y reintento de `429`.
- El repositorio documenta un estado de unos 16.000 tokens, aunque la landing cita 64K. Para el MVP se adopta el límite conservador del repositorio.
- La aplicación debe mostrar probabilidades y tratar la incertidumbre, no ocultarla.

## Base común sin costes extra

| Capa | Elección propuesta | Coste adicional |
|---|---|---:|
| Interfaz | React/Vite o Next.js estático | 0 € |
| Backend | Node.js con API HTTP | 0 € |
| Decisión | Clef a través de NaN | Incluido en NaN |
| Redacción opcional | Un modelo de chat disponible en NaN | Incluido en NaN |
| Persistencia del MVP | SQLite | 0 € |
| Gráficas | CSS/SVG o Apache ECharts | 0 € |
| Despliegue de demo | Local con Docker Compose | 0 € |
| Licencia sugerida | Apache-2.0 | 0 € |

No se debe añadir Redis, una base de datos gestionada, un proveedor de búsqueda de pago o una API de scraping al MVP. Si una idea necesita información pública, debe funcionar con conectores gratuitos intercambiables y con datos de demostración reproducibles.

## Orden de trabajo recomendado

1. Validar diez casos directamente contra Clef y ajustar criterios.
2. Implementar un adaptador de Clef compartido, con cola de concurrencia uno, timeout y reintentos.
3. Construir el flujo completo con datos en memoria.
4. Añadir el panel visual y los acumuladores.
5. Guardar auditoría en SQLite.
6. Preparar una demo grabable de 90 segundos y un modo reproducible sin red.

## Fuentes de decisión

- [Landing del #2 Hackathon de NaN](https://nan.builders/es/2hackaton)
- [Repositorio y especificaciones obligatorias](https://github.com/helmcode/nan-hackathon-clef)
- [Qué hace Helmcode](https://helmcode.com/es/about)
- [Documentación de Helmcode](https://helmcode.com/docs)

