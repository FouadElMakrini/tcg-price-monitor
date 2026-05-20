import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const target = process.env.TCG_STORAGE_STATE_PATH ?? "storage/tcg-auth.json";
const baseUrl = process.env.TCG_BASE_URL ?? "https://tcgdistribution.fr";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(baseUrl, { waitUntil: "networkidle" });

  console.log("Connecte-toi manuellement à ton compte TCG Distribution dans la fenêtre ouverte.");
  console.log("Ouvre une fiche produit TCGD et vérifie que le prix fournisseur est visible.");
  console.log("Quand c'est bon, reviens dans le terminal et appuie sur Entrée.");

  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });

  const absolute = path.resolve(process.cwd(), target);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  await context.storageState({ path: absolute });
  await browser.close();

  console.log(`Session sauvegardée dans ${absolute}`);
  console.log("Pour Vercel, copie le contenu de ce fichier dans la variable TCG_STORAGE_STATE_JSON.");
  console.log("Ne commit jamais ce fichier dans GitHub.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
