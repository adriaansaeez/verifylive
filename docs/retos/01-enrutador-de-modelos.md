# Reto 1 — Enrutador de modelos

> Que Clef elija qué modelo de NaN responde cada petición: uno rápido para lo sencillo, uno grande para lo difícil.

## Problema

Mandar todas las peticiones al modelo más grande es lento y desperdicia capacidad. Mandarlas todas al más pequeño da malas respuestas en las tareas difíciles. Tu app debe poner a Clef delante y que decida, petición a petición, **qué modelo de NaN la atiende**.

## Requisitos

1. Recibe un prompt de usuario, y opcionalmente el historial de la conversación.
2. Pregunta a Clef qué modelo debe responder, eligiendo entre al menos dos modelos de NaN.
3. Reenvía la petición al modelo elegido (`POST https://api.nan.builders/v1/chat/completions`) y devuelve su respuesta.
4. Muestra o registra la decisión: modelo elegido, probabilidad y tiempo que tardó Clef.

## Cómo encaja Clef

- **`state`:** el prompt del usuario, más el contexto que ayude a decidir (longitud, si adjunta código, turnos previos).
- **Pregunta principal (`choice`):** el modelo o la categoría de modelo.
- **Preguntas de apoyo (en la misma petición):** dificultad (`score`), y si necesita razonamiento largo o si es código (`noul`).

### Ejemplo de petición

```json
{
  "model": "clef",
  "state": "User prompt: Refactor this 40-file repository to use dependency injection and keep all tests green.",
  "questions": {
    "route": {
      "type": "choice",
      "instructions": "Which model should answer this request?",
      "criteria": {
        "fast": "Simple, short or conversational requests: greetings, short creative writing, quick facts, small rewrites",
        "large": "Hard requests: multi-step reasoning, large codebases, long documents, complex analysis"
      }
    },
    "difficulty": {
      "type": "score",
      "instructions": "How difficult is this request to answer well?",
      "criteria": ["Trivial", "Easy", "Moderate", "Hard", "Very hard"]
    },
    "is_code": { "type": "noul", "instructions": "Is this request mainly about writing or changing code?" }
  }
}
```

Luego tu app traduce `fast` / `large` a ids reales de modelo. Por ejemplo, `qwen3.8-flash` para lo sencillo y `glm5.3` para lo difícil. Consulta los modelos disponibles con tu key en `GET https://api.nan.builders/v1/models`.

> Usa ids abstractos en `criteria` (`fast`, `large`, `code`…) y no nombres de modelo. Así puedes cambiar de modelo sin tocar las preguntas a Clef, y la descripción explica *cuándo* usar cada opción.

## Flujo sugerido

```
prompt ──▶ Clef (route + difficulty) ──▶ tabla id→modelo ──▶ /v1/chat/completions ──▶ respuesta
                     │
                     └─▶ log: decisión, probabilidad, latencia
```

## Casos de prueba mínimos

| Prompt | Decisión esperada |
|---|---|
| «Escribe un haiku sobre gatos» | rápido (p. ej. `qwen3.8-flash`) |
| «Refactoriza este repo de 40 ficheros» | grande (p. ej. `glm5.3`) |
| «¿Qué hora es en Tokio si en Madrid son las 10?» | rápido |
| «Demuestra que hay infinitos números primos y explica cada paso» | grande |
| «Hola, ¿qué tal?» | rápido |

## Ideas para destacar

- **Umbral con caída segura:** si la confianza en `fast` es baja, usa el modelo grande.
- **Métricas:** compara latencia y calidad frente a mandarlo todo al modelo grande.
- **Más de dos destinos:** por ejemplo, rápido, grande, especialista en código y modelo de visión.
- **Respeta la concurrencia:** Clef admite 2 peticiones a la vez y los modelos de chat tienen sus propios límites por modelo.

## Errores comunes

- Hacer una petición a Clef por cada pregunta en vez de agruparlas.
- Descripciones de `criteria` vagas o que se solapan ("normal" frente a "medio").
- Mandar a Clef un historial enorme: recorta a lo que importa para decidir.
