import { chromium, type Browser, type Page } from "playwright";
import { prisma } from "../db";
import { normalizeUrl } from "../format";

const BASE_URL = process.env.OWN_SITE_BASE_URL ?? "https://cartespokemon.com";
const DEFAULT_LISTING_URL = process.env.OWN_SITE_DEFAULT_LISTING_URL ?? `${BASE_URL}/collections/all`;
const DEFAULT_DELAY_MS = Number(process.env.SCRAPE_DELAY_MS ?? 2500);
const DEFAULT_MAX_PRODUCTS = Number(process.env.OWN_SCRAPE_MAX_PRODUCTS ?? 260);
const DISCOVER_MAX_PAGES = Number(process.env.OWN_DISCOVER_MAX_PAGES ?? 12);

type RunOptions = {
  maxProducts?: number;
  delayMs?: number;
  discover?: boolean;
};

type OwnExtractedProduct = {
  url: string;
  name: string | null;
  sku: string | null;
  imageUrl: string | null;
  price: number | null;
  priceText: string | null;
  stockStatus: string | null;
  stockText: string | null;
};

type LinkCandidate = {
  href: string;
  text: string;
  title: string;
  imageUrl?: string | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function absoluteUrl(raw: string | null | undefined, base = BASE_URL) {
  if (!raw) return null;
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

function parseFrenchNumber(raw: string) {
  const normalized = raw
    .replace(/[\s\u00a0.](?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".")
    .trim();

  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0 || value >= 100000) return null;
  return value;
}

function parsePriceFromText(text: string): { price: number; priceText: string } | null {
  const cleaned = text.replace(/\s+/g, " ").trim();

  const patterns = [
    /(?<!\d)(\d{1,5}(?:[\s\u00a0.]?\d{3})*(?:[,.]\d{2})?)\s*(?:€|EUR)\b/gi,
    /(?:"price"|price|prix)\s*[:=]\s*["']?(\d{1,5}(?:[\s\u00a0.]?\d{3})*(?:[,.]\d{1,2})?)["']?/gi
  ];

  for (const pattern of patterns) {
    const matches = cleaned.matchAll(pattern);
    for (const match of matches) {
      const value = parseFrenchNumber(match[1]);
      if (value !== null) return { price: value, priceText: match[0].trim() };
    }
  }

  return null;
}

function slugFromUrl(url: string) {
  const pathname = new URL(url).pathname.replace(/\/+$/, "");
  return pathname.split("/").filter(Boolean).at(-1) ?? "";
}

function extractSkuFromNameOrUrl(name: string | null, url: string) {
  const haystack = [name, slugFromUrl(url)]
    .filter(Boolean)
    .join(" ")
    .replace(/-/g, " ");

  const candidates = [
    /\b(OP)\s?(\d{2})\b/i,
    /\b(EB)\s?(\d{2})\b/i,
    /\b(SV\d+[A-Z]?)\b/i,
    /\b(M\d+[A-Z]?)\b/i,
    /\b([A-Z]{1,5}\d{1,4}[A-Z]?)\b/
  ];

  for (const regex of candidates) {
    const match = haystack.match(regex);
    if (!match) continue;

    if ((match[1] ?? "").toUpperCase() === "OP" || (match[1] ?? "").toUpperCase() === "EB") {
      return `${match[1].toUpperCase()}-${match[2]}`;
    }

    return match[1].toUpperCase();
  }

  return null;
}

function extractStock(text: string): { stockStatus: string | null; stockText: string | null } {
  const normalized = text.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/épuisé|epuise|rupture|indisponible|sold out/i, "out_of_stock"],
    [/précommande|precommande|pre-order/i, "preorder"],
    [/en stock|ajouter au panier|acheter|add to cart/i, "in_stock"]
  ];

  for (const [regex, status] of rules) {
    const match = normalized.match(regex);
    if (match) return { stockStatus: status, stockText: match[0] };
  }

  return { stockStatus: null, stockText: null };
}

async function launchBrowser(): Promise<Browser> {
  const remoteEndpoint = process.env.BROWSERLESS_WS_ENDPOINT || process.env.PLAYWRIGHT_WS_ENDPOINT;
  if (remoteEndpoint) {
    return chromium.connectOverCDP(remoteEndpoint);
  }

  const noSandbox = process.env.PLAYWRIGHT_NO_SANDBOX === "true";
  return chromium.launch({
    headless: true,
    args: noSandbox ? ["--no-sandbox", "--disable-setuid-sandbox"] : []
  });
}

function looksLikeOwnProductLink(candidate: LinkCandidate) {
  const normalized = normalizeUrl(candidate.href);
  if (!normalized.startsWith(BASE_URL)) return false;
  const path = new URL(normalized).pathname;
  return path.includes("/products/");
}

function looksLikePagination(candidate: LinkCandidate, sourceUrl: string) {
  const normalized = normalizeUrl(candidate.href);
  if (!normalized.startsWith(BASE_URL)) return false;
  const current = new URL(normalized);
  const source = new URL(sourceUrl);
  const text = `${candidate.text} ${candidate.title}`.trim();

  return current.pathname === source.pathname && (current.searchParams.has("page") || /^\d+$/.test(text) || /suivant|next/i.test(text));
}

async function readLinksFromPage(page: Page) {
  return page.evaluate(() => {
    function nearbyImage(anchor: HTMLAnchorElement) {
      const ownImage = anchor.querySelector<HTMLImageElement>("img");
      const containerImage = anchor.closest("article, li, div, section")?.querySelector<HTMLImageElement>("img");
      const img = ownImage || containerImage;
      return img?.currentSrc || img?.src || img?.getAttribute("data-src") || img?.getAttribute("data-original") || null;
    }

    return Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map((anchor) => ({
      href: anchor.href,
      text: anchor.textContent?.trim() ?? "",
      title: anchor.getAttribute("title") ?? anchor.getAttribute("aria-label") ?? "",
      imageUrl: nearbyImage(anchor)
    }));
  });
}

async function discoverOwnProductUrls(page: Page, sourceUrl: string) {
  const pagesToVisit = new Set<string>([normalizeUrl(sourceUrl)]);
  const visited = new Set<string>();
  const products = new Map<string, { url: string; imageUrl: string | null }>();

  while (pagesToVisit.size > 0 && visited.size < DISCOVER_MAX_PAGES) {
    const currentUrl = Array.from(pagesToVisit).find((candidate) => !visited.has(candidate));
    if (!currentUrl) break;
    visited.add(currentUrl);

    await page.goto(currentUrl, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    const candidates = await readLinksFromPage(page);
    for (const candidate of candidates) {
      const normalized = normalizeUrl(candidate.href);
      const normalizedCandidate = { ...candidate, href: normalized, imageUrl: absoluteUrl(candidate.imageUrl) };
      if (looksLikePagination(normalizedCandidate, sourceUrl)) pagesToVisit.add(normalized);
      if (looksLikeOwnProductLink(normalizedCandidate)) {
        products.set(normalized, { url: normalized, imageUrl: normalizedCandidate.imageUrl ?? null });
      }
    }
  }

  return Array.from(products.values());
}

async function collectPriceText(page: Page) {
  return page.evaluate(() => {
    const chunks: string[] = [];
    const push = (value: unknown) => {
      if (value === null || value === undefined) return;
      const text = String(value).replace(/\s+/g, " ").trim();
      if (text) chunks.push(text);
    };

    const selectors = [
      "[itemprop='price']",
      "meta[itemprop='price']",
      "meta[property='product:price:amount']",
      "[data-price]",
      ".price",
      ".product-price",
      "[class*='price']",
      "[class*='Price']"
    ];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => {
        push(element.textContent);
        for (const attr of ["content", "value", "data-price", "data-product-price", "data-amount"]) {
          push(element.getAttribute(attr));
        }
      });
    }

    document.querySelectorAll("script[type='application/ld+json']").forEach((script) => push(script.textContent));
    document.querySelectorAll("script").forEach((script) => {
      const text = script.textContent ?? "";
      if (/price|prix|€|EUR/i.test(text)) push(text.slice(0, 6000));
    });

    push(document.body?.innerText ?? "");
    return chunks.join("\n").slice(0, 50000);
  });
}

async function extractImageUrl(page: Page) {
  const raw = await page.evaluate(() => {
    const meta = document.querySelector<HTMLMetaElement>("meta[property='og:image'], meta[name='twitter:image']")?.content;
    if (meta) return meta;
    const image = document.querySelector<HTMLImageElement>(".product img, main img, article img, img[itemprop='image']");
    return image?.currentSrc || image?.src || image?.getAttribute("data-src") || image?.getAttribute("data-original") || null;
  });

  return absoluteUrl(raw);
}

async function extractOwnProduct(page: Page, url: string): Promise<OwnExtractedProduct> {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(800);

  const name = await page.locator("h1").first().innerText({ timeout: 5000 }).catch(() => null);
  const text = await collectPriceText(page);
  const imageUrl = await extractImageUrl(page);
  const price = parsePriceFromText(text);
  const stock = extractStock(text);

  return {
    url,
    name: name?.trim() || null,
    sku: extractSkuFromNameOrUrl(name?.trim() || null, url),
    imageUrl,
    price: price?.price ?? null,
    priceText: price?.priceText ?? null,
    stockStatus: stock.stockStatus,
    stockText: stock.stockText
  };
}


function hasPriceChanged(previous: unknown, current: number | null) {
  if (current === null || current === undefined) return false;
  if (previous === null || previous === undefined) return false;
  const before = Number(previous);
  return Number.isFinite(before) && Math.abs(before - current) >= 0.01;
}

export async function ensureDefaultOwnWatchUrl() {
  const existing = await prisma.supplierWatchUrl.findFirst({
    where: { supplier: "cartespokemon", active: true }
  });

  if (existing) return;

  await prisma.supplierWatchUrl.upsert({
    where: { url: normalizeUrl(DEFAULT_LISTING_URL) },
    update: { supplier: "cartespokemon", type: "listing", active: true },
    create: { supplier: "cartespokemon", type: "listing", url: normalizeUrl(DEFAULT_LISTING_URL) }
  });
}

export async function runOwnSiteScrape(options: RunOptions = {}) {
  const maxProducts = options.maxProducts ?? DEFAULT_MAX_PRODUCTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const shouldDiscover = options.discover ?? true;

  await ensureDefaultOwnWatchUrl();

  const run = await prisma.scrapeRun.create({
    data: { supplier: "cartespokemon", status: "running" }
  });

  let browser: Browser | null = null;
  let success = 0;
  let failed = 0;
  let discovered = 0;

  try {
    browser = await launchBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();

    if (shouldDiscover) {
      const listingUrls = await prisma.supplierWatchUrl.findMany({
        where: { supplier: "cartespokemon", active: true, type: "listing" }
      });

      for (const listing of listingUrls) {
        const productUrls = await discoverOwnProductUrls(page, listing.url);
        for (const productUrl of productUrls) {
          const existing = await prisma.ownProduct.findUnique({ where: { url: productUrl.url } });
          await prisma.ownProduct.upsert({
            where: { url: productUrl.url },
            update: { active: true, imageUrl: productUrl.imageUrl ?? undefined },
            create: { supplier: "cartespokemon", url: productUrl.url, imageUrl: productUrl.imageUrl }
          });
          if (!existing) discovered += 1;
        }
        await sleep(delayMs);
      }
    }

    const productWatchUrls = await prisma.supplierWatchUrl.findMany({
      where: { supplier: "cartespokemon", active: true, type: "product" }
    });

    for (const watched of productWatchUrls) {
      await prisma.ownProduct.upsert({
        where: { url: watched.url },
        update: { active: true },
        create: { supplier: "cartespokemon", url: watched.url }
      });
    }

    const products = await prisma.ownProduct.findMany({
      where: { supplier: "cartespokemon", active: true },
      orderBy: [{ lastSeenAt: "asc" }, { createdAt: "asc" }],
      take: maxProducts
    });

    await prisma.scrapeRun.update({ where: { id: run.id }, data: { total: products.length, discovered } });

    for (const product of products) {
      try {
        const extracted = await extractOwnProduct(page, product.url);
        const changed = hasPriceChanged(product.latestPrice, extracted.price);

        await prisma.ownPriceSnapshot.create({
          data: {
            productId: product.id,
            runId: run.id,
            name: extracted.name,
            price: extracted.price,
            priceText: extracted.priceText,
            imageUrl: extracted.imageUrl,
            stockStatus: extracted.stockStatus,
            stockText: extracted.stockText
          }
        });

        await prisma.ownProduct.update({
          where: { id: product.id },
          data: {
            name: extracted.name ?? product.name,
            sku: extracted.sku ?? product.sku,
            imageUrl: extracted.imageUrl ?? product.imageUrl,
            latestPrice: extracted.price ?? product.latestPrice,
            latestPriceText: extracted.priceText ?? product.latestPriceText,
            previousPrice: changed ? product.latestPrice : product.previousPrice,
            latestStockStatus: extracted.stockStatus ?? product.latestStockStatus,
            latestStockText: extracted.stockText ?? product.latestStockText,
            lastSeenAt: new Date()
          }
        });
        success += 1;
      } catch (error) {
        console.error(`Own site scrape failed for ${product.url}`, error);
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        await prisma.ownPriceSnapshot.create({
          data: {
            productId: product.id,
            runId: run.id,
            error: message.slice(0, 1000)
          }
        }).catch(() => undefined);
      }

      await sleep(delayMs);
    }

    const status = failed === 0 ? "success" : success > 0 ? "partial" : "failed";
    await prisma.scrapeRun.update({
      where: { id: run.id },
      data: {
        status,
        success,
        failed,
        discovered,
        finishedAt: new Date(),
        message: `${success} produits site OK, ${failed} erreur(s), ${discovered} lien(s) découverts`
      }
    });

    await context.close();
    return { runId: run.id, status, success, failed, discovered };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.scrapeRun.update({
      where: { id: run.id },
      data: { status: "failed", success, failed, discovered, finishedAt: new Date(), message: message.slice(0, 1000) }
    });
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
