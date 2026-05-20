import "dotenv/config";
import { debugDiscoverTcgListing } from "../src/lib/scraper/tcg";

const url = process.argv[2] ?? "https://tcgdistribution.fr/cartes-a-collectionner-japonais/";

const products = await debugDiscoverTcgListing(url);
console.log(`Découverte TCG: ${products.length} produit(s) trouvé(s) depuis ${url}`);
for (const product of products.slice(0, 80)) {
  console.log(`- ${product.url}${product.imageUrl ? ` | image: ${product.imageUrl}` : ""}`);
}
if (products.length > 80) console.log(`... ${products.length - 80} autre(s) produit(s)`);
