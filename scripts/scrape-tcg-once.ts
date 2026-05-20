import "dotenv/config";
import { runTcgScrape } from "../src/lib/scraper/tcg";
import { runOwnSiteScrape } from "../src/lib/scraper/own-site";
import { prisma } from "../src/lib/db";

async function main() {
  const maxTcg = Number(process.env.SCRAPE_MAX_PRODUCTS ?? 260);
  const maxOwn = Number(process.env.OWN_SCRAPE_MAX_PRODUCTS ?? 260);
  const tcg = await runTcgScrape({ discover: true, maxProducts: maxTcg });
  const own = await runOwnSiteScrape({ discover: true, maxProducts: maxOwn });
  console.log({ tcg, cartespokemon: own });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
