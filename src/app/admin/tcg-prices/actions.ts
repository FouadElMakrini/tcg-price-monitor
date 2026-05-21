"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  addExternalSiteToTcgProduct,
  autoMatchProducts,
  cleanupUnsafeAutoMatches,
  importTcgPage,
  importCpcPage,
  linkCpcUrlToTcgProduct,
  probeFavoriteTcgStocks,
  probeTcgStockMax,
  refreshAllCpc,
  refreshAllTcg,
  refreshExternalSite,
  refreshOneTcgProduct,
  removeExternalSite,
  removeLink,
  setTcgFavorite,
  setTcgPackaging
} from "@/lib/scraper/simple";

const ROOT = "/admin/tcg-prices";

function revalidateAll() {
  revalidatePath(ROOT);
  revalidatePath(`${ROOT}/import`);
  revalidatePath(`${ROOT}/comparatif`);
}

function numberFromForm(value: FormDataEntryValue | null, fallback: number, max = 2000) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) && number > 0 ? Math.min(number, max) : fallback;
}

export async function importTcgAction(formData: FormData) {
  const url = String(formData.get("tcgUrl") ?? "").trim();
  const max = numberFromForm(formData.get("max"), 500);
  if (!url) return;
  await importTcgPage(url, max);
  revalidateAll();
  redirect(`${ROOT}/comparatif`);
}

export async function importCpcAction(formData: FormData) {
  const url = String(formData.get("cpcUrl") ?? "").trim();
  const max = numberFromForm(formData.get("max"), 500);
  if (!url) return;
  await importCpcPage(url, max);
  revalidateAll();
  redirect(`${ROOT}/comparatif`);
}

export async function refreshTcgAction() {
  await refreshAllTcg(Number(process.env.REFRESH_MAX_PRODUCTS ?? 700));
  await autoMatchProducts({ threshold: Number(process.env.AUTO_MATCH_THRESHOLD ?? 82), overwrite: false });
  revalidateAll();
}

export async function refreshCpcAction() {
  await refreshAllCpc(Number(process.env.REFRESH_MAX_PRODUCTS ?? 700));
  await autoMatchProducts({ threshold: Number(process.env.AUTO_MATCH_THRESHOLD ?? 82), overwrite: false });
  revalidateAll();
}

export async function autoMatchAction(formData?: FormData) {
  const threshold = Number(formData?.get("threshold") ?? process.env.AUTO_MATCH_THRESHOLD ?? 82);
  const overwrite = String(formData?.get("overwrite") ?? "") === "yes";
  await autoMatchProducts({ threshold: Number.isFinite(threshold) ? threshold : 82, overwrite });
  revalidateAll();
}

export async function cleanupAutoMatchesAction(formData?: FormData) {
  const threshold = Number(formData?.get("threshold") ?? process.env.AUTO_MATCH_THRESHOLD ?? 82);
  await cleanupUnsafeAutoMatches({ threshold: Number.isFinite(threshold) ? threshold : 82 });
  revalidateAll();
}

export async function refreshOneTcgAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await refreshOneTcgProduct(id);
  revalidateAll();
}

export async function linkCpcUrlAction(formData: FormData) {
  const tcgProductId = String(formData.get("tcgProductId") ?? "");
  const cpcUrl = String(formData.get("cpcUrl") ?? "").trim();
  if (!tcgProductId || !cpcUrl) return;
  await linkCpcUrlToTcgProduct(tcgProductId, cpcUrl);
  revalidateAll();
}

export async function removeLinkAction(formData: FormData) {
  const tcgProductId = String(formData.get("tcgProductId") ?? "");
  if (!tcgProductId) return;
  await removeLink(tcgProductId);
  revalidateAll();
}

export async function toggleFavoriteAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const value = String(formData.get("value") ?? "false") === "true";
  if (!id) return;
  await setTcgFavorite(id, value);
  revalidateAll();
}

export async function setPackagingAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const packagingMode = String(formData.get("packagingMode") ?? "unknown");
  if (!id) return;
  await setTcgPackaging(id, packagingMode);
  revalidateAll();
}

export async function probeOneStockAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const max = numberFromForm(formData.get("max"), Number(process.env.STOCK_PROBE_MAX ?? 1000), 5000);
  if (!id) return;
  await probeTcgStockMax(id, max);
  revalidateAll();
}

export async function probeFavoriteStocksAction(formData: FormData) {
  const max = numberFromForm(formData.get("max"), Number(process.env.STOCK_PROBE_MAX ?? 1000), 5000);
  await probeFavoriteTcgStocks(max, Number(process.env.STOCK_PROBE_FAVORITES_LIMIT ?? 40));
  revalidateAll();
}

export async function addExternalSiteAction(formData: FormData) {
  const tcgProductId = String(formData.get("tcgProductId") ?? "");
  const url = String(formData.get("externalUrl") ?? "").trim();
  if (!tcgProductId || !url) return;
  await addExternalSiteToTcgProduct(tcgProductId, url);
  revalidateAll();
}

export async function refreshExternalSiteAction(formData: FormData) {
  const id = String(formData.get("externalId") ?? "");
  if (!id) return;
  await refreshExternalSite(id);
  revalidateAll();
}

export async function removeExternalSiteAction(formData: FormData) {
  const id = String(formData.get("externalId") ?? "");
  if (!id) return;
  await removeExternalSite(id);
  revalidateAll();
}

export async function archiveTcgAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.supplierProduct.update({ where: { id }, data: { active: false } });
  await prisma.productMapping.deleteMany({ where: { supplierProductId: id } });
  revalidateAll();
}
