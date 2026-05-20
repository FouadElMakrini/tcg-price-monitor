export function formatPrice(value: unknown) {
  if (value === null || value === undefined) return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2
  }).format(number);
}

export function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

export function priceDelta(current: unknown, previous: unknown) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
  const diff = c - p;
  const percent = (diff / p) * 100;
  return { diff, percent };
}

export function normalizeUrl(input: string) {
  const trimmed = input.trim();
  const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}
