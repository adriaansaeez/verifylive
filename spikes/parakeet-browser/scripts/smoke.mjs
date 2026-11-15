import { chromium } from "playwright-core";

const executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const baseURL = process.env.SPIKE_URL ?? "http://127.0.0.1:5173";

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--disable-gpu-sandbox"],
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
      errors.push(message.text());
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
      errors.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });

  const response = await page.goto(baseURL, { waitUntil: "networkidle" });
  if (!response?.ok()) throw new Error(`HTTP ${response?.status() ?? "sin respuesta"}`);

  await page.locator("#readiness-badge").waitFor({ state: "visible" });
  await page.waitForFunction(
    () => document.querySelector("#readiness-badge")?.textContent !== "Comprobando",
  );

  const result = await page.evaluate(() => ({
    title: document.title,
    readiness: document.querySelector("#readiness-badge")?.textContent,
    diagnostics: document.querySelector("#diagnostics")?.textContent,
    isolated: crossOriginIsolated,
  }));

  if (errors.length > 0) throw new Error(`Errores de página:\n${errors.join("\n")}`);
  if (!result.isolated) throw new Error("La página no está aislada con COOP/COEP");
  if (!result.diagnostics?.includes("WebGPU")) throw new Error("Falta el diagnóstico WebGPU");

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
}
