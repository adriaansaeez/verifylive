# VerifyLive para la plataforma de apps de NaN.
#
# Node 24 porque la app usa `node:sqlite`, que antes de la 23 exige una bandera
# experimental. Imagen Debian y no Alpine: browser-whisper arrastra binarios
# que con musl dan problemas.
FROM node:24-slim AS deps
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/web/ ./
# La compilación no necesita claves: sin ellas la app arranca en modo simulado
# y el build no llama a ningún servicio.
RUN npm run build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# La base de datos vive en el volumen, nunca en la imagen: un contenedor se
# reemplaza en cada despliegue y se llevaría por delante las sesiones.
ENV VERIFYLIVE_DB=/data/verifylive.sqlite

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY apps/web/package.json ./package.json
COPY apps/web/next.config.ts ./next.config.ts
COPY apps/web/fixtures ./fixtures

RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
CMD ["npm", "run", "start"]
