# Reto 4 — Tema libre

> Cualquier otra app en la que Clef decida. Sorpréndenos.

## La única regla

**Clef tiene que tomar la decisión central de tu app.** Si quitas Clef, tu app deja de funcionar o pierde su razón de ser.

## Qué tipo de problemas encajan

Cualquier situación que se pueda expresar como:

> «Dado **este estado**, ¿**qué decido**?»

y donde la respuesta sea sí/no (`noul`), una opción de una lista (`choice`) o una nota en una escala (`score`).

## Ideas de partida

| Idea | `state` | Preguntas |
|---|---|---|
| Árbitro VAR | Descripción (o imagen) de la jugada | `noul`: ¿penalti? · `score`: gravedad de la falta |
| Moderador de comentarios | El comentario y dónde se publica | `choice`: publicar / revisar / rechazar |
| Triaje de tickets | El ticket de soporte | `noul`: ¿urgente? · `choice`: equipo · `score`: impacto |
| Revisor de PRs | Diff y descripción | `score`: riesgo · `noul`: ¿necesita tests? |
| Policía de la carbonara | Receta o foto del plato | `noul`: ¿es carbonara de verdad? |
| Clasificador de facturas | Imagen de la factura | `choice`: categoría de gasto |
| Selector de candidatos | CV y oferta | `score`: encaje con la oferta |

Casos de la landing que encajan aquí:

- «Ticket: “No puedo entrar y la demo es en una hora”. ¿Urgencia?» → urgencia alta
- «El defensa toca el balón con la mano dentro del área. ¿Penalti?» → penalti
- «Comentario: “Gran charla, ¡gracias por compartirla!”. ¿Lo publico?» → publicar

## Recomendaciones

1. **Define bien la decisión** antes de escribir código: qué entra en `state`, qué preguntas haces y qué hace tu app con cada respuesta.
2. **Aprovecha varias preguntas por petición:** una decisión rica en una sola llamada.
3. **Usa las probabilidades** para matizar: actuar, dudar y pedir ayuda.
4. **Prepara casos de prueba,** incluidos casos difíciles o ambiguos, para enseñar en la demo dónde acierta y cómo se comporta cuando duda.
5. **Clef y los modelos de chat se complementan:** Clef decide y un modelo de chat de NaN redacta la explicación, si hace falta.

Antes de empezar, revisa los límites en [docs/api.md](../api.md#límites).
