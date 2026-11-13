# Reto 3 — Fact Check

> Una app que diga si una afirmación es verdadera o falsa.

## Problema

Dada una afirmación (un titular, un tuit, una frase de un discurso, un mensaje reenviado), tu app debe decir si es **verdadera o falsa** y con qué confianza, apoyándose en Clef para tomar el veredicto.

## Requisitos

1. Recibe una afirmación en texto. Opcionalmente, también una imagen: captura de un tuit, un gráfico…
2. Pregunta a Clef por el veredicto.
3. Muestra el veredicto y su confianza. Usa la probabilidad, no solo "verdadero" o "falso".
4. Muestra en qué se basa la decisión: por ejemplo, las fuentes o el contexto que pasaste en `state`.

## Cómo encaja Clef

Clef decide, pero no busca información. Su veredicto depende de lo que sepa el modelo y de lo que pongas en `state`. La calidad de tu app depende mucho de **qué contexto le das**:

- **Solo la afirmación:** sirve para hechos conocidos y estables.
- **Afirmación + evidencias:** recuperas tú las fuentes (tu propia búsqueda, una base de conocimiento, documentos) y las incluyes en `state`. Funciona mucho mejor con hechos recientes o poco conocidos.

### Ejemplo de petición

```json
{
  "model": "clef",
  "state": "Claim: \"Una carbonara lleva nata.\"\n\nEvidence:\n[1] La receta tradicional romana de la carbonara usa guanciale, yema de huevo, pecorino romano y pimienta negra; no incluye nata.",
  "questions": {
    "verdict": {
      "type": "choice",
      "instructions": "Is the claim true or false according to the evidence?",
      "criteria": {
        "true": "The evidence supports the claim",
        "false": "The evidence contradicts the claim",
        "unverifiable": "The evidence is insufficient to decide"
      }
    },
    "checkable": { "type": "noul", "instructions": "Is this a factual claim that can be checked, rather than an opinion?" }
  }
}
```

> La landing dice "verdadera o falsa". Añadir `unverifiable` (o tratar las probabilidades bajas como "no se puede verificar") hace tu app más honesta: un fact-checker que nunca duda es peor.

## Flujo sugerido

```
afirmación ──▶ (opcional) recuperar evidencias ──▶ Clef (verdict + checkable) ──▶ veredicto + confianza + fuentes
```

## Casos de prueba mínimos

| Afirmación | Veredicto esperado |
|---|---|
| «Una carbonara lleva nata» | falso |
| «El agua hierve a 100 °C a nivel del mar» | verdadero |
| «Madrid es la capital de Portugal» | falso |
| «La paella es el mejor plato del mundo» | no verificable (es una opinión) |
| Afirmación sobre un hecho de esta semana, sin evidencias | no verificable o baja confianza |

## Ideas para destacar

- **Recuperación de evidencias** propia, con citas visibles en el resultado.
- **Descomponer** afirmaciones compuestas en varias afirmaciones simples y verificar cada una, en una sola petición con varias preguntas.
- **Imágenes:** verificar capturas de pantalla o gráficos. Revisa el límite de 4 MB y que la latencia puede llegar a 2 s.
- **Integración:** un bot de Discord o una extensión de navegador que verifique al vuelo.

## Errores comunes

- Presentar el veredicto como certeza absoluta sin mirar la probabilidad.
- No distinguir opiniones de hechos.
- Pasar evidencias sin filtrar que superan los ~16.000 tokens de `state`.
