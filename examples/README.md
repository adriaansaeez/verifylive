# Ejemplos

Todos los ejemplos leen tu key de la variable de entorno `NAN_KEY`, hacen una sola petición a la vez y, si reciben `429`, esperan un segundo y reintentan.

| Fichero | Uso |
|---|---|
| `request.json` | Cuerpo de ejemplo (triaje de un ticket de soporte) |
| `clef.sh` | `NAN_KEY=... ./clef.sh [request.json]` (necesita `curl`) |
| `clef.py` | `NAN_KEY=... python3 clef.py` (Python 3.8+, sin dependencias) |
| `clef.mjs` | `NAN_KEY=... node clef.mjs` (Node.js 18+, sin dependencias) |

`clef.py` y `clef.mjs` exponen `ask_clef` / `askClef`, que puedes copiar a tu proyecto.

La primera vez, imprime la respuesta completa para ver su estructura antes de escribir el parser.
