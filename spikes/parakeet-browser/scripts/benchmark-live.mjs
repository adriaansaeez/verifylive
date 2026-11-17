import { access, readFile } from "node:fs/promises";

import { chromium } from "playwright-core";

const executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const baseURL = process.env.SPIKE_URL ?? "http://127.0.0.1:5173";
const profilePath = process.env.SPIKE_PROFILE ?? "/tmp/verifylive-parakeet-chrome-profile";
const inputPath = process.env.SPIKE_AUDIO ?? "/tmp/verifylive-spanish.mp3";
const durationMs = Number(process.env.SPIKE_LIVE_MS ?? 30_000);
const timeoutMs = Number(process.env.SPIKE_TIMEOUT_MS ?? 10 * 60 * 1000);
const quantization = process.env.SPIKE_QUANTIZATION ?? "fp16";
const sourceTitle = "VerifyLive audio source";
const headless = process.env.SPIKE_HEADLESS !== "false";

await access(inputPath);
const audioBase64 = (await readFile(inputPath)).toString("base64");
const context = await chromium.launchPersistentContext(profilePath, {
  executablePath,
  headless,
  args: [
    "--enable-unsafe-webgpu",
    "--use-angle=metal",
    "--disable-gpu-sandbox",
    "--use-fake-ui-for-media-stream",
    `--auto-select-desktop-capture-source=${sourceTitle}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
});

try {
  const sourcePage = context.pages()[0] ?? (await context.newPage());
  await sourcePage.setContent(`
    <!doctype html>
    <title>${sourceTitle}</title>
    <h1>${sourceTitle}</h1>
    <audio id="source" autoplay loop controls src="data:audio/mpeg;base64,${audioBase64}"></audio>
  `);
  await sourcePage.locator("#source").evaluate(async (audio) => {
    audio.volume = 0.8;
    await audio.play();
  });

  const page = await context.newPage();
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

  await page.locator("#start-live").click();
  await page.waitForFunction(
    () => {
      const log = document.querySelector("#event-log")?.textContent ?? "";
      return log.includes("Captura iniciada") || log.includes("No se pudo iniciar la captura");
    },
    undefined,
    { timeout: 30_000 },
  );
  const startedLog = await page.locator("#event-log").textContent();
  if (!startedLog?.includes("Captura iniciada")) throw new Error(startedLog ?? "Sin registro");

  await page.waitForTimeout(durationMs);
  await page.locator("#stop-live").click();
  await page.waitForFunction(
    () => document.querySelector("#event-log")?.textContent?.includes("Captura detenida"),
  );

  const result = await page.evaluate(() => ({
    report: globalThis.__VERIFYLIVE_SPIKE_REPORT__?.(),
    segments: Array.from(document.querySelectorAll("#segments li"), (item) => item.textContent),
    log: document.querySelector("#event-log")?.textContent,
  }));
  result.pageErrors = pageErrors;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (!result.report?.runs?.some((run) => run.mode === "live")) {
    throw new Error(`No se registró ninguna ventana live.\n${result.log}`);
  }
  if (pageErrors.length > 0) throw new Error(`Errores HTTP/página:\n${pageErrors.join("\n")}`);
} finally {
  await context.close();
}
