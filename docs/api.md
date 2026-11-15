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
| `state` | string | sí | El contexto que se evalúa: un ticket, un comando, una afirmación, una conversación… Hasta unos 16.000 tokens. Puede estar en español o en inglés. |
| `questions` | objeto | sí | Mapa `id → pregunta`, hasta 64 por petición. Los ids los eliges tú y te sirven para leer la respuesta. |
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

Puedes hacer hasta 64 preguntas sobre el mismo `state` en una sola petición. Es lo más eficiente: **mejor una petición con 5 preguntas que 5 peticiones**. Es más rápido y, como solo puedes tener una petición en vuelo (ver límites), te evita hacer cola.

## Respuesta

Clef devuelve una respuesta por cada id de `questions`, dentro de `answers`, además del modelo usado y el consumo de tokens:

```json
{
  "model": "clef",
  "answers": {
    "urgent": { "type": "noul", "noul": 0.94 },
    "team": {
      "type": "choice",
      "choice": "technical",
      "probabilities": { "billing": 0.04, "technical": 0.93, "sales": 0.03 },
      "confidence": 0.9
    },
    "severity": {
      "type": "score",
      "score": 2.6,
      "legend": { "0": "No impact", "1": "Minor", "2": "Major", "3": "Critical" },
      "probabilities": { "...": 0.0 },
      "confidence": 0.7
    }
  },
  "usage": { "input_tokens": 182, "output_tokens": 0 }
}
```

Los valores son ilustrativos.

| Tipo | Campos | Cómo leerlo |
|---|---|---|
| `noul` | `noul` | Probabilidad de que la respuesta sea "sí", de 0 a 1 |
| `choice` | `choice`, `probabilities`, `confidence` | `choice` es la opción más probable; `probabilities` da la probabilidad de cada opción (suman 1) |
| `score` | `score`, `legend`, `probabilities`, `confidence` | `score` es la media de los niveles ponderada por su probabilidad: un número entre 0 (primer nivel) y N−1 (último), que puede caer entre dos niveles. `legend` relaciona cada índice con su nivel; `probabilities` da la probabilidad de cada nivel |

`confidence` (de 0 a 1) indica lo seguro que está Clef, y se calcula a partir de las probabilidades. **Cuanto más claras y menos solapadas sean las opciones de `criteria`, más alta sale la `confidence`.**

> Antes de escribir el parser, haz una llamada de prueba (ver [`examples/`](../examples/)) e imprime la respuesta completa, sobre todo para ver las claves de `probabilities` en `score`.

## Imágenes

Clef tiene un codificador de visión y puede evaluar imágenes (Cloudflare indica hasta 4 por petición). Las imágenes cuentan para el límite de 4 MB por petición.

> **Pendiente de verificar.** Esta guía aún no recoge cómo se adjuntan las imágenes en la petición.

## Límites

| Límite | Valor | Qué hacer |
|---|---|---|
| Concurrencia | **Una petición a la vez por persona** | Si lanzas varias en paralelo recibes `429`. Haz las peticiones en serie; si te llega un `429`, espera un segundo y reintenta. |
| Latencia | **Entre 0,1 y 2 s** por respuesta | Puedes llamar a Clef en el camino crítico de tu app |
| Tamaño del estado | **Unos 16.000 tokens** | Recorta o resume el contexto antes de enviarlo |
| Tamaño de la petición | **4 MB**, imágenes incluidas | Comprime o redimensiona las imágenes |
| Preguntas | **Hasta 64 por petición** | Agrupa las preguntas sobre un mismo texto en una sola llamada: es más rápido que hacer una llamada por pregunta |
| Timeout | **50 s** | Configura el timeout de tu cliente HTTP en 50 s o más |

## Errores

| Código | Significado | Qué hacer |
|---|---|---|
| `400` | JSON mal formado | El mensaje de error dice qué falla. Revisa también que uses comillas rectas `"`. |
| `404` | No tienes acceso | Revisa tu key y la cabecera `Authorization: Bearer …` |
| `429` | Vas demasiado rápido: más de una petición a la vez | Espera un segundo y reintenta. Haz las peticiones en serie. |
| `502` / `504` | Problema del servicio | Reintenta con espera creciente. Si persiste, el servicio está caído. |

Fíate siempre del cuerpo del error que te devuelva la API.

## Buenas prácticas

1. **Agrupa preguntas.** Una petición con todas las preguntas sobre el mismo estado.
2. **Una petición a la vez.** Pon las llamadas a Clef en una cola y hazlas en serie, en lugar de lanzarlas en paralelo y comerte `429`.
3. **Escribe `instructions` concretas,** una sola pregunta por campo. Puedes escribirlas en español o en inglés.
4. **Haz descripciones de `criteria` que no se solapen.** Si dos opciones se parecen, Clef también dudará. Cuanto más claras sean las opciones, más alta sale la `confidence`.
5. **Usa las probabilidades.** No te quedes solo con la opción más probable. Define umbrales: por ejemplo, actúa si p(sí) > 0,9, pide confirmación si está entre 0,5 y 0,9 y bloquea en otro caso. Calibra esos umbrales con tus propios casos de prueba.
6. **Pon en `state` solo lo relevante.** Menos ruido da mejores decisiones y menos latencia.
7. **Clef decide, no redacta.** Si tu app necesita texto, pásale la decisión a un modelo de chat de NaN (`https://api.nan.builders/v1/chat/completions`).
