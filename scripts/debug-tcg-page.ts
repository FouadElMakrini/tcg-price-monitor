import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { collectPriceSignals, parsePriceFromText } from "../src/lib/scraper/tcg";

const url = process.argv[2];
if (!url) {
  console.error("Usage: npm run debug:tcg -- https://tcgdistribution.fr/url-produit");
  process.exit(1);
}

const storagePath = process.env.TCG_STORAGE_STATE_PATH ?? "storage/tcg-auth.json";
const debugDir = process.env.SCRAPER_DEBUG_DIR ?? "storage/debug";

function safeFilePart(input: string) {
  return input
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(
    fs.existsSync(path.resolve(process.cwd(), storagePath))
      ? { storageState: path.resolve(process.cwd(), storagePath) }
      : undefined
  );
  const page = await context.newPage();

  const response = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(1500);

  fs.mkdirSync(debugDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${stamp}-${safeFilePart(url)}`;

  const title = await page.locator("h1").first().innerText({ timeout: 5000 }).catch(() => "");
  const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const signals = await collectPriceSignals(page);
  const detectedPrice = signals.map((signal) => parsePriceFromText(signal.text)).find(Boolean) ?? null;

  const htmlPath = path.join(debugDir, `${base}.html`);
  const pngPath = path.join(debugDir, `${base}.png`);
  const jsonPath = path.join(debugDir, `${base}.signals.json`);

  await fs.promises.writeFile(htmlPath, await page.content(), "utf8");
  await fs.promises.writeFile(jsonPath, JSON.stringify({ url, status: response?.status(), title, detectedPrice, signals }, null, 2), "utf8");
  await page.screenshot({ path: pngPath, fullPage: true }).catch(() => undefined);

  console.log("URL:", url);
  console.log("HTTP:", response?.status());
  console.log("Titre:", title);
  console.log("Prix détecté:", detectedPrice ?? "aucun");
  console.log("Aperçu texte:");
  console.log(body.slice(0, 1200));
  console.log("\nFichiers debug:");
  console.log(htmlPath);
  console.log(pngPath);
  console.log(jsonPath);

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
