import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { CPC_SUPPLIER_FACTOR, CPC_SUPPLIER_FACTOR_2000, cpcSupplierPrice, cpcSupplierPrice2000 } from "@/lib/compare";

function numberValue(value: unknown) {
  if (value === null || value === undefined) return "";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2).replace(".", ",") : "";
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function packagingLabel(value: string | null | undefined) {
  if (value === "shrink") return "Shrink";
  if (value === "no_shrink") return "No shrink";
  return "";
}

export async function GET() {
  const products = await prisma.supplierProduct.findMany({
    where: { active: true },
    include: {
      mapping: { include: { ownProduct: true } },
      snapshots: { orderBy: { scrapedAt: "desc" }, take: 6 },
      extraSites: { orderBy: { updatedAt: "desc" } }
    },
    orderBy: [{ isFavorite: "desc" }, { updatedAt: "desc" }]
  });

  const rows = [[
    "Favori",
    "Shrink / No shrink",
    "Produit TCGD",
    "SKU TCGD",
    "URL TCGD",
    "Image TCGD",
    "Prix TCGD",
    "Ancien prix TCGD",
    "Stock TCGD",
    "Dernier scan TCGD",
    "Produit CPC",
    "SKU CPC",
    "URL CPC",
    "Image CPC",
    "Prix CPC site",
    `Prix CPC fournisseur x${String(CPC_SUPPLIER_FACTOR).replace(".", ",")}`,
    `Prix CPC +2000 x${String(CPC_SUPPLIER_FACTOR_2000).replace(".", ",")}`,
    "Stock CPC",
    "Dernier scan CPC",
    "Match auto %",
    "Ecart CPC x0,88 - TCGD",
    "Ecart CPC +2000 x0,77 - TCGD",
    "Coefficient CPC x0,88 / TCGD",
    "Coefficient CPC x0,77 / TCGD",
    "Historique TCGD récent",
    "Historique CPC récent",
    "Autres sites",
    "Prix autres sites"
  ]];

  for (const product of products) {
    const own = product.mapping?.ownProduct ?? null;
    const tcg = product.latestPrice === null ? null : Number(product.latestPrice);
    const cpcRetail = own?.latestPrice === null || own?.latestPrice === undefined ? null : Number(own.latestPrice);
    const cpcSupplier = cpcSupplierPrice(cpcRetail);
    const cpcSupplier2000 = cpcSupplierPrice2000(cpcRetail);
    const diff = tcg !== null && cpcSupplier !== null ? cpcSupplier - tcg : null;
    const diff2000 = tcg !== null && cpcSupplier2000 !== null ? cpcSupplier2000 - tcg : null;
    const coeff = tcg !== null && cpcSupplier !== null && tcg > 0 ? cpcSupplier / tcg : null;
    const coeff2000 = tcg !== null && cpcSupplier2000 !== null && tcg > 0 ? cpcSupplier2000 / tcg : null;
    rows.push([
      product.isFavorite ? "Oui" : "Non",
      packagingLabel(product.packagingMode),
      product.name ?? "",
      product.sku ?? "",
      product.url,
      product.imageUrl ?? "",
      numberValue(product.latestPrice),
      numberValue(product.previousPrice),
      product.latestStockStatus ?? "",
      product.lastSeenAt ? product.lastSeenAt.toISOString() : "",
      own?.name ?? "",
      own?.sku ?? "",
      own?.url ?? "",
      own?.imageUrl ?? "",
      numberValue(cpcRetail),
      numberValue(cpcSupplier),
      numberValue(cpcSupplier2000),
      own?.latestStockStatus ?? "",
      own?.lastSeenAt ? own.lastSeenAt.toISOString() : "",
      product.mapping?.matchScore == null ? "" : String(product.mapping.matchScore),
      numberValue(diff),
      numberValue(diff2000),
      coeff === null ? "" : coeff.toFixed(2).replace(".", ","),
      coeff2000 === null ? "" : coeff2000.toFixed(2).replace(".", ","),
      product.snapshots.map((snapshot) => numberValue(snapshot.price)).filter(Boolean).join(" -> "),
      own ? await prisma.ownPriceSnapshot.findMany({ where: { productId: own.id }, orderBy: { scrapedAt: "desc" }, take: 6 }).then((snaps) => snaps.map((snapshot) => numberValue(snapshot.price)).filter(Boolean).join(" -> ")) : "",
      product.extraSites.map((site) => `${site.siteName}: ${site.url}`).join(" | "),
      product.extraSites.map((site) => `${site.siteName}: ${numberValue(site.latestPrice)}`).join(" | ")
    ]);
  }

  const csv = rows.map((row) => row.map(csvCell).join(";")).join("\n");
  return new NextResponse(`\ufeff${csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="comparatif-tcgd-cpc-${new Date().toISOString().slice(0, 10)}.csv"`
    }
  });
}
