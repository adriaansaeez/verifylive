import { access } from "node:fs/promises";

import { chromium } from "playwright-core";

const executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const baseURL = process.env.SPIKE_URL ?? "http://127.0.0.1:5173";
const profilePath = process.env.SPIKE_PROFILE ?? "/tmp/veritas-parakeet-chrome-profile";
const inputPath = process.env.SPIKE_AUDIO ?? "/tmp/veritas-spanish.mp3";
const timeoutMs = Number(process.env.SPIKE_TIMEOUT_MS ?? 10 * 60 * 1000);
const quantization = process.env.SPIKE_QUANTIZATION ?? "fp16";

await access(inputPath);
const context = await chromium.launchPersistentContext(profilePath, {
  executablePath,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--disable-gpu-sandbox"],
});

try {
  const page = context.pages()[0] ?? (await context.newPage());
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
      pageErrors.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });

  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.querySelector("#readiness-badge")?.textContent === "Listo para Parakeet",
  );
  await page.locator("#quantization").selectOption(quantization);
  await page.locator("#download-model").click();
  await page.waitForFunction(
    () => document.querySelector("#model-progress-label")?.textContent?.startsWith("Listo"),
    undefined,
    { timeout: timeoutMs },
  );

  await page.locator("#media-file").setInputFiles(inputPath);
  await page.locator("#transcribe-file").click();
  await page.waitForFunction(
    () => {
      const log = document.querySelector("#event-log")?.textContent ?? "";
      return log.includes("Archivo completado") || log.includes("Transcripción interrumpida");
    },
    undefined,
    { timeout: timeoutMs },
  );

  const result = await page.evaluate(() => ({
    report: globalThis.__VERITAS_SPIKE_REPORT__?.(),
    segments: Array.from(document.querySelectorAll("#segments li"), (item) => item.textContent),
    log: document.querySelector("#event-log")?.textContent,
  }));
  result.pageErrors = pageErrors;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (!result.report?.runs?.some((run) => run.mode === "file")) {
    throw new Error(`No se registró la inferencia.\n${result.log}`);
  }
  if (pageErrors.length > 0) throw new Error(`Errores HTTP/página:\n${pageErrors.join("\n")}`);
} finally {
  await context.close();
}
