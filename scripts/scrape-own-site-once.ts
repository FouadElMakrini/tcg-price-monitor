import "dotenv/config";
import { runOwnSiteScrape } from "../src/lib/scraper/own-site";
import { prisma } from "../src/lib/db";

async function main() {
  const maxOwn = Number(process.env.OWN_SCRAPE_MAX_PRODUCTS ?? 260);
  const result = await runOwnSiteScrape({ discover: true, maxProducts: maxOwn });
  console.log(result);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
