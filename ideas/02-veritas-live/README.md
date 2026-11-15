# Veritas Live: fact-check visual de discursos

Veritas Live convierte un discurso o entrevista en una línea temporal de afirmaciones verificables. Recupera evidencia pública, pide a Clef un veredicto con incertidumbre y muestra cada fuente junto a la frase original.

> El plan técnico actualizado del MVP —captura de audio, modelo Parakeet descargado y ejecutado en el navegador, recuperación rápida de evidencia y decisión final de Clef— está en [`MVP_PLAN.md`](MVP_PLAN.md). El [spike ejecutable](../../spikes/parakeet-browser/) ya valida descarga, caché e inferencia local; solo queda confirmar manualmente el permiso de captura de pestaña en el Chrome de la demo.

## La propuesta en una frase

> “Mientras alguien habla, las afirmaciones aparecen en pantalla y pasan de pendiente a verdadera, falsa, engañosa o no verificable, siempre con las fuentes a la vista.”

## El giro que la hace competitiva

Un formulario que recibe una frase sería la implementación más obvia del reto oficial. La diferencia aquí es la **experiencia de retransmisión**:

- línea temporal en vivo;
- afirmaciones compuestas divididas en unidades pequeñas;
- evidencia y contraevidencia visibles;
- estado explícito “no verificable”;
- correcciones posteriores sin borrar el veredicto anterior;
- exportación de una tarjeta compartible con frase, resultado y enlaces.

## Flujo del producto

```text
audio o texto
   │
   ▼
transcripción ──▶ extraer afirmaciones ──▶ buscar evidencia pública
                                              │
                                              ▼
                                      Clef toma el veredicto
                                              │
                                              ▼
                                  timeline + confianza + fuentes
```

Para el MVP, la captura consentida de audio y la transcripción local dentro del navegador son el camino principal. Veritas descarga y guarda su propio modelo; el usuario no instala Hex ni otra aplicación. Una transcripción preparada con timestamps seguirá siendo el respaldo reproducible si fallan los permisos, WebGPU o una fuente externa.

## Decisión central de Clef

Cada afirmación y sus evidencias forman un estado. Las preguntas se agrupan:

```json
{
  "model": "clef",
  "state": "Claim: ...\nEvidence [1]: title, date, excerpt, URL...\nEvidence [2]: ...",
  "questions": {
    "verdict": {
      "type": "choice",
      "instructions": "What verdict is justified by the supplied evidence?",
      "criteria": {
        "supported": "Reliable evidence directly supports the factual claim",
        "contradicted": "Reliable evidence directly contradicts the factual claim",
        "misleading": "The claim uses a true fragment but omits context that materially changes its meaning",
        "unverifiable": "The evidence is insufficient, irrelevant, conflicting, or the statement is an opinion"
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
}
```

La interfaz convierte `supported` en “verdadero según las fuentes” y `contradicted` en “falso según las fuentes”. No presenta la probabilidad del modelo como probabilidad matemática de verdad.

## Fuentes sin coste

El proyecto necesita conectores intercambiables y ordenados por calidad:

1. URLs y documentos proporcionados por el usuario.
2. Wikipedia/Wikidata para hechos estables.
3. Portales de datos abiertos y sitios institucionales mediante búsqueda limitada.
4. GDELT para descubrir noticias, sujeto a disponibilidad y calidad.
5. Un corpus local preparado para la demo.

No se debe depender de una API de búsqueda de pago. Un conector gratuito puede cambiar sus límites o fallar, por lo que el corpus reproducible es obligatorio para la presentación.

“Sin coste” no significa “sin dependencia”: cada conector debe mostrar su origen, licencia, fecha de consulta y limitaciones.

## Arquitectura del MVP

| Componente | Responsabilidad |
|---|---|
| `ingest` | Capturar audio de una pestaña o vídeo local y recibir segmentos incrementales |
| `claim-extractor` | Usar un modelo de chat de NaN para producir afirmaciones atómicas en JSON |
| `retrievers` | Obtener documentos de fuentes gratuitas o del corpus local |
| `ranker` | Eliminar duplicados y seleccionar fragmentos relevantes |
| `clef-verifier` | Emitir veredicto, verificabilidad y calidad de evidencia |
| `store` | Guardar afirmaciones, cambios de veredicto y fuentes en SQLite |
| `web/timeline` | Mostrar estados y tarjetas compartibles |

Clef decide el veredicto. El modelo de chat solo estructura el texto y puede redactar una explicación breve basada exclusivamente en el resultado y las fuentes.

## Experiencia visual

- Columna izquierda: transcripción con la frase activa resaltada.
- Columna central: tarjetas de afirmación que avanzan por `detectada → buscando → evaluando → veredicto`.
- Columna derecha: evidencia con fecha, dominio y fragmento.
- Una banda superior resume verdadero, falso, engañoso y no verificable.
- Al corregirse una fuente, la tarjeta conserva un historial de versiones.

El color nunca es la única señal: cada estado incluye texto e icono.

## Desarrollo en 48 horas

### Viernes: veredicto reproducible

- [ ] Completar los spikes de Parakeet/WebGPU, captura de pestaña, búsqueda, Rerank y Clef descritos en `MVP_PLAN.md`.
- [ ] Crear un corpus local de 15 afirmaciones y fuentes públicas.
- [ ] Validar la rúbrica de Clef con casos verdaderos, falsos, ambiguos y opiniones.
- [ ] Implementar cola, timeout y reintentos.
- [ ] Completar texto → afirmación → evidencia local → Clef → tarjeta.

### Sábado: recuperación y directo

- [ ] Añadir extracción de afirmaciones atómicas con salida JSON.
- [ ] Implementar un conector Wikipedia/Wikidata y otro de URLs manuales.
- [ ] Construir la línea temporal y actualizaciones mediante SSE.
- [ ] Guardar fuentes, fechas y versiones en SQLite.

### Domingo: rigor y presentación

- [ ] Añadir límites de tamaño y protección contra texto hostil en fuentes.
- [ ] Diseñar tarjetas exportables con enlaces, no solo capturas sin contexto.
- [ ] Ensayar la demo con una transcripción preparada.
- [ ] Documentar que el sistema asiste; no sustituye a un periodista.
- [ ] Grabar un vídeo de respaldo usando el corpus local.

## Demo de 90 segundos

1. Pegar un fragmento corto de un mitin ficticio con tres afirmaciones.
2. Ver cómo se separan en tarjetas.
3. Mostrar una afirmación respaldada, otra contradicha y una opinión no verificable.
4. Abrir las fuentes de una tarjeta.
5. Añadir una nueva fuente y enseñar cómo el veredicto se reevalúa sin borrar el historial.

Evitar usar una acusación real sensible en la demo: distraería con el debate político y elevaría el riesgo reputacional.

## Ventajas

- Es el concepto más espectacular visualmente.
- Encaja de manera directa con el reto Fact Check.
- La incertidumbre y las fuentes hacen visible el valor de Clef.
- Puede atraer a medios, streamers, educación y moderación comunitaria.
- El modo corpus permite una demo estable sin servicios pagados.

## Desventajas y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Recuperar evidencia de calidad es más difícil que clasificarla | Limitar dominios, priorizar fuentes primarias y enseñar fragmentos |
| “Tiempo real” puede prometer más velocidad de la disponible | Procesar por frases y usar estados de progreso honestos |
| La transcripción añade complejidad y exige una descarga grande | Modelo cacheado en el navegador, consentimiento explícito y modo fixture de respaldo |
| Puede difamar o amplificar errores | “Según estas fuentes”, historial, no verificable y revisión humana |
| Una fuente puede contener prompt injection | Tratar fuentes como datos, delimitar contenido y no permitir herramientas autónomas |
| Se parece al reto oficial | Diferenciar con timeline, afirmaciones atómicas e historial de evidencia |

## Valor para Helmcode

- Demuestra inferencia privada sobre contenido periodístico sensible.
- Genera una demo pública llamativa para eventos y comunidad NaN.
- Enseña el uso complementario de modelos de chat y Clef.
- Puede convertirse en benchmark visible de latencia y decisiones multilingües.

El vínculo comercial es menos directo que en ClefRoute. Para reforzarlo, el panel debe distinguir la transcripción local con modelo abierto de las decisiones de Rerank y Clef servidas por NaN.

## Alcance fuera del MVP

- Extensión de navegador y modo picture-in-picture.
- Fallback cloud opcional para dispositivos sin WebGPU, siempre con consentimiento.
- Detección de afirmaciones repetidas.
- Índice local de fuentes y búsqueda semántica.
- Colaboración entre verificadores.
- Firmado y exportación de informes.

## Criterios de éxito

- [ ] Ninguna tarjeta se publica sin al menos una fuente visible o “sin evidencia”.
- [ ] Opiniones y predicciones pueden terminar como no verificables.
- [ ] La probabilidad de Clef se presenta como confianza de la decisión, no certeza factual.
- [ ] La demo completa funciona con corpus local.
- [ ] Añadir evidencia permite reevaluar y conserva el historial.
- [ ] El proyecto solo necesita `NAN_KEY` para sus funciones de IA.
