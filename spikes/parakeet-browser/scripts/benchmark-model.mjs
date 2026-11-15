import { chromium } from "playwright-core";

const executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const baseURL = process.env.SPIKE_URL ?? "http://127.0.0.1:5173";
const profilePath = process.env.SPIKE_PROFILE ?? "/tmp/veritas-parakeet-chrome-profile";
const timeoutMs = Number(process.env.SPIKE_TIMEOUT_MS ?? 15 * 60 * 1000);
const quantization = process.env.SPIKE_QUANTIZATION ?? "fp16";

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
    () => document.querySelector("#readiness-badge")?.textContent !== "Comprobando",
  );
  const readiness = await page.locator("#readiness-badge").textContent();
  if (readiness !== "Listo para Parakeet") throw new Error(`Diagnóstico: ${readiness}`);

  await page.locator("#quantization").selectOption(quantization);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  await page.locator("#download-model").click();
  await page.waitForFunction(
    () => {
      const label = document.querySelector("#model-progress-label")?.textContent ?? "";
      return label.startsWith("Listo") || label === "Error" || label === "Cancelado";
    },
    undefined,
    { timeout: timeoutMs },
  );
  const wallMs = performance.now() - started;
  const label = await page.locator("#model-progress-label").textContent();
  const log = await page.locator("#event-log").textContent();

  const storage = await page.evaluate(async () => {
    async function sizeOfDirectory(directory) {
      let bytes = 0;
      let files = 0;
      for await (const handle of directory.values()) {
        if (handle.kind === "file") {
          const file = await handle.getFile();
          bytes += file.size;
          files += 1;
        } else {
          const nested = await sizeOfDirectory(handle);
          bytes += nested.bytes;
          files += nested.files;
        }
      }
      return { bytes, files };
    }

    const root = await navigator.storage.getDirectory();
    const opfs = await sizeOfDirectory(root);
    const estimate = await navigator.storage.estimate();
    return { opfs, estimate };
  });

  const result = {
    startedAt,
    finishedAt: new Date().toISOString(),
    quantization,
    wallMs,
    label,
    storage,
    log,
    pageErrors,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (!label?.startsWith("Listo")) throw new Error(`Carga fallida: ${label}\n${log}`);
  if (pageErrors.length > 0) throw new Error(`Errores HTTP/página:\n${pageErrors.join("\n")}`);
} finally {
  await context.close();
}
