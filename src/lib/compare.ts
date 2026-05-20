export type OwnProductLite = {
  id: string;
  url: string;
  name: string | null;
  sku: string | null;
  imageUrl: string | null;
  latestPrice: unknown;
  latestPriceText: string | null;
  latestStockStatus: string | null;
  lastSeenAt: Date | null;
};

export type SupplierProductLite = {
  id: string;
  url: string;
  name: string | null;
  sku: string | null;
  imageUrl: string | null;
  latestPrice: unknown;
  latestPriceText: string | null;
  previousPrice: unknown;
  latestStockStatus: string | null;
  lastSeenAt: Date | null;
};

export const CPC_SUPPLIER_FACTOR = Number(process.env.CPC_SUPPLIER_FACTOR ?? 0.88);
export const CPC_SUPPLIER_FACTOR_2000 = Number(process.env.CPC_SUPPLIER_FACTOR_2000 ?? 0.77);

const GENERIC_WORDS = new Set([
  "boite", "box", "display", "booster", "boosters", "case", "carton", "pokemon", "pokémon", "tcg", "trading", "card", "game",
  "cartes", "carte", "collectionner", "collection", "de", "du", "des", "la", "le", "les", "et", "avec", "sans",
  "sealed", "sous", "film", "neuf", "nouveau", "pack", "packs", "slim", "with", "wrap", "wrapping", "edition", "version",
  "japonais", "japanese", "japan", "jp", "francais", "francaise", "anglais", "chinois", "coreen", "coreenne", "korean", "simplified", "chinese"
]);

const FAMILY_ALIASES: Array<{ canonical: string; patterns: RegExp[] }> = [
  { canonical: "heatwave arena", patterns: [/\bheat\s*wave\b/i, /\bheatwave\b/i, /\barena\b/i] },
  { canonical: "battle partners", patterns: [/\bbattle\s+partners?\b/i] },
  { canonical: "rocket", patterns: [/\brocket\b/i, /\bteam\s+rocket\b/i, /\bglory\s+of\s+team\s+rocket\b/i] },
  { canonical: "terastal festival", patterns: [/\bterastal\b/i, /\bfestival\b/i] },
  { canonical: "super electric breaker", patterns: [/\bsuper\s+electric\b/i, /\belectric\s+breaker\b/i] },
  { canonical: "stellar miracle", patterns: [/\bstellar\s+miracle\b/i] },
  { canonical: "night wanderer", patterns: [/\bnight\s+wanderer\b/i] },
  { canonical: "mask of change", patterns: [/\bmask\s+of\s+change\b/i] },
  { canonical: "crimson haze", patterns: [/\bcrimson\s+haze\b/i] },
  { canonical: "wild force", patterns: [/\bwild\s+force\b/i] },
  { canonical: "cyber judge", patterns: [/\bcyber\s+judge\b/i] },
  { canonical: "shiny treasure", patterns: [/\bshiny\s+treasure\b/i] },
  { canonical: "raging surf", patterns: [/\braging\s+surf\b/i] },
  { canonical: "black flame", patterns: [/\bblack\s+flame\b/i, /\bruler\s+of\s+the\s+black\b/i] },
  { canonical: "snow hazard", patterns: [/\bsnow\s+hazard\b/i] },
  { canonical: "clay burst", patterns: [/\bclay\s+burst\b/i] },
  { canonical: "scarlet", patterns: [/\bscarlet\b/i, /\becarlate\b/i, /\bécarlate\b/i] },
  { canonical: "violet", patterns: [/\bviolet\b/i] },
  { canonical: "mega symphonia", patterns: [/\bmega\s+symphonia\b/i, /\bsymphonia\b/i] },
  { canonical: "mega brave", patterns: [/\bmega\s+brave\b/i, /\bbrave\b/i] },
  { canonical: "inferno x", patterns: [/\binferno\s*x\b/i] },
  { canonical: "munikis zero", patterns: [/\bmunikis\s+zero\b/i, /\bmega\s+genz?ero\b/i] },
  { canonical: "ninja spinner", patterns: [/\bninja\s+spinner\b/i] },
  { canonical: "tag team", patterns: [/\btag\s+team\b/i] }
];

export function numberValue(value: unknown) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function cpcSupplierPriceAtFactor(value: unknown, factor: number) {
  const number = numberValue(value);
  return number === null ? null : Number((number * factor).toFixed(2));
}

export function cpcSupplierPrice(value: unknown) {
  return cpcSupplierPriceAtFactor(value, CPC_SUPPLIER_FACTOR);
}

export function cpcSupplierPrice2000(value: unknown) {
  return cpcSupplierPriceAtFactor(value, CPC_SUPPLIER_FACTOR_2000);
}

export function normalizeCompareText(input: string | null | undefined) {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/heat\s*wave/g, "heatwave")
    .replace(/mega\s+genzero/g, "munikis zero")
    .replace(/ecarlate/g, "scarlet")
    .replace(/the\s+glory\s+of\s+team\s+rocket/g, "rocket")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceText(product: { name: string | null; sku: string | null; url: string }) {
  return `${product.name ?? ""} ${product.sku ?? ""} ${product.url}`;
}

function significantTokenSet(input: string | null | undefined) {
  const normalized = normalizeCompareText(input);
  const tokens = normalized
    .split(" ")
    .filter((token) => token.length >= 2)
    .filter((token) => !GENERIC_WORDS.has(token))
    .filter((token) => !/^(sv|m|op|opc|eb|prb|csv|cbb|sm)?\d+[a-z]?$/.test(token));
  return new Set(tokens);
}

export function extractCodes(input: string | null | undefined) {
  const raw = `${input ?? ""}`.toUpperCase().replace(/[_/]+/g, " ");
  const codes = new Set<string>();

  const addMatches = (regex: RegExp, formatter: (match: RegExpMatchArray) => string) => {
    for (const match of raw.matchAll(regex)) codes.add(formatter(match));
  };

  addMatches(/(^|[^A-Z0-9])(OPC)\s*-?\s*(\d{1,2})(?=$|[^A-Z0-9])/g, (m) => `OPC-${m[3].padStart(2, "0")}`);
  addMatches(/(^|[^A-Z0-9])(OP|EB|PRB)\s*-?\s*(\d{1,2})(?=$|[^A-Z0-9])/g, (m) => `${m[2]}-${m[3].padStart(2, "0")}`);
  addMatches(/(^|[^A-Z0-9])(SV\d{1,2}[A-Z]?)(?=$|[^A-Z0-9])/g, (m) => m[2]);
  addMatches(/(^|[^A-Z0-9])(M\d{1,2}[A-Z]?)(?=$|[^A-Z0-9])/g, (m) => m[2]);
  addMatches(/(^|[^A-Z0-9])(CSV\d{1,2}[A-Z]?)(?=$|[^A-Z0-9])/g, (m) => m[2]);
  addMatches(/(^|[^A-Z0-9])(CBB\d{1,2}[A-Z]?)(?=$|[^A-Z0-9])/g, (m) => m[2]);
  addMatches(/(^|[^A-Z0-9])(SM\d{1,2}[A-Z]?)(?=$|[^A-Z0-9])/g, (m) => m[2]);

  return codes;
}

function intersectCount<T>(left: Set<T>, right: Set<T>) {
  let count = 0;
  for (const item of left) if (right.has(item)) count += 1;
  return count;
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) return 0;
  const common = intersectCount(left, right);
  const union = new Set([...left, ...right]).size;
  return union > 0 ? common / union : 0;
}

function containment(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) return 0;
  const common = intersectCount(left, right);
  return common / Math.min(left.size, right.size);
}

export type ProductKind = "display" | "booster" | "promo" | "single" | "deck" | "case" | "etb" | "accessory" | "unknown";
export type ProductLanguage = "jp" | "fr" | "en" | "kr" | "cn" | "unknown";

export function productKind(input: string | null | undefined): ProductKind {
  const text = normalizeCompareText(input);
  if (/\b(carton|case)\b/.test(text)) return "case";
  if (/\b(etb|elite trainer box)\b/.test(text)) return "etb";
  if (/\b(deck|starter)\b/.test(text)) return "deck";
  if (/\b(accessoire|sleeve|toploader|classeur|binder)\b/.test(text)) return "accessory";
  if (/\b(promo|promos|sv p|pr)\b/.test(text) || /\b\d{1,3}\s*sv\s*p\b/.test(text)) return "promo";
  if (/\b(carte a l unite|carte unite|single|cardmarket)\b/.test(text)) return "single";
  if (/\b(display|boite\s+de\s+\d+\s+boosters?|box\s+pokemon|booster\s+box)\b/.test(text)) return "display";
  if (/\bbooster\b/.test(text)) return "booster";
  return "unknown";
}

export function productLanguage(input: string | null | undefined): ProductLanguage {
  const text = normalizeCompareText(input);
  // Coréen et chinois sont très importants: on ne veut pas qu'ils matchent une version FR/JP.
  if (/\b(coreen|coreenne|korean|kr|korea|koreenne|coréen|coréenne)\b/.test(text)) return "kr";
  if (/\b(chinois|chinoise|chinese|simplified|china|cn)\b/.test(text)) return "cn";
  if (/\b(japonais|japonaise|japanese|japan|jp|jpn)\b/.test(text)) return "jp";
  if (/\b(francais|francaise|french|version fr|francaises)\b/.test(text)) return "fr";
  if (/\b(anglais|anglaise|english|version anglaise|version uk|version us)\b/.test(text)) return "en";
  return "unknown";
}

function incompatibleKinds(left: ProductKind, right: ProductKind) {
  if (left === "unknown" || right === "unknown") return false;
  const hardGroups = [new Set(["promo", "single"]), new Set(["display", "case", "etb", "deck", "booster"]), new Set(["accessory"])] as const;
  for (const group of hardGroups) {
    if (group.has(left as never) && !group.has(right as never)) return true;
    if (group.has(right as never) && !group.has(left as never)) return true;
  }
  if ((left === "display" && right === "booster") || (left === "booster" && right === "display")) return true;
  if ((left === "case" && right !== "case") || (right === "case" && left !== "case")) return true;
  return false;
}

function familyAliases(input: string | null | undefined) {
  const normalized = normalizeCompareText(input);
  const found = new Set<string>();
  for (const alias of FAMILY_ALIASES) {
    if (alias.patterns.some((pattern) => pattern.test(normalized))) found.add(alias.canonical);
  }
  return found;
}

function incompatibleLanguages(left: ProductLanguage, right: ProductLanguage) {
  if (left !== "unknown" && right !== "unknown" && left !== right) return true;
  // Si une fiche est clairement coréenne/chinoise et l'autre ne l'est pas, on bloque.
  if ((left === "kr" && right !== "kr") || (right === "kr" && left !== "kr")) return true;
  if ((left === "cn" && right !== "cn") || (right === "cn" && left !== "cn")) return true;
  return false;
}

export function scoreMatch(product: SupplierProductLite, own: OwnProductLite) {
  const productText = sourceText(product);
  const ownText = sourceText(own);

  const productKindValue = productKind(productText);
  const ownKindValue = productKind(ownText);
  if (incompatibleKinds(productKindValue, ownKindValue)) return 0;

  const productLang = productLanguage(productText);
  const ownLang = productLanguage(ownText);
  if (incompatibleLanguages(productLang, ownLang)) return 0;

  const productCodes = extractCodes(productText);
  const ownCodes = extractCodes(ownText);
  const exactCodeMatches = intersectCount(productCodes, ownCodes);

  // SV9 et SV9A ne sont PAS le même produit.
  if (productCodes.size > 0 && ownCodes.size > 0 && exactCodeMatches === 0) return 0;

  const productFamilies = familyAliases(productText);
  const ownFamilies = familyAliases(ownText);
  const familyMatches = intersectCount(productFamilies, ownFamilies);

  if (productFamilies.size > 0 && ownFamilies.size > 0 && familyMatches === 0) return 0;

  const left = significantTokenSet(productText);
  const right = significantTokenSet(ownText);
  const commonTokens = intersectCount(left, right);
  const contain = containment(left, right);
  const jac = jaccard(left, right);

  let score = Math.round((contain * 0.58 + jac * 0.42) * 82);

  if (exactCodeMatches > 0) score += 34;
  if (familyMatches > 0) score += 26;
  if (productKindValue !== "unknown" && productKindValue === ownKindValue) score += 10;
  if (productLang !== "unknown" && productLang === ownLang) score += 10;
  if (commonTokens >= 3) score += 7;
  if (commonTokens >= 5) score += 5;

  // Une version JP/FR/EN connue face à une version inconnue ne doit pas matcher juste grâce au nom traduit.
  // Exception: code exact, utile pour M1S/M2/M3/M4.
  if (productLang !== "unknown" && ownLang === "unknown" && exactCodeMatches === 0) score = Math.min(score, 76);
  if (ownLang !== "unknown" && productLang === "unknown" && exactCodeMatches === 0) score = Math.min(score, 76);

  // Code exact sans vrai signal de nom: on reste prudent. Exemple: carte promo SV9A ≠ display SV9A.
  if (exactCodeMatches > 0 && familyMatches === 0 && commonTokens < 2) score = Math.min(score, 70);

  return Math.max(0, Math.min(99, score));
}

export function findBestOwnMatch(product: SupplierProductLite, ownProducts: OwnProductLite[], threshold = Number(process.env.AUTO_MATCH_THRESHOLD ?? 82)) {
  let best: { product: OwnProductLite; score: number } | null = null;

  for (const own of ownProducts) {
    const score = scoreMatch(product, own);
    if (!best || score > best.score) best = { product: own, score };
  }

  return best && best.score >= threshold ? best : null;
}

export function findOwnCandidates(product: SupplierProductLite, ownProducts: OwnProductLite[], minScore = 45, limit = 6) {
  return ownProducts
    .map((own) => ({ product: own, score: scoreMatch(product, own) }))
    .filter((candidate) => candidate.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function marginValues(tcgPriceRaw: unknown, cpcRetailPriceRaw: unknown) {
  const tcgPrice = numberValue(tcgPriceRaw);
  const cpcRetailPrice = numberValue(cpcRetailPriceRaw);
  const cpcPrice = cpcSupplierPrice(cpcRetailPriceRaw);
  const cpcPrice2000 = cpcSupplierPrice2000(cpcRetailPriceRaw);

  const diff = tcgPrice !== null && cpcPrice !== null ? cpcPrice - tcgPrice : null;
  const marginPercent = tcgPrice !== null && cpcPrice !== null && tcgPrice > 0 ? (diff! / tcgPrice) * 100 : null;
  const coefficient = tcgPrice !== null && cpcPrice !== null && tcgPrice > 0 ? cpcPrice / tcgPrice : null;

  const diff2000 = tcgPrice !== null && cpcPrice2000 !== null ? cpcPrice2000 - tcgPrice : null;
  const marginPercent2000 = tcgPrice !== null && cpcPrice2000 !== null && tcgPrice > 0 ? (diff2000! / tcgPrice) * 100 : null;
  const coefficient2000 = tcgPrice !== null && cpcPrice2000 !== null && tcgPrice > 0 ? cpcPrice2000 / tcgPrice : null;

  return { tcgPrice, cpcRetailPrice, cpcPrice, cpcPrice2000, diff, diff2000, marginPercent, marginPercent2000, coefficient, coefficient2000 };
}
