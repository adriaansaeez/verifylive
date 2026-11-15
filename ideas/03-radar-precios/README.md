# Radar de precios: mejor compra, no solo menor número

Radar de precios compara ofertas de un producto y deja que Clef decida cuál representa el mejor valor real según precio total, envío, confianza de la tienda, garantía, estado y preferencias del usuario.

## La propuesta en una frase

> “Pega el producto que quieres y recibe una decisión explicable sobre qué oferta comprar, cuánto ahorras y qué riesgo estás aceptando.”

## Ajuste necesario a la idea original

Un scraper “de alta velocidad para encontrar el precio menor” tiene dos problemas en esta hackathon:

1. el menor precio se calcula con código y Clef no tomaría la decisión central;
2. construir y mantener scrapers fiables para muchas tiendas supera el fin de semana.

La versión defendible es un **comparador de valor**. El código recolecta y normaliza ofertas; Clef decide cuál conviene para una persona concreta cuando hay compensaciones reales.

Ejemplo: una oferta de 490 € en un marketplace nuevo puede ser peor que una de 515 € con envío incluido, garantía española y vendedor oficial.

## Alcance del MVP

- Un solo tipo de producto para la demo, por ejemplo auriculares o tarjetas gráficas.
- Dos o tres fuentes con permiso, HTML estable o feeds públicos.
- Entrada manual de URL como camino alternativo.
- Un dataset local de ofertas como respaldo reproducible.
- Sin login, compra automática, afiliación ni histórico masivo.

No se debe prometer “todas las tiendas” ni “alta velocidad”. La métrica relevante es tiempo hasta una recomendación fiable.

## Decisión central de Clef

```json
{
  "model": "clef",
  "state": "User priorities: lowest total cost, new condition, delivery within 5 days...\nOffer A: ...\nOffer B: ...\nOffer C: ...",
  "questions": {
    "best_offer": {
      "type": "choice",
      "instructions": "Which offer provides the best overall value for this user's stated priorities?",
      "criteria": {
        "offer_a": "Offer A exactly as described in the state",
        "offer_b": "Offer B exactly as described in the state",
        "offer_c": "Offer C exactly as described in the state",
        "none": "No offer satisfies the user's mandatory requirements"
      }
    },
    "purchase_confidence": {
      "type": "score",
      "instructions": "How confident should the user be purchasing the selected offer based on the available information?",
      "criteria": ["Avoid", "Low", "Medium", "High", "Very high"]
    },
    "material_risk": {
      "type": "noul",
      "instructions": "Does the selected offer have a material condition, seller, warranty, shipping or return risk?"
    }
  }
}
```

El menor precio total, duplicados y moneda se calculan de forma determinista. Clef solo decide sobre criterios cualitativos y preferencias. Esta separación hace el sistema más verificable.

## Experiencia visual

- Un radar actualiza tarjetas de tiendas a medida que llegan las ofertas.
- El precio visible siempre incluye envío y comisiones conocidas.
- La oferta ganadora no salta directamente: muestra las probabilidades de cada candidata.
- Un control permite cambiar prioridades —“máximo ahorro”, “máxima seguridad”, “entrega rápida”— y ver cómo cambia la decisión.
- Un bloque grande muestra ahorro frente al precio mediano, no frente a un PVP inflado.
- Cada oferta indica hora de consulta y enlace directo.

## Adquisición de datos sin coste

Orden recomendado:

1. feeds o APIs públicas oficiales, si existen;
2. datos estructurados `schema.org/Product` y `Offer` de URLs proporcionadas por el usuario;
3. páginas expresamente permitidas por sus términos y `robots.txt`;
4. entrada manual;
5. fixtures locales para tests y demo.

No usar proxies residenciales, CAPTCHAs automatizados ni técnicas para eludir bloqueos. Además de ser frágiles, contradicen el objetivo de un proyecto abierto y reutilizable.

`robots.txt` no sustituye los términos de servicio ni concede permiso legal. Antes de publicar un conector se deben revisar ambas cosas.

## Arquitectura del MVP

| Componente | Responsabilidad |
|---|---|
| `connectors` | Obtener ofertas de fuentes permitidas |
| `extractor` | Leer JSON-LD o selectores específicos |
| `normalizer` | Unificar moneda, envío, estado, vendedor y garantía |
| `matcher` | Evitar comparar variantes o productos distintos |
| `clef-recommender` | Elegir mejor valor y puntuar riesgo |
| `store` | Guardar consultas y un histórico corto en SQLite |
| `web/radar` | Mostrar ofertas, prioridades y ahorro |

La cola de Clef procesa una comparación cada vez. Los conectores pueden obtener datos en paralelo solo si la fuente lo permite; esta concurrencia es independiente de la limitación de Clef.

## Desarrollo en 48 horas

### Viernes: comparación correcta

- [ ] Elegir categoría y tres fuentes antes de programar.
- [ ] Crear 20 ofertas fixture con casos difíciles.
- [ ] Implementar normalización y precio total determinista.
- [ ] Validar preguntas de Clef contra prioridades distintas.

### Sábado: conectores y visual

- [ ] Implementar entrada de URL y extracción de JSON-LD.
- [ ] Añadir como máximo dos conectores específicos permitidos.
- [ ] Construir el radar, filtros y cambio de prioridades.
- [ ] Guardar consultas en SQLite.

### Domingo: robustez

- [ ] Detectar productos/variantes incompatibles.
- [ ] Mostrar datos ausentes y ofertas caducadas.
- [ ] Preparar dataset local y modo demo.
- [ ] Documentar política para aceptar nuevos conectores open source.
- [ ] Ensayar una demo de 90 segundos.

## Demo de 90 segundos

1. Buscar un producto del dataset reproducible.
2. Ver entrar tres ofertas con precio total normalizado.
3. Seleccionar “máximo ahorro”: gana una oferta económica con riesgo señalado.
4. Seleccionar “máxima seguridad”: Clef cambia a vendedor oficial.
5. Abrir probabilidades, razones estructuradas y cálculo de ahorro.

## Ventajas

- Ahorro monetario fácil de comprender.
- Público potencial muy amplio.
- La comparación visual y el cambio de prioridades hacen una buena demo.
- Puede crecer mediante conectores aportados por la comunidad.
- El dataset local permite tests y presentación sin depender de tiendas.

## Desventajas y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Bloqueos, cambios de HTML y términos de uso | Pocas fuentes permitidas, JSON-LD y conectores aislados |
| Se comparan variantes distintas | Matcher estricto y confirmación visual del modelo exacto |
| Clef parece añadido artificialmente | Decidir valor multicriterio, no ordenar precios |
| Precio o stock quedan obsoletos | Timestamp visible y enlace para confirmar antes de comprar |
| El equipo consume el fin de semana haciendo scraping | Congelar conectores el viernes y priorizar fixtures |
| Poco valor directo para Helmcode | Presentarlo como caso de alto volumen para routing; aun así es el vínculo más débil |

## Valor para Helmcode

El valor directo es limitado. Puede demostrar decisiones rápidas y baratas a escala, pero no refleja tan bien privacidad, inferencia europea o migración empresarial. Para reforzar el vínculo:

- usar un modelo pequeño de NaN para normalización y Clef para selección;
- enseñar tokens y latencia por búsqueda;
- publicar un benchmark de miles de decisiones sobre el dataset;
- diseñar los conectores como plugins que generen carga realista para NaN.

Aun así, si el objetivo prioritario es llamar la atención de Helmcode, ClefRoute es una opción superior.

## Alcance fuera del MVP

- Alertas de bajada ejecutadas localmente.
- Historial de precio y detección de descuentos falsos.
- Extensión de navegador.
- Listas compartidas y presupuestos.
- Matching de segunda mano.
- Programa de afiliación opcional y claramente indicado.

## Criterios de éxito

- [ ] El precio total es reproducible y no lo inventa un modelo.
- [ ] Clef cambia de ganador al cambiar prioridades relevantes.
- [ ] Cada oferta muestra fuente y momento de consulta.
- [ ] El sistema admite `none` cuando ninguna oferta cumple.
- [ ] La demo funciona por completo con fixtures locales.
- [ ] Añadir un conector no obliga a cambiar el núcleo.

