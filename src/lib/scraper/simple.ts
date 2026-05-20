import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { normalizeUrl } from "@/lib/format";
import { findBestOwnMatch, scoreMatch } from "@/lib/compare";

const TCG_BASE = "https://tcgdistribution.fr";
const CPC_BASE = "https://cartespokemon.com";

export type ImportResult = {
  source: "tcgdistribution" | "cartespokemon";
  url: string;
  discovered: number;
  imported: number;
  withPrice: number;
  failed: number;
  message: string;
};

type ProductData = {
  url: string;
  name: string | null;
  sku: string | null;
  imageUrl: string | null;
  price: number | null;
  priceText: string | null;
  stockStatus: string | null;
  stockText: string | null;
};

type DiscoveredLink = {
  url: string;
  name: string | null;
  imageUrl: string | null;
};

const TCG_CATEGORY_SLUGS = new Set([
  "cartes-a-collectionner-japonais",
  "cartes-a-collectionner-francais",
  "cartes-a-collectionner-chinois",
  "cartes-a-collectionner-coreens",
  "cartes-a-collectionner-us",
  "pokemon",
  "pokemon-fr",
  "onepiece",
  "one-piece",
  "yu-gi-oh-fr",
  "lorcana-fr",
  "univers-disney",
  "union-arena",
  "dragon-ball",
  "accessoires",
  "figurines"
]);

const BLOCKED_PARTS = [
  "panier",
  "compte",
  "contact",
  "conditions-generales",
  "mentions-legales",
  "formulaire",
  "retractation",
  "newsletter",
  "javascript:",
  "mailto:",
  "tel:",
  "facebook.com",
  "instagram.com",
  "linkedin.com"
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtml(input: string | null | undefined) {
  return (input ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&eacute;/gi, "é")
    .replace(/&egrave;/gi, "è")
    .replace(/&ecirc;/gi, "ê")
    .replace(/&agrave;/gi, "à")
    .replace(/&ccedil;/gi, "ç")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(raw: string | null | undefined, base: string) {
  if (!raw) return null;
  try {
    return normalizeUrl(new URL(raw, base).toString());
  } catch {
    return null;
  }
}

function slugFromUrl(url: string) {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, "");
    return pathname.split("/").filter(Boolean).at(-1) ?? "";
  } catch {
    return "";
  }
}

function parseFrenchNumber(raw: string) {
  const normalized = raw
    .replace(/[\s\u00a0.](?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".")
    .trim();
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0 || value > 100000) return null;
  return value;
}

function parsePriceFromHtml(html: string) {
  const snippets: string[] = [];

  for (const regex of [
    /<meta[^>]+(?:property|name|itemprop)=["'](?:product:price:amount|price|og:price:amount)["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<[^>]+(?:class|id)=["'][^"']*(?:price|prix|tarif)[^"']*["'][^>]*>([\s\S]{0,600}?)<\/[^>]+>/gi,
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    /<script[^>]*>([\s\S]{0,12000}?(?:price|prix|€|EUR)[\s\S]{0,12000}?)<\/script>/gi
  ]) {
    for (const match of html.matchAll(regex)) snippets.push(decodeHtml(match[1]));
  }

  snippets.push(decodeHtml(html));
  const joined = snippets.join("\n").replace(/\s+/g, " ");

  const currencyPatterns = [
    /(?<!\d)(\d{1,5}(?:[\s\u00a0.]?\d{3})*(?:[,.]\d{2}))\s*(?:€|EUR)\b/gi,
    /\b(?:prix|tarif|price|amount|montant)\b[^\d€]{0,60}(\d{1,5}(?:[\s\u00a0.]?\d{3})*(?:[,.]\d{2}))\b/gi,
    /\b(\d{1,5}(?:[\s\u00a0.]?\d{3})*(?:[,.]\d{2}))\s*(?:HT|TTC|hors taxes)\b/gi
  ];

  for (const regex of currencyPatterns) {
    for (const match of joined.matchAll(regex)) {
      const value = parseFrenchNumber(match[1]);
      if (value !== null) return { price: value, priceText: match[0].trim() };
    }
  }

  // Shopify expose parfois le prix en centimes dans du JSON: "price":4290.
  for (const match of joined.matchAll(/"price"\s*:\s*(\d{3,6})/gi)) {
    const cents = Number(match[1]);
    if (Number.isFinite(cents) && cents > 100) {
      return { price: cents / 100, priceText: `${(cents / 100).toFixed(2)} €` };
    }
  }

  return { price: null, priceText: null };
}

function extractName(html: string) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (h1) return decodeHtml(h1);

  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1];
  if (og) return decodeHtml(og);

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) return decodeHtml(title).replace(/\s*[|\-–].*$/, "").trim();

  return null;
}

function extractImage(html: string, base: string) {
  const candidates = [
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1],
    html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1],
    html.match(/<img[^>]+(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/i)?.[1]
  ];
  for (const candidate of candidates) {
    const url = absoluteUrl(candidate, base);
    if (url) return url;
  }
  return null;
}

function extractStock(html: string) {
  const text = decodeHtml(html).toLowerCase();
  if (/rupture|épuisé|epuise|indisponible|sold out/.test(text)) return { stockStatus: "out_of_stock", stockText: "rupture" };
  if (/précommande|precommande|pre-order/.test(text)) return { stockStatus: "preorder", stockText: "précommande" };
  if (/en stock|disponible|ajouter au panier|add to cart|acheter/.test(text)) return { stockStatus: "in_stock", stockText: "en stock" };
  if (/contactez-nous|contactez nous|demander un devis/.test(text)) return { stockStatus: "contact", stockText: "contactez-nous" };
  return { stockStatus: null, stockText: null };
}

function extractSku(name: string | null, url: string) {
  const haystack = `${name ?? ""} ${slugFromUrl(url).replace(/-/g, " ")}`.toUpperCase();
  const patterns = [
    /\b(OP)\s?-?\s?(\d{2})\b/,
    /\b(EB)\s?-?\s?(\d{2})\b/,
    /\b(PRB)\s?-?\s?(\d{2})\b/,
    /\b(SV\d+[A-Z]?)\b/,
    /\b(M\d+[A-Z]?)\b/,
    /\b(CSV\d+[A-Z]?)\b/,
    /\b(CBB\d+[A-Z]?)\b/,
    /\b([A-Z]{2,5}\d{1,4}[A-Z]?)\b/
  ];
  for (const pattern of patterns) {
    const match = haystack.match(pattern);
    if (!match) continue;
    if (match[1] === "OP" || match[1] === "EB" || match[1] === "PRB") return `${match[1]}-${match[2]}`;
    return match[1];
  }
  return null;
}

function cookiesFromStorageState(targetUrl: string) {
  const parts: string[] = [];
  const pushFromJson = (raw: string) => {
    try {
      const parsed = JSON.parse(raw);
      const host = new URL(targetUrl).hostname;
      for (const cookie of parsed.cookies ?? []) {
        const domain = String(cookie.domain ?? "").replace(/^\./, "");
        if (!domain || host === domain || host.endsWith(`.${domain}`)) {
          parts.push(`${cookie.name}=${cookie.value}`);
        }
      }
    } catch {
      // ignore
    }
  };

  if (process.env.TCG_COOKIE_HEADER?.trim()) return process.env.TCG_COOKIE_HEADER.trim();
  if (process.env.TCG_STORAGE_STATE_JSON?.trim()) pushFromJson(process.env.TCG_STORAGE_STATE_JSON.trim());

  const statePath = path.resolve(process.cwd(), process.env.TCG_STORAGE_STATE_PATH ?? "storage/tcg-auth.json");
  if (fs.existsSync(statePath)) pushFromJson(fs.readFileSync(statePath, "utf8"));

  return Array.from(new Set(parts)).join("; ");
}

async function fetchHtml(url: string, supplier: "tcgdistribution" | "cartespokemon") {
  const headers: Record<string, string> = {
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "fr-FR,fr;q=0.9,en;q=0.8"
  };

  if (supplier === "tcgdistribution") {
    const cookie = cookiesFromStorageState(url);
    if (cookie) headers.cookie = cookie;
  }

  const response = await fetch(url, { headers, cache: "no-store", redirect: "follow" });
  const html = await response.text();
  return { html, status: response.status, finalUrl: response.url };
}

function extractAnchorLinks(html: string, base: string) {
  const links: Array<{ url: string; text: string; imageUrl: string | null }> = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1] ?? "";
    const inner = match[2] ?? "";
    const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    const url = absoluteUrl(href, base);
    if (!url) continue;
    const imageCandidate =
      inner.match(/<img[^>]+(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/i)?.[1] ?? null;
    links.push({ url, text: decodeHtml(inner), imageUrl: absoluteUrl(imageCandidate, base) });
  }
  return links;
}

function isTcgProductUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "tcgdistribution.fr" && parsed.hostname !== "www.tcgdistribution.fr") return false;
    const path = parsed.pathname.replace(/\/+$/, "");
    const parts = path.split("/").filter(Boolean);
    const slug = parts.at(-1)?.toLowerCase() ?? "";
    if (parts.length !== 1) return false;
    if (!slug || /^\d+$/.test(slug) || TCG_CATEGORY_SLUGS.has(slug)) return false;
    if (BLOCKED_PARTS.some((part) => url.toLowerCase().includes(part))) return false;
    return slug.length > 12 || /(pokemon|one-piece|onepiece|boite|display|booster|deck|coffret|starter|sv\d|op-?\d|m\d)/i.test(slug);
  } catch {
    return false;
  }
}

function isCpcProductUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes("cartespokemon.com") && parsed.pathname.includes("/products/");
  } catch {
    return false;
  }
}

function nextTcgPageUrl(original: string, pageNumber: number) {
  if (pageNumber <= 1) return normalizeUrl(original);
  const url = new URL(original);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/${pageNumber}`;
  return normalizeUrl(url.toString());
}

function nextCpcPageUrl(original: string, pageNumber: number) {
  const url = new URL(original);
  if (pageNumber > 1) url.searchParams.set("page", String(pageNumber));
  return normalizeUrl(url.toString());
}

async function discoverProductsFromListing(
  supplier: "tcgdistribution" | "cartespokemon",
  sourceUrl: string,
  maxProducts: number
): Promise<DiscoveredLink[]> {
  const discovered = new Map<string, DiscoveredLink>();
  const maxPages = supplier === "tcgdistribution" ? Number(process.env.TCG_DISCOVER_MAX_PAGES ?? 30) : Number(process.env.CPC_DISCOVER_MAX_PAGES ?? 50);
  const base = supplier === "tcgdistribution" ? TCG_BASE : CPC_BASE;

  for (let page = 1; page <= maxPages && discovered.size < maxProducts; page++) {
    const pageUrl = supplier === "tcgdistribution" ? nextTcgPageUrl(sourceUrl, page) : nextCpcPageUrl(sourceUrl, page);
    const { html, status } = await fetchHtml(pageUrl, supplier);
    if (status >= 400 || html.length < 500) break;

    const anchors = extractAnchorLinks(html, base);
    let foundOnPage = 0;
    for (const anchor of anchors) {
      const isProduct = supplier === "tcgdistribution" ? isTcgProductUrl(anchor.url) : isCpcProductUrl(anchor.url);
      if (!isProduct) continue;
      if (!discovered.has(anchor.url)) {
        discovered.set(anchor.url, { url: anchor.url, name: anchor.text || null, imageUrl: anchor.imageUrl });
        foundOnPage++;
        if (discovered.size >= maxProducts) break;
      }
    }

    if (foundOnPage === 0 && page > 1) break;
    await sleep(Number(process.env.SCRAPE_DELAY_MS ?? 350));
  }

  return Array.from(discovered.values()).slice(0, maxProducts);
}

async function scrapeProductByFetch(supplier: "tcgdistribution" | "cartespokemon", url: string): Promise<ProductData> {
  const base = supplier === "tcgdistribution" ? TCG_BASE : CPC_BASE;
  const { html } = await fetchHtml(url, supplier);
  const name = extractName(html);
  const imageUrl = extractImage(html, base);
  const price = parsePriceFromHtml(html);
  const stock = extractStock(html);
  return {
    url: normalizeUrl(url),
    name,
    sku: extractSku(name, url),
    imageUrl,
    price: price.price,
    priceText: price.priceText,
    stockStatus: stock.stockStatus,
    stockText: stock.stockText
  };
}

function hasChanged(previous: unknown, current: number | null) {
  if (previous === null || previous === undefined || current === null) return false;
  const before = Number(previous);
  return Number.isFinite(before) && Math.abs(before - current) >= 0.01;
}

async function saveTcgProduct(data: ProductData, runId?: string | null) {
  const existing = await prisma.supplierProduct.findUnique({ where: { url: data.url } });
  const changed = hasChanged(existing?.latestPrice, data.price);
  const product = await prisma.supplierProduct.upsert({
    where: { url: data.url },
    update: {
      active: true,
      name: data.name ?? existing?.name,
      sku: data.sku ?? existing?.sku,
      imageUrl: data.imageUrl ?? existing?.imageUrl,
      previousPrice: changed ? existing?.latestPrice : existing?.previousPrice,
      latestPrice: data.price ?? existing?.latestPrice,
      latestPriceText: data.priceText ?? existing?.latestPriceText,
      latestStockStatus: data.stockStatus ?? existing?.latestStockStatus,
      latestStockText: data.stockText ?? existing?.latestStockText,
      lastSeenAt: new Date()
    },
    create: {
      supplier: "tcgdistribution",
      url: data.url,
      name: data.name,
      sku: data.sku,
      imageUrl: data.imageUrl,
      latestPrice: data.price,
      latestPriceText: data.priceText,
      latestStockStatus: data.stockStatus,
      latestStockText: data.stockText,
      lastSeenAt: new Date()
    }
  });

  await prisma.priceSnapshot.create({
    data: {
      productId: product.id,
      runId: runId ?? undefined,
      name: data.name,
      price: data.price,
      priceText: data.priceText,
      imageUrl: data.imageUrl,
      stockStatus: data.stockStatus,
      stockText: data.stockText
    }
  });

  return product;
}

async function saveCpcProduct(data: ProductData, runId?: string | null) {
  const existing = await prisma.ownProduct.findUnique({ where: { url: data.url } });
  const changed = hasChanged(existing?.latestPrice, data.price);
  const product = await prisma.ownProduct.upsert({
    where: { url: data.url },
    update: {
      active: true,
      name: data.name ?? existing?.name,
      sku: data.sku ?? existing?.sku,
      imageUrl: data.imageUrl ?? existing?.imageUrl,
      previousPrice: changed ? existing?.latestPrice : existing?.previousPrice,
      latestPrice: data.price ?? existing?.latestPrice,
      latestPriceText: data.priceText ?? existing?.latestPriceText,
      latestStockStatus: data.stockStatus ?? existing?.latestStockStatus,
      latestStockText: data.stockText ?? existing?.latestStockText,
      lastSeenAt: new Date()
    },
    create: {
      supplier: "cartespokemon",
      url: data.url,
      name: data.name,
      sku: data.sku,
      imageUrl: data.imageUrl,
      latestPrice: data.price,
      latestPriceText: data.priceText,
      latestStockStatus: data.stockStatus,
      latestStockText: data.stockText,
      lastSeenAt: new Date()
    }
  });

  await prisma.ownPriceSnapshot.create({
    data: {
      productId: product.id,
      runId: runId ?? undefined,
      name: data.name,
      price: data.price,
      priceText: data.priceText,
      imageUrl: data.imageUrl,
      stockStatus: data.stockStatus,
      stockText: data.stockText
    }
  });

  return product;
}

export async function importTcgPage(url: string, maxProducts = 80): Promise<ImportResult> {
  const normalizedUrl = normalizeUrl(url);
  await prisma.supplierWatchUrl.upsert({
    where: { url: normalizedUrl },
    update: { supplier: "tcgdistribution", type: "listing", active: true },
    create: { supplier: "tcgdistribution", type: "listing", url: normalizedUrl }
  });

  const run = await prisma.scrapeRun.create({ data: { supplier: "tcgdistribution", status: "running", message: `Import ${normalizedUrl}` } });
  let imported = 0;
  let withPrice = 0;
  let failed = 0;
  let links: DiscoveredLink[] = [];

  try {
    links = isTcgProductUrl(normalizedUrl)
      ? [{ url: normalizedUrl, name: null, imageUrl: null }]
      : await discoverProductsFromListing("tcgdistribution", normalizedUrl, maxProducts);

    for (const link of links) {
      try {
        const data = await scrapeProductByFetch("tcgdistribution", link.url);
        data.name ||= link.name;
        data.imageUrl ||= link.imageUrl;
        await saveTcgProduct(data, run.id);
        imported++;
        if (data.price !== null) withPrice++;
      } catch {
        failed++;
      }
      await sleep(Number(process.env.SCRAPE_DELAY_MS ?? 350));
    }

    await prisma.scrapeRun.update({
      where: { id: run.id },
      data: { status: failed > 0 ? "partial" : "success", finishedAt: new Date(), total: links.length, success: imported, failed, discovered: links.length }
    });
  } catch (error) {
    await prisma.scrapeRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date(), message: error instanceof Error ? error.message : String(error), failed: 1 }
    });
    throw error;
  }

  await autoMatchProducts({ threshold: Number(process.env.AUTO_MATCH_THRESHOLD ?? 82), overwrite: false });

  return {
    source: "tcgdistribution",
    url: normalizedUrl,
    discovered: links.length,
    imported,
    withPrice,
    failed,
    message: `${imported}/${links.length} produits TCGD importés, ${withPrice} avec prix. Match auto lancé.`
  };
}

export async function importCpcPage(url: string, maxProducts = 80): Promise<ImportResult> {
  const normalizedUrl = normalizeUrl(url);
  await prisma.supplierWatchUrl.upsert({
    where: { url: normalizedUrl },
    update: { supplier: "cartespokemon", type: "listing", active: true },
    create: { supplier: "cartespokemon", type: "listing", url: normalizedUrl }
  });

  const run = await prisma.scrapeRun.create({ data: { supplier: "cartespokemon", status: "running", message: `Import ${normalizedUrl}` } });
  let imported = 0;
  let withPrice = 0;
  let failed = 0;
  let links: DiscoveredLink[] = [];

  try {
    links = isCpcProductUrl(normalizedUrl)
      ? [{ url: normalizedUrl, name: null, imageUrl: null }]
      : await discoverProductsFromListing("cartespokemon", normalizedUrl, maxProducts);

    for (const link of links) {
      try {
        const data = await scrapeProductByFetch("cartespokemon", link.url);
        data.name ||= link.name;
        data.imageUrl ||= link.imageUrl;
        await saveCpcProduct(data, run.id);
        imported++;
        if (data.price !== null) withPrice++;
      } catch {
        failed++;
      }
      await sleep(Number(process.env.SCRAPE_DELAY_MS ?? 250));
    }

    await prisma.scrapeRun.update({
      where: { id: run.id },
      data: { status: failed > 0 ? "partial" : "success", finishedAt: new Date(), total: links.length, success: imported, failed, discovered: links.length }
    });
  } catch (error) {
    await prisma.scrapeRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date(), message: error instanceof Error ? error.message : String(error), failed: 1 }
    });
    throw error;
  }

  await autoMatchProducts({ threshold: Number(process.env.AUTO_MATCH_THRESHOLD ?? 82), overwrite: false });

  return {
    source: "cartespokemon",
    url: normalizedUrl,
    discovered: links.length,
    imported,
    withPrice,
    failed,
    message: `${imported}/${links.length} produits CPC importés, ${withPrice} avec prix. Match auto lancé.`
  };
}

export async function refreshAllTcg(maxProducts = 300) {
  const products = await prisma.supplierProduct.findMany({
    where: { active: true },
    orderBy: { updatedAt: "desc" },
    take: maxProducts
  });
  const run = await prisma.scrapeRun.create({ data: { supplier: "tcgdistribution", status: "running", total: products.length, message: "Refresh TCGD" } });
  let success = 0;
  let failed = 0;
  let withPrice = 0;
  for (const product of products) {
    try {
      const data = await scrapeProductByFetch("tcgdistribution", product.url);
      await saveTcgProduct(data, run.id);
      success++;
      if (data.price !== null) withPrice++;
    } catch {
      failed++;
    }
    await sleep(Number(process.env.SCRAPE_DELAY_MS ?? 350));
  }
  await prisma.scrapeRun.update({ where: { id: run.id }, data: { status: failed ? "partial" : "success", finishedAt: new Date(), success, failed, message: `${withPrice} prix trouvés` } });
}

export async function refreshAllCpc(maxProducts = 300) {
  const products = await prisma.ownProduct.findMany({
    where: { active: true },
    orderBy: { updatedAt: "desc" },
    take: maxProducts
  });
  const run = await prisma.scrapeRun.create({ data: { supplier: "cartespokemon", status: "running", total: products.length, message: "Refresh CPC" } });
  let success = 0;
  let failed = 0;
  let withPrice = 0;
  for (const product of products) {
    try {
      const data = await scrapeProductByFetch("cartespokemon", product.url);
      await saveCpcProduct(data, run.id);
      success++;
      if (data.price !== null) withPrice++;
    } catch {
      failed++;
    }
    await sleep(Number(process.env.SCRAPE_DELAY_MS ?? 250));
  }
  await prisma.scrapeRun.update({ where: { id: run.id }, data: { status: failed ? "partial" : "success", finishedAt: new Date(), success, failed, message: `${withPrice} prix trouvés` } });
}

export async function refreshOneTcgProduct(productId: string) {
  const product = await prisma.supplierProduct.findUnique({ where: { id: productId } });
  if (!product) return;
  const data = await scrapeProductByFetch("tcgdistribution", product.url);
  await saveTcgProduct(data, null);
}

export async function linkCpcUrlToTcgProduct(tcgProductId: string, cpcUrl: string) {
  const normalizedUrl = normalizeUrl(cpcUrl);
  const data = await scrapeProductByFetch("cartespokemon", normalizedUrl);
  const own = await saveCpcProduct(data, null);
  await prisma.productMapping.upsert({
    where: { supplierProductId: tcgProductId },
    update: { ownProductId: own.id },
    create: { supplierProductId: tcgProductId, ownProductId: own.id }
  });
}

export async function removeLink(tcgProductId: string) {
  await prisma.productMapping.deleteMany({ where: { supplierProductId: tcgProductId } });
}



export async function cleanupUnsafeAutoMatches(options: { threshold?: number; limit?: number } = {}) {
  const threshold = options.threshold ?? Number(process.env.AUTO_MATCH_THRESHOLD ?? 82);
  const mappings = await prisma.productMapping.findMany({
    where: { autoMatched: true },
    include: { supplierProduct: true, ownProduct: true },
    take: options.limit ?? 1200
  });

  let removed = 0;
  let kept = 0;

  for (const mapping of mappings) {
    const score = scoreMatch(mapping.supplierProduct, mapping.ownProduct);
    if (score < threshold) {
      await prisma.productMapping.delete({ where: { id: mapping.id } });
      removed++;
    } else {
      await prisma.productMapping.update({
        where: { id: mapping.id },
        data: { matchScore: score, note: `Match auto vérifié: ${score}%` }
      });
      kept++;
    }
  }

  return { removed, kept, threshold };
}

export async function autoMatchProducts(options: { threshold?: number; overwrite?: boolean; limit?: number; cleanup?: boolean } = {}) {
  const threshold = options.threshold ?? Number(process.env.AUTO_MATCH_THRESHOLD ?? 82);
  const limit = options.limit ?? 600;

  if (options.cleanup !== false) {
    await cleanupUnsafeAutoMatches({ threshold });
  }

  const [tcgProducts, ownProducts] = await Promise.all([
    prisma.supplierProduct.findMany({
      where: options.overwrite ? { active: true } : { active: true, mapping: null },
      orderBy: [{ isFavorite: "desc" }, { updatedAt: "desc" }],
      take: limit
    }),
    prisma.ownProduct.findMany({
      where: { active: true },
      orderBy: { updatedAt: "desc" },
      take: 1500
    })
  ]);

  let matched = 0;
  let skipped = 0;

  for (const product of tcgProducts) {
    const best = findBestOwnMatch(product, ownProducts, threshold);
    if (!best || best.score < threshold) {
      skipped++;
      continue;
    }

    await prisma.productMapping.upsert({
      where: { supplierProductId: product.id },
      update: {
        ownProductId: best.product.id,
        autoMatched: true,
        matchScore: best.score,
        note: `Match auto strict: ${best.score}%`
      },
      create: {
        supplierProductId: product.id,
        ownProductId: best.product.id,
        autoMatched: true,
        matchScore: best.score,
        note: `Match auto strict: ${best.score}%`
      }
    });
    matched++;
  }

  return { matched, skipped, threshold, candidates: tcgProducts.length, ownProducts: ownProducts.length };
}

export async function setTcgFavorite(productId: string, isFavorite: boolean) {
  await prisma.supplierProduct.update({ where: { id: productId }, data: { isFavorite } });
}

export async function setTcgPackaging(productId: string, packagingMode: string) {
  const allowed = new Set(["unknown", "shrink", "no_shrink"]);
  await prisma.supplierProduct.update({
    where: { id: productId },
    data: { packagingMode: allowed.has(packagingMode) ? packagingMode : "unknown" }
  });
}
