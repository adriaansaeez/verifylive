# ClefRoute: control de tráfico para IA soberana

ClefRoute decide qué modelo debe procesar cada prompt, si los datos pueden salir de la UE y cuándo hace falta anonimizar o pedir confirmación. El resultado es un proxy compatible con OpenAI y un panel que convierte cada decisión en ahorro, latencia y privacidad visibles.

## La propuesta en una frase

> “Pasa tu aplicación por este endpoint y observa cómo Clef mantiene los datos sensibles en Europa y reserva los modelos grandes para las tareas que de verdad los necesitan.”

## Por qué es la recomendación principal

- **Ahorra dinero:** evita usar siempre el modelo más caro o grande.
- **Es visual:** cada petición recorre un diagrama en tiempo real y mueve contadores de ahorro, privacidad y latencia.
- **Clef es indispensable:** la clasificación conjunta de dificultad, sensibilidad y ruta determina la ejecución.
- **Ayuda a Helmcode:** sirve como referencia técnica, demo de ventas y herramienta de migración desde APIs por token.
- **Cabe en 48 horas:** el camino crítico solo requiere un proxy, una llamada a Clef, una llamada de chat y eventos hacia el panel.

## Usuario y problema

El usuario principal es un equipo que ya consume uno o varios modelos mediante una API compatible con OpenAI. No sabe qué peticiones necesitan un modelo grande, qué datos son sensibles ni cuánto podría ahorrar migrando tráfico repetitivo a modelos abiertos en infraestructura europea.

ClefRoute se coloca delante de los modelos sin obligar a reescribir la aplicación:

```text
aplicación ──▶ endpoint compatible con OpenAI ──▶ Clef ──┬─▶ modelo rápido NaN
                                                        ├─▶ modelo potente NaN
                                                        ├─▶ anonimizar y continuar
                                                        └─▶ pedir confirmación / bloquear
```

## Decisión central de Clef

Una sola petición agrupa todas las preguntas relevantes:

```json
{
  "model": "clef",
  "state": "User prompt: ...\nApplication: support-copilot\nDeclared data policy: EU only",
  "questions": {
    "route": {
      "type": "choice",
      "instructions": "Which class of model is sufficient to answer this request well?",
      "criteria": {
        "fast": "Short, simple, repetitive or conversational work",
        "reasoning": "Work requiring several reasoning steps or careful analysis",
        "code": "Software engineering or code-heavy work"
      }
    },
    "sensitivity": {
      "type": "score",
      "instructions": "How sensitive is the information in this request?",
      "criteria": ["Public", "Internal", "Personal", "Highly confidential"]
    },
    "contains_personal_data": {
      "type": "noul",
      "instructions": "Does this request contain personal or identifying data?"
    },
    "needs_human_review": {
      "type": "noul",
      "instructions": "Could a wrong answer cause a consequential action requiring human review?"
    }
  }
}
```

La política determinista traduce la decisión a una acción. Clef clasifica; el código aplica reglas auditables:

| Resultado | Acción del MVP |
|---|---|
| `fast` + sensibilidad baja | Modelo rápido disponible en NaN |
| `reasoning` o `code` | Modelo capaz disponible en NaN |
| Datos personales | Mantener en una ruta marcada como UE/privada |
| Sensibilidad alta y baja confianza | Pedir confirmación |
| Fallo o timeout de Clef | Ruta privada conservadora; nunca salida insegura |

Los identificadores reales de modelos se obtienen al arrancar con `GET /v1/models` y se configuran mediante variables de entorno. No conviene codificar nombres que puedan cambiar.

## Experiencia visual

La pantalla principal es un “mapa de tráfico” y no un chat genérico:

- A la izquierda entran tarjetas de prompts, con sus datos sensibles difuminados.
- En el centro, Clef abre tres medidores: complejidad, sensibilidad y confianza.
- A la derecha, la tarjeta viaja hacia el modelo elegido.
- En la cabecera cambian cuatro cifras: ahorro estimado, peticiones privadas, latencia p50 y porcentaje de tráfico en modelos ligeros.
- Al pulsar una decisión aparece su registro auditable: estado resumido, probabilidades, política aplicada y modelo final.

La demo debe incluir un interruptor “todo al modelo grande” frente a “ClefRoute”. Así el ahorro y la diferencia de latencia se entienden sin explicación.

## Métrica de ahorro honesta

El producto no debe fingir un ahorro exacto si NaN usa tarifa plana. Mostrará dos vistas claramente etiquetadas:

1. **Capacidad evitada:** tokens que no se enviaron al modelo grande y diferencia de latencia observada.
2. **Coste de referencia configurable:** estimación basada en precios introducidos por el usuario para su proveedor anterior.

```text
ahorro_estimado = coste_baseline_configurado - coste_ruta_configurada
```

Para Helmcode, el mensaje más sólido es “misma carga con menos capacidad cara y factura previsible”, no una cifra inventada.

## Arquitectura del MVP

| Componente | Responsabilidad |
|---|---|
| `api/proxy` | Recibir una petición compatible con `chat/completions` |
| `clef/queue` | Garantizar una llamada en vuelo y reintentar `429` |
| `clef/classifier` | Construir estado/preguntas y normalizar probabilidades |
| `policy/engine` | Convertir clasificaciones en permitir, confirmar o ruta |
| `nan/client` | Consultar modelos y ejecutar el modelo elegido |
| `metrics/store` | Guardar decisiones, tokens, latencia y estimaciones en SQLite |
| `events` | Emitir Server-Sent Events al panel |
| `web/dashboard` | Dibujar flujo, comparación y auditoría |

Server-Sent Events es suficiente para la demo y evita añadir infraestructura de WebSockets.

## Desarrollo en 48 horas

### Viernes: prueba del núcleo

- [ ] Hacer llamadas reales a Clef con diez prompts variados.
- [ ] Elegir tres rutas abstractas y mapearlas a modelos disponibles.
- [ ] Crear el cliente con cola, timeout de 50 s y reintentos de `429`.
- [ ] Implementar proxy → Clef → modelo → respuesta.
- [ ] Registrar latencia, decisión y probabilidades en memoria.

### Sábado: producto visible

- [ ] Añadir SQLite y migración inicial.
- [ ] Implementar SSE y el mapa de tráfico.
- [ ] Añadir modo baseline y cálculo configurable.
- [ ] Crear vista de auditoría por petición.
- [ ] Probar fallos de Clef, confianza baja y datos sensibles.

### Domingo: cerrar la historia

- [ ] Pulir estados vacíos, errores y tiempos de carga.
- [ ] Preparar 12 prompts reproducibles y resultados esperados.
- [ ] Añadir Docker Compose, licencia y guía de cinco minutos.
- [ ] Ensayar una demo de 90 segundos.
- [ ] Grabar un vídeo de respaldo.

## Demo de 90 segundos

1. Activar baseline: tres prompts van al modelo grande.
2. Activar ClefRoute.
3. Enviar “resume este email”: ruta rápida.
4. Enviar un problema complejo de código: ruta especializada.
5. Enviar un texto con DNI y diagnóstico: ruta privada y confirmación.
6. Abrir el panel comparativo: capacidad evitada, latencia y decisiones privadas.
7. Abrir el registro auditable de una petición y enseñar las probabilidades de Clef.

## Ventajas

- Conecta directamente con el reto de enrutamiento y lo amplía con privacidad.
- No depende de scraping, buscadores ni proveedores externos.
- Su interfaz OpenAI-compatible facilita una adopción real.
- Produce métricas y artefactos que Helmcode podría reutilizar.
- La demo funciona con prompts preparados si falla cualquier fuente externa.

## Desventajas y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Se parece al reto oficial de router | Diferenciar con soberanía, auditoría y comparador baseline |
| El ahorro monetario puede ser discutible con tarifa plana | Separar capacidad real de coste de referencia configurable |
| Clef podría clasificar datos sensibles de forma imperfecta | Combinar reglas deterministas para patrones obvios y Clef para zona gris |
| La confianza no equivale a precisión | Calibrar con casos etiquetados y mostrarla sin prometer certeza |
| Una sola petición Clef concurrente limita el throughput de la demo | Cola visible, agrupación de preguntas y carga secuencial |

## Valor concreto para Helmcode

- Repositorio de ejemplo para migrar una aplicación OpenAI-compatible.
- Calculadora de capacidad para conversaciones comerciales.
- Demostración visual de “zero logs / EU / open models” sin diapositivas.
- Datos agregados locales sobre qué porcentaje de tráfico puede ir a modelos ligeros.
- Base para un futuro gateway de políticas dentro del ecosistema Helmcode.

No se debe afirmar que el prototipo garantiza GDPR, AI Act o DORA. Es una ayuda técnica para aplicar políticas, no una certificación legal.

## Alcance fuera del MVP

- Redacción automática de PII antes del envío.
- Exportación OpenTelemetry.
- SDK y middleware para frameworks de agentes.
- Reglas por workspace y presupuestos.
- Evaluación A/B de calidad de respuesta.
- Despliegue multiusuario y control de acceso.

## Criterios de éxito

- [ ] Clef decide la ruta de todos los prompts del flujo principal.
- [ ] Ninguna decisión sensible hace fail-open.
- [ ] El modelo elegido, probabilidades y latencia son visibles.
- [ ] La comparación baseline se entiende en menos de diez segundos.
- [ ] El proyecto arranca localmente con un comando y solo requiere `NAN_KEY`.
- [ ] Hay al menos 20 casos etiquetados y el README publica sus resultados.

