#!/usr/bin/env node
/**
 * Arranque en un comando: comprueba lo que hace falta, instala lo que falte,
 * levanta el buscador si hay Docker y abre el servidor.
 *
 * No intenta esconder los dos requisitos que no se pueden automatizar: hace
 * falta Chrome, y la primera captura descarga el modelo de transcripción.
 * Decirlo por adelantado evita que alguien crea que se ha colgado.
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, copyFileSync, readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Socket } from "node:net";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const web = path.join(root, "apps", "web");
const C = { dim: "\x1b[2m", b: "\x1b[1m", g: "\x1b[32m", y: "\x1b[33m", r: "\x1b[31m", x: "\x1b[0m" };
const say = (s = "") => console.log(s);
const ok = (s) => say(`  ${C.g}✓${C.x} ${s}`);
const warn = (s) => say(`  ${C.y}!${C.x} ${s}`);
const die = (s, fix) => {
  say(`  ${C.r}✗${C.x} ${s}`);
  if (fix) say(`    ${C.dim}${fix}${C.x}`);
  process.exit(1);
};
const has = (cmd) => {
  try { execSync(`command -v ${cmd}`, { stdio: "ignore" }); return true; } catch { return false; }
};

say(`\n${C.b}VerifyLive${C.x} ${C.dim}· preparando el entorno${C.x}\n`);

// 1. Node: node:sqlite no existe antes de la 22 y el error que sale no lo dice.
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  die(`Node ${process.versions.node}: hace falta la 22 o superior (la app usa node:sqlite).`,
      "nvm install 22 && nvm use 22   ·   o descárgala en nodejs.org");
}
ok(`Node ${process.versions.node}`);

// 2. Dependencias.
if (!existsSync(path.join(web, "node_modules"))) {
  say(`  ${C.dim}· instalando dependencias, esto tarda un poco la primera vez${C.x}`);
  execSync("npm install", { cwd: web, stdio: "inherit" });
}
ok("Dependencias instaladas");

// 3. Configuración. Sin claves la app funciona en modo simulado, así que
//    nunca se bloquea el arranque por esto.
const envFile = path.join(web, ".env.local");
if (!existsSync(envFile)) {
  copyFileSync(path.join(web, "env.example"), envFile);
  warn("Creado apps/web/.env.local a partir del ejemplo");
}
const env = readFileSync(envFile, "utf8");
const keyed = /^(NAN_KEY|TYPESAFE_API_KEY)=\S+/m.test(env);
if (keyed) ok("Evaluador configurado");
else warn("Sin clave de evaluador: arranca en modo simulado y lo etiqueta como tal");

// 4. Buscador. Mejora mucho las fuentes y no pide ninguna clave, así que se
//    levanta solo si hay Docker.
const searxUp = async () => {
  try {
    const r = await fetch("http://localhost:8099/search?q=test&format=json", {
      signal: AbortSignal.timeout(1500),
    });
    return r.ok;
  } catch { return false; }
};
if (await searxUp()) {
  ok("Buscador SearXNG en marcha");
} else if (has("docker")) {
  say(`  ${C.dim}· levantando SearXNG…${C.x}`);
  try {
    execSync("docker compose -f search/docker-compose.yml up -d", { cwd: web, stdio: "ignore" });
    for (let i = 0; i < 20 && !(await searxUp()); i++) await new Promise((r) => setTimeout(r, 500));
    if (await searxUp()) ok("Buscador SearXNG en marcha");
    else warn("SearXNG no respondió; se usará el buscador sin clave");
  } catch {
    warn("No se pudo levantar SearXNG; se usará el buscador sin clave");
  }
} else {
  warn("Sin Docker: se usará el buscador sin clave (menos fuentes relevantes)");
}
if (!/^VERIFYLIVE_SEARXNG_URL=/m.test(env) && (await searxUp())) {
  appendFileSync(envFile, "\nVERIFYLIVE_SEARXNG_URL=http://localhost:8099\n");
}

// 5. Lo que no se puede automatizar, dicho antes de que extrañe.
// Un puerto ocupado es de las primeras piedras con las que tropieza alguien
// que acaba de clonar: se busca el primero libre en vez de fallar.
// Se comprueba conectando, no atando: atar a 127.0.0.1 da el puerto por libre
// cuando el proceso que lo ocupa escucha en IPv6.
const free = async (p) => await new Promise((resolve) => {
  const s = new Socket();
  const done = (isFree) => { s.destroy(); resolve(isFree); };
  s.setTimeout(400);
  s.once("connect", () => done(false));
  s.once("timeout", () => done(true));
  s.once("error", () => done(true));
  s.connect(p, "127.0.0.1");
});
let port = Number(process.env.PORT || 3000);
while (!(await free(port)) && port < 3020) port += 1;
if (String(port) !== String(process.env.PORT || 3000)) {
  warn(`El puerto ${process.env.PORT || 3000} estaba ocupado; se usa el ${port}`);
}
say();
say(`  ${C.b}Ábrelo en Chrome:${C.x} http://localhost:${port}`);
say(`  ${C.dim}Hace falta Chrome o Edge: la transcripción usa WebGPU y la captura de pestaña.${C.x}`);
say(`  ${C.dim}La primera vez se descarga el modelo de voz (~1,3 GB) y se queda en caché.${C.x}`);
say();

spawn("npm", ["run", "dev"], { cwd: web, stdio: "inherit", env: { ...process.env, PORT: port } });
