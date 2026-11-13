# Referencia de la API de Clef en NaN

## Endpoint

```
POST https://api.nan.builders/v1/systemone
```

| Cabecera | Valor |
|---|---|
| `Authorization` | `Bearer <tu key de NaN>` |
| `Content-Type` | `application/json` |

Usa la misma key de NaN que ya tienes para los modelos de chat. No necesitas ninguna key nueva.

## Cuerpo de la petición

```json
{
  "model": "clef",
  "state": "<la situación que Clef debe evaluar>",
  "questions": {
    "<id_pregunta>": {
      "type": "noul | choice | score",
      "instructions": "<la pregunta, en lenguaje natural>",
      "criteria": "<según el tipo: ver abajo>"
    }
  }
}
```

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `model` | string | sí | `"clef"` |
| `state` | string | sí | El contexto que se evalúa: un ticket, un comando, una afirmación, una conversación… Hasta unos 16k tokens. |
| `questions` | objeto | sí | Mapa `id → pregunta`. Los ids los eliges tú y te sirven para leer la respuesta. |
| `questions.<id>.type` | string | sí | `noul`, `choice` o `score` |
| `questions.<id>.instructions` | string | sí | Qué quieres saber |
| `questions.<id>.criteria` | objeto o lista | según el tipo | Las respuestas permitidas |

## Tipos de pregunta

### `noul`: sí o no

Clef da la probabilidad de que la respuesta sea "sí". No lleva `criteria`.

```json
"urgent": { "type": "noul", "instructions": "Is this support request urgent?" }
```

### `choice`: elegir una opción

`criteria` es un **diccionario `id: descripción`**. Clef elige entre esos ids. La descripción importa: es lo que Clef usa para distinguir una opción de otra.

```json
"team": {
  "type": "choice",
  "instructions": "Which team should handle this request?",
  "criteria": {
    "billing": "Payments and refunds",
    "technical": "Outages and errors",
    "sales": "Plans and upgrades"
  }
}
```

### `score`: escala ordenada

`criteria` es una **lista ordenada**, de menor a mayor. Úsalo cuando las opciones tengan un orden natural, como gravedad, calidad o riesgo.

```json
"severity": {
  "type": "score",
  "instructions": "How severe is the customer impact?",
  "criteria": ["No impact", "Minor", "Major", "Critical"]
}
```

## Varias preguntas en una petición

Puedes hacer varias preguntas sobre el mismo `state` en una sola petición. Es lo más eficiente: **mejor una petición con 5 preguntas que 5 peticiones**. Además consume menos de tu cupo de concurrencia (ver límites).

## Respuesta

> **Pendiente de verificar.** El formato exacto del JSON de respuesta todavía no está documentado aquí. Lo que se sabe es que Clef devuelve, para cada id de `questions`, una respuesta tipada con probabilidades para cada valor permitido. Antes de escribir el parser, haz una llamada de prueba (ver [`examples/`](../examples/)) y mira la estructura real.

## Imágenes

Clef tiene un codificador de visión y puede evaluar imágenes (Cloudflare indica hasta 4 por petición). Las imágenes cuentan para el límite de 4 MiB por petición.

> **Pendiente de verificar.** Esta guía aún no recoge cómo se adjuntan las imágenes en la petición.

## Límites

| Límite | Valor | Qué hacer |
|---|---|---|
| Concurrencia | **Máximo 2 peticiones a la vez por persona** | Si te pasas, recibes `429`. Reintenta al momento. |
| Tamaño de la petición | **4 MiB**, imágenes incluidas | Comprime o redimensiona las imágenes |
| Tamaño del estado | **unos 16k tokens** | Recorta o resume el contexto antes de enviarlo |
| Latencia | **0,3–0,5 s** solo con texto; **1–2 s** con imágenes | Puedes llamar a Clef en el camino crítico de tu app |

## Errores

| Código | Significado | Qué hacer |
|---|---|---|
| `401` | Key ausente o inválida | Revisa la cabecera `Authorization: Bearer …` |
| `429` | Más de 2 peticiones simultáneas | Reintenta al momento. Limita tu app a 2 peticiones en vuelo. |
| `413` / `400` | Petición demasiado grande o mal formada | Revisa el tamaño (4 MiB) y que el JSON sea válido, con comillas rectas `"` |

Los códigos `401`, `413` y `400` son las respuestas HTTP estándar. Fíate siempre del cuerpo del error que te devuelva la API.

## Buenas prácticas

1. **Agrupa preguntas.** Una petición con todas las preguntas sobre el mismo estado.
2. **Limita la concurrencia a 2.** Usa una cola o un semáforo en tu app, en lugar de lanzar decenas de peticiones en paralelo y comerte `429`.
3. **Escribe `instructions` cortas y directas,** una sola pregunta por campo.
4. **Haz descripciones de `criteria` que no se solapen.** Si dos opciones se parecen, Clef también dudará.
5. **Usa las probabilidades.** No te quedes solo con la opción más probable. Define umbrales: por ejemplo, actúa si p(sí) > 0,9, pide confirmación si está entre 0,5 y 0,9 y bloquea en otro caso. Calibra esos umbrales con tus propios casos de prueba.
6. **Pon en `state` solo lo relevante.** Menos ruido da mejores decisiones y menos latencia.
7. **Clef decide, no redacta.** Si tu app necesita texto, pásale la decisión a un modelo de chat de NaN (`https://api.nan.builders/v1/chat/completions`).
