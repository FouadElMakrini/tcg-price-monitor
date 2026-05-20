import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContextOptions, type Page, type Response as PlaywrightResponse } from "playwright";
import { prisma } from "../db";
import { normalizeUrl } from "../format";

const BASE_URL = process.env.TCG_BASE_URL ?? "https://tcgdistribution.fr";
const STORAGE_STATE_PATH = process.env.TCG_STORAGE_STATE_PATH ?? "storage/tcg-auth.json";
const DEFAULT_DELAY_MS = Number(process.env.SCRAPE_DELAY_MS ?? 2500);
const DEFAULT_MAX_PRODUCTS = Number(process.env.SCRAPE_MAX_PRODUCTS ?? 260);
const DISCOVER_FROM_WATCH_URLS = process.env.DISCOVER_FROM_WATCH_URLS !== "false";
const DISCOVER_MAX_PAGES = Number(process.env.TCG_DISCOVER_MAX_PAGES ?? 12);
const SCRAPER_DEBUG = process.env.SCRAPER_DEBUG === "true";
const DEBUG_DIR = process.env.SCRAPER_DEBUG_DIR ?? "storage/debug";

type ExtractedProduct = {
  url: string;
  name: string | null;
  sku: string | null;
  imageUrl: string | null;
  price: number | null;
  priceText: string | null;
  stockStatus: string | null;
  stockText: string | null;
  httpStatus: number | null;
};

type RunOptions = {
  maxProducts?: number;
  delayMs?: number;
  discover?: boolean;
  productIds?: string[];
  onlyMissingPrices?: boolean;
};

type PriceSignal = {
  source: string;
  text: string;
};

type LinkCandidate = {
  href: string;
  text: string;
  title: string;
  className: string;
  imageUrl?: string | null;
};

const BLOCKED_URL_PARTS = [
  "panier",
  "compte",
  "contact",
  "formulaire",
  "conditions-generales",
  "mentions-legales",
  "qui-sommes-nous",
  "retractation",
  "newsletter",
  "javascript:",
  "mailto:",
  "tel:",
  "pinterest.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com"
];

const CATEGORY_SLUGS = new Set([
  "cartes-a-collectionner-francais",
  "cartes-a-collectionner-japonais",
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
  "figurines",
  "accessoires",
  "sleeves",
  "toploader",
  "jeux-video",
  "pokemon-center"
]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function storageStateIfExists(): BrowserContextOptions['storageState'] | undefined {
  const rawJson = process.env.TCG_STORAGE_STATE_JSON;
  if (rawJson?.trim()) {
    try {
      return JSON.parse(rawJson);
    } catch (error) {
      console.warn('TCG_STORAGE_STATE_JSON invalide, fallback fichier local', error);
    }
  }

  const absolute = path.resolve(process.cwd(), STORAGE_STATE_PATH);
  return fs.existsSync(absolute) ? absolute : undefined;
}

function slugFromUrl(url: string) {
  const pathname = new URL(url).pathname.replace(/\/+$/, "");
  return pathname.split("/").filter(Boolean).at(-1) ?? "";
}

function absoluteUrl(raw: string | null | undefined, base = BASE_URL) {
  if (!raw) return null;
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

function normalizeAbsoluteUrl(raw: string | null | undefined, base = BASE_URL) {
  const absolute = absoluteUrl(raw, base);
  if (!absolute) return null;
  try {
    return normalizeUrl(absolute);
  } catch {
    return null;
  }
}

function isKnownCategorySlug(slug: string) {
  return CATEGORY_SLUGS.has(slug.toLowerCase());
}

function isProbablyTcgListingUrl(url: string) {
  try {
    const parsed = new URL(normalizeUrl(url));
    const parts = parsed.pathname.split("/").filter(Boolean);
    const last = (parts.at(-1) ?? "").toLowerCase();
    const previous = (parts.at(-2) ?? "").toLowerCase();

    if (isKnownCategorySlug(last)) return true;
    if (/^\d+$/.test(last) && isKnownCategorySlug(previous)) return true;
    return false;
  } catch {
    return false;
  }
}

function safeFilePart(input: string) {
  return input
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
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

export function parsePriceFromText(text: string): { price: number; priceText: string } | null {
  const cleaned = text.replace(/\s+/g, " ").trim();

  const explicitCurrencyPatterns = [
    /(?<!\d)(\d{1,5}(?:[\s\u00a0.]?\d{3})*(?:[,.]\d{2})?)\s*(?:€|EUR|HT|TTC)\b/gi,
    /\b(?:prix|tarif|price|montant|total)\b\D{0,35}(\d{1,5}(?:[\s\u00a0.]?\d{3})*(?:[,.]\d{2})?)\b/gi,
    /\b(\d{1,5}(?:[\s\u00a0.]?\d{3})*(?:[,.]\d{2})?)\s*€?\s*(?:hors taxes|ht|ttc)\b/gi
  ];

  for (const pattern of explicitCurrencyPatterns) {
    const matches = cleaned.matchAll(pattern);
    for (const match of matches) {
      const value = parseFrenchNumber(match[1]);
      if (value !== null) return { price: value, priceText: match[0].trim() };
    }
  }

  return null;
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
    [/rupture|épuisé|epuise|indisponible|stock épuisé|stock epuise|sold out/i, "out_of_stock"],
    [/précommande|precommande|pre-order|sur commande/i, "preorder"],
    [/en stock|disponible|ajouter au panier|acheter/i, "in_stock"],
    [/contactez-nous|contactez nous|demander un devis|se connecter à son compte|se connecter a son compte/i, "contact"]
  ];

  for (const [regex, status] of rules) {
    const match = normalized.match(regex);
    if (match) return { stockStatus: status, stockText: match[0] };
  }

  return { stockStatus: null, stockText: null };
}

function isProbablyListingPage(url: string, h1: string | null, bodyText: string) {
  const slug = slugFromUrl(url);
  const text = bodyText.toLowerCase();
  const title = h1?.toLowerCase() ?? "";

  if (CATEGORY_SLUGS.has(slug)) return true;
  if (/\b\d+\s+articles\b/i.test(bodyText) && /\btrier\b/i.test(bodyText)) return true;
  if (title.includes("cartes à collectionner") && /\barticles\b/i.test(bodyText)) return true;
  if (text.includes("du - cher au + cher") && text.includes("du + récent au + ancien")) return true;

  return false;
}

function looksLikeProductLink(candidate: LinkCandidate, sourceUrl: string) {
  const normalizedCandidate = normalizeAbsoluteUrl(candidate.href, sourceUrl);
  const normalizedSource = normalizeAbsoluteUrl(sourceUrl) ?? normalizeUrl(sourceUrl);
  if (!normalizedCandidate) return false;

  const hrefLower = normalizedCandidate.toLowerCase();
  const text = `${candidate.text} ${candidate.title}`.replace(/\s+/g, " ").trim();
  const textLower = text.toLowerCase();

  if (normalizedCandidate === normalizedSource) return false;
  if (!normalizedCandidate.startsWith(BASE_URL)) return false;
  if (hrefLower.includes("#")) return false;
  if (BLOCKED_URL_PARTS.some((part) => hrefLower.includes(part))) return false;

  const url = new URL(normalizedCandidate);
  const parts = url.pathname.split("/").filter(Boolean);
  const slug = (parts.at(-1) ?? "").toLowerCase();

  // Chez TCG Distribution / WiziShop, les fiches produit publiques sont des URLs
  // en un seul segment, par exemple /pokemon-display-sv1s-ecarlate-scarlet-japonais.
  // Les catégories/paginations ont soit un slug connu, soit plusieurs segments.
  if (parts.length !== 1) return false;
  if (!slug || slug.endsWith(".html")) return false;
  if (isKnownCategorySlug(slug)) return false;
  if (/^\d+$/.test(slug)) return false;

  if (/voir tous|retour accueil|compte|panier|service client|satisfait ou remboursé|formulaire|contactez-nous/i.test(textLower)) return false;
  if (/^cartes à collectionner|^figurines$|^accessoires$|^pokemon$|^onepiece$|^one piece$|^univers disney$|^union arena$|^dragon ball$/i.test(textLower)) return false;

  const productWords = /pokemon|one piece|onepiece|yu.?gi|lorcana|bo[îi]te|boite|box|display|booster|boosters|deck|starter|coffret|bundle|pack|sv\d|op-?\d|eb-?\d|m\d/i;
  const slugLooksProduct = /(pokemon|one-piece|onepiece|display|boite|booster|boosters|deck|starter|coffret|bundle|sv\d|op-?\d|eb-?\d|m\d)/i.test(slug);

  if (text.length < 12 && !slugLooksProduct) return false;
  if (!productWords.test(text) && !slugLooksProduct && slug.length < 24) return false;

  return true;
}

function looksLikePagination(candidate: LinkCandidate, sourceUrl: string) {
  const normalizedHref = normalizeAbsoluteUrl(candidate.href, sourceUrl);
  const normalizedSource = normalizeAbsoluteUrl(sourceUrl) ?? normalizeUrl(sourceUrl);
  if (!normalizedHref) return false;
  if (!normalizedHref.startsWith(BASE_URL)) return false;
  if (BLOCKED_URL_PARTS.some((part) => normalizedHref.toLowerCase().includes(part))) return false;
  if (normalizedSource === normalizedHref) return false;

  const sourcePath = new URL(normalizedSource).pathname.replace(/\/+$/, "");
  const path = new URL(normalizedHref).pathname.replace(/\/+$/, "");
  const text = `${candidate.text} ${candidate.title}`.trim();

  return path.startsWith(`${sourcePath}/`) && (/^\d+$/.test(text) || /page|suivant|next/i.test(text));
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

function createContextOptions(storageState?: BrowserContextOptions['storageState']): BrowserContextOptions {
  return {
    ...(storageState ? { storageState } : {}),
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    viewport: { width: 1440, height: 1200 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "accept-language": "fr-FR,fr;q=0.9,en;q=0.8"
    }
  };
}

export async function collectPriceSignals(page: Page): Promise<PriceSignal[]> {
  return page.evaluate(() => {
    const signals: PriceSignal[] = [];
    const push = (source: string, value: unknown) => {
      if (value === null || value === undefined) return;
      const text = String(value).replace(/\s+/g, " ").trim();
      if (text) signals.push({ source, text });
    };

    const selectors = [
      "[itemprop='price']",
      "meta[itemprop='price']",
      "meta[property='product:price:amount']",
      "meta[property='og:price:amount']",
      "[data-price]",
      "[data-product-price]",
      "[data-amount]",
      ".price",
      ".prices",
      ".product-price",
      ".productPrice",
      ".product_price",
      ".prix",
      "[class*='price']",
      "[class*='Price']",
      "[class*='prix']",
      "[id*='price']",
      "[id*='Price']",
      "[id*='prix']",
      "[class*='tarif']",
      "[id*='tarif']",
      "[data-prix]",
      "[data-tarif]"
    ];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => {
        push(`selector:${selector}:text`, element.textContent);
        for (const attr of ["content", "value", "data-price", "data-product-price", "data-amount", "data-prix", "data-tarif", "data-sale-price", "data-regular-price"]) {
          push(`selector:${selector}:${attr}`, element.getAttribute(attr));
        }
      });
    }

    document.querySelectorAll("script[type='application/ld+json']").forEach((script, index) => {
      push(`jsonld:${index}`, script.textContent);
    });

    document.querySelectorAll("script").forEach((script, index) => {
      const text = script.textContent ?? "";
      if (/price|prix|€|EUR|HT|TTC/i.test(text)) {
        push(`script:${index}`, text.slice(0, 6000));
      }
    });

    const bodyText = document.body?.innerText ?? "";
    bodyText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /prix|price|€|EUR|HT|TTC/i.test(line))
      .slice(0, 80)
      .forEach((line, index) => push(`body-line:${index}`, line));

    push("body", bodyText.slice(0, 30000));

    return signals.slice(0, 160);
  });
}

function shouldInspectNetworkResponse(response: PlaywrightResponse) {
  const url = response.url().toLowerCase();
  const contentType = response.headers()["content-type"]?.toLowerCase() ?? "";

  if (!url.includes("tcgdistribution") && !url.includes("wizishop")) return false;
  if (url.match(/\.(png|jpe?g|gif|webp|svg|ico|css|woff2?|ttf)(?:\?|$)/)) return false;

  return (
    contentType.includes("json") ||
    contentType.includes("text") ||
    contentType.includes("html") ||
    contentType.includes("javascript") ||
    url.includes("ajax") ||
    url.includes("api") ||
    url.includes("product") ||
    url.includes("produit") ||
    url.includes("prix") ||
    url.includes("price")
  );
}

async function readNetworkPriceSignal(response: PlaywrightResponse): Promise<PriceSignal | null> {
  if (!shouldInspectNetworkResponse(response)) return null;

  try {
    const text = await response.text();
    if (!/prix|price|€|EUR|HT|TTC|montant|tarif/i.test(text)) return null;

    return {
      source: `network:${response.status()}:${response.url()}`,
      text: text.slice(0, 12000)
    };
  } catch {
    return null;
  }
}

function parsePriceFromSignals(signals: PriceSignal[]) {
  for (const signal of signals) {
    const fromText = parsePriceFromText(signal.text);
    if (fromText) return fromText;

    if (signal.source.startsWith("jsonld") || signal.source.startsWith("script")) {
      const jsonLikeMatches = signal.text.matchAll(/(?:"price"|price|prix)\s*[:=]\s*["']?(\d{1,5}(?:[\s\u00a0.]?\d{3})*(?:[,.]\d{1,2})?)["']?/gi);
      for (const match of jsonLikeMatches) {
        const value = parseFrenchNumber(match[1]);
        if (value !== null) return { price: value, priceText: match[0].trim() };
      }
    }
  }

  return null;
}

async function extractImageUrl(page: Page) {
  const raw = await page.evaluate(() => {
    const meta = document.querySelector<HTMLMetaElement>("meta[property='og:image'], meta[name='twitter:image']")?.content;
    if (meta) return meta;

    const image = document.querySelector<HTMLImageElement>(
      ".product img, [class*='product'] img, main img, article img, img[itemprop='image']"
    );

    return image?.currentSrc || image?.src || image?.getAttribute("data-src") || image?.getAttribute("data-original") || null;
  });

  return absoluteUrl(raw);
}

async function saveDebugArtifacts(page: Page, url: string, reason: string, signals: PriceSignal[]) {
  if (!SCRAPER_DEBUG) return;

  const dir = path.resolve(process.cwd(), DEBUG_DIR);
  fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${stamp}-${safeFilePart(url)}-${safeFilePart(reason)}`;

  const htmlPath = path.join(dir, `${base}.html`);
  const screenshotPath = path.join(dir, `${base}.png`);
  const signalsPath = path.join(dir, `${base}.signals.json`);

  await fs.promises.writeFile(htmlPath, await page.content(), "utf8");
  await fs.promises.writeFile(signalsPath, JSON.stringify({ url, reason, signals }, null, 2), "utf8");
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);

  console.log(`Debug sauvegardé: ${htmlPath}`);
  console.log(`Debug sauvegardé: ${signalsPath}`);
  console.log(`Debug sauvegardé: ${screenshotPath}`);
}

async function extractProduct(page: Page, url: string): Promise<ExtractedProduct> {
  const networkSignals: PriceSignal[] = [];
  const networkSignalPromises: Promise<void>[] = [];
  const responseListener = (networkResponse: PlaywrightResponse) => {
    networkSignalPromises.push(
      readNetworkPriceSignal(networkResponse).then((signal) => {
        if (signal) networkSignals.push(signal);
      })
    );
  };

  page.on("response", responseListener);
  const response = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2500);
  page.off("response", responseListener);
  await Promise.allSettled(networkSignalPromises);

  const httpStatus = response?.status() ?? null;
  const name = await page.locator("h1").first().innerText({ timeout: 5000 }).catch(() => null);
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const imageUrl = await extractImageUrl(page);
  const signals = [...(await collectPriceSignals(page)), ...networkSignals];

  if (isProbablyListingPage(url, name, bodyText)) {
    await saveDebugArtifacts(page, url, "listing-page-skipped", signals);
    throw new Error("Cette URL ressemble à une page catégorie/listing, pas à une fiche produit. Archive ce produit et ajoute l'URL en type Listing.");
  }

  const combinedText = signals.map((signal) => signal.text).join("\n");
  const price = parsePriceFromSignals(signals);
  const stock = extractStock(combinedText || bodyText);

  if (!price) {
    await saveDebugArtifacts(page, url, "price-not-found", signals);
  }

  return {
    url,
    name: name?.trim() || null,
    sku: extractSkuFromNameOrUrl(name?.trim() || null, url),
    imageUrl,
    price: price?.price ?? null,
    priceText: price?.priceText ?? null,
    stockStatus: stock.stockStatus,
    stockText: stock.stockText,
    httpStatus
  };
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
      className: anchor.className?.toString() ?? "",
      imageUrl: nearbyImage(anchor)
    }));
  });
}


function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value: string) {
  return decodeHtmlEntities(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function attrFromHtml(tag: string, attr: string) {
  const regex = new RegExp(`${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(regex);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function readLinksFromHtml(html: string, pageUrl: string): LinkCandidate[] {
  const candidates: LinkCandidate[] = [];
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(html))) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const href = attrFromHtml(attrs, "href");
    if (!href) continue;

    const imageTag = body.match(/<img\b[^>]*>/i)?.[0] ?? "";
    const imageRaw = imageTag
      ? attrFromHtml(imageTag, "src") || attrFromHtml(imageTag, "data-src") || attrFromHtml(imageTag, "data-original")
      : null;

    candidates.push({
      href: absoluteUrl(decodeHtmlEntities(href), pageUrl) ?? decodeHtmlEntities(href),
      text: stripTags(body),
      title: decodeHtmlEntities(attrFromHtml(attrs, "title") ?? attrFromHtml(attrs, "aria-label") ?? ""),
      className: decodeHtmlEntities(attrFromHtml(attrs, "class") ?? ""),
      imageUrl: imageRaw ? absoluteUrl(decodeHtmlEntities(imageRaw), pageUrl) : null
    });
  }

  return candidates;
}

async function readAllLinkCandidates(page: Page, pageUrl: string) {
  const domLinks = await readLinksFromPage(page).catch(() => []);
  const html = await page.content().catch(() => "");
  const htmlLinks = html ? readLinksFromHtml(html, pageUrl) : [];

  const byKey = new Map<string, LinkCandidate>();
  for (const candidate of [...domLinks, ...htmlLinks]) {
    const normalized = normalizeAbsoluteUrl(candidate.href, pageUrl);
    if (!normalized) continue;
    const previous = byKey.get(normalized);
    byKey.set(normalized, {
      href: normalized,
      text: previous?.text || candidate.text || "",
      title: previous?.title || candidate.title || "",
      className: previous?.className || candidate.className || "",
      imageUrl: previous?.imageUrl || absoluteUrl(candidate.imageUrl, pageUrl)
    });
  }

  return Array.from(byKey.values());
}

export async function discoverProductUrls(page: Page, sourceUrl: string) {
  const startUrl = normalizeAbsoluteUrl(sourceUrl) ?? normalizeUrl(sourceUrl);
  const pagesToVisit = new Set<string>([startUrl]);
  const visited = new Set<string>();
  const products = new Map<string, { url: string; imageUrl: string | null }>();

  while (pagesToVisit.size > 0 && visited.size < DISCOVER_MAX_PAGES) {
    const currentUrl = Array.from(pagesToVisit).find((candidate) => !visited.has(candidate));
    if (!currentUrl) break;
    visited.add(currentUrl);

    await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1800);

    const candidates = await readAllLinkCandidates(page, currentUrl);

    for (const candidate of candidates) {
      const normalized = normalizeAbsoluteUrl(candidate.href, currentUrl);
      if (!normalized) continue;
      const withNormalizedHref = { ...candidate, href: normalized, imageUrl: absoluteUrl(candidate.imageUrl, currentUrl) };

      if (looksLikePagination(withNormalizedHref, startUrl)) pagesToVisit.add(normalized);
      if (looksLikeProductLink(withNormalizedHref, currentUrl)) {
        products.set(normalized, { url: normalized, imageUrl: withNormalizedHref.imageUrl ?? null });
      }
    }

    if (SCRAPER_DEBUG) {
      console.log(`[TCG discovery] ${currentUrl}: ${products.size} produit(s), ${pagesToVisit.size} page(s) en file`);
    }
  }

  return Array.from(products.values());
}

export async function debugDiscoverTcgListing(sourceUrl: string) {
  const browser = await launchBrowser();
  try {
    const storageState = storageStateIfExists();
    const context = await browser.newContext(createContextOptions(storageState));
    const page = await context.newPage();
    const products = await discoverProductUrls(page, sourceUrl);
    await context.close();
    return products;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function notifyDiscord(message: string) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return;

  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: message.slice(0, 1900) })
    });
  } catch (error) {
    console.error("Discord webhook failed", error);
  }
}

function hasPriceChanged(previous: unknown, current: number | null) {
  if (current === null || current === undefined) return false;
  if (previous === null || previous === undefined) return false;
  const before = Number(previous);
  return Number.isFinite(before) && Math.abs(before - current) >= 0.01;
}

export async function runTcgScrape(options: RunOptions = {}) {
  const maxProducts = options.maxProducts ?? DEFAULT_MAX_PRODUCTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const shouldDiscover = options.discover ?? DISCOVER_FROM_WATCH_URLS;

  const run = await prisma.scrapeRun.create({
    data: { supplier: "tcgdistribution", status: "running" }
  });

  let browser: Browser | null = null;
  let success = 0;
  let failed = 0;
  let discovered = 0;

  try {
    browser = await launchBrowser();
    const storageState = storageStateIfExists();
    const context = await browser.newContext(createContextOptions(storageState));
    const page = await context.newPage();

    if (shouldDiscover) {
      const watchUrls = await prisma.supplierWatchUrl.findMany({
        where: { supplier: "tcgdistribution", active: true }
      });
      const listingUrls = watchUrls.filter((watch) => watch.type === "listing" || isProbablyTcgListingUrl(watch.url));

      for (const listing of listingUrls) {
        try {
          const discoveredProducts = await discoverProductUrls(page, listing.url);
          for (const discoveredProduct of discoveredProducts) {
            const existing = await prisma.supplierProduct.findUnique({ where: { url: discoveredProduct.url } });
            await prisma.supplierProduct.upsert({
              where: { url: discoveredProduct.url },
              update: { active: true, imageUrl: discoveredProduct.imageUrl ?? undefined },
              create: { supplier: "tcgdistribution", url: discoveredProduct.url, imageUrl: discoveredProduct.imageUrl }
            });
            if (!existing) discovered += 1;
          }
        } catch (error) {
          console.error(`Discovery failed for ${listing.url}`, error);
        }

        await sleep(delayMs);
      }
    }

    const productWatchUrls = await prisma.supplierWatchUrl.findMany({
      where: { supplier: "tcgdistribution", active: true, type: "product" }
    });

    for (const watched of productWatchUrls) {
      if (isProbablyTcgListingUrl(watched.url)) continue;
      await prisma.supplierProduct.upsert({
        where: { url: watched.url },
        update: { active: true },
        create: { supplier: "tcgdistribution", url: watched.url }
      });
    }

    const products = await prisma.supplierProduct.findMany({
      where: {
        supplier: "tcgdistribution",
        active: true,
        ...(options.productIds?.length ? { id: { in: options.productIds } } : {}),
        ...(options.onlyMissingPrices ? { latestPrice: null } : {})
      },
      orderBy: [{ lastSeenAt: "asc" }, { createdAt: "asc" }],
      take: maxProducts
    });

    await prisma.scrapeRun.update({ where: { id: run.id }, data: { total: products.length, discovered } });

    for (const product of products) {
      try {
        const extracted = await extractProduct(page, product.url);
        const changed = hasPriceChanged(product.latestPrice, extracted.price);

        await prisma.priceSnapshot.create({
          data: {
            productId: product.id,
            runId: run.id,
            name: extracted.name,
            price: extracted.price,
            priceText: extracted.priceText,
            imageUrl: extracted.imageUrl,
            stockStatus: extracted.stockStatus,
            stockText: extracted.stockText,
            httpStatus: extracted.httpStatus
          }
        });

        await prisma.supplierProduct.update({
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

        if (changed) {
          await notifyDiscord(
            `📈 Prix modifié chez TCG Distribution\n${extracted.name ?? product.url}\nAvant: ${product.latestPrice} €\nMaintenant: ${extracted.price} €\n${product.url}`
          );
        }

        success += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        await prisma.priceSnapshot.create({
          data: {
            productId: product.id,
            runId: run.id,
            error: message.slice(0, 1000)
          }
        });
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
        message: `${success} OK, ${failed} erreur(s), ${discovered} lien(s) produit découvert(s)`
      }
    });

    await context.close();
    return { runId: run.id, status, success, failed, discovered };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.scrapeRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        success,
        failed,
        discovered,
        finishedAt: new Date(),
        message: message.slice(0, 1000)
      }
    });
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
