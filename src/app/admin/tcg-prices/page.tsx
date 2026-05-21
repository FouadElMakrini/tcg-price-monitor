import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate, formatPrice } from "@/lib/format";
import { CPC_SUPPLIER_FACTOR, CPC_SUPPLIER_FACTOR_2000, marginValues } from "@/lib/compare";
import { probeFavoriteStocksAction, refreshCpcAction, refreshTcgAction } from "./actions";
import { SubmitButton } from "./_components";

export const dynamic = "force-dynamic";

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} %`;
}

export default async function DashboardPage() {
  const [tcgCount, cpcCount, mappedProducts, lastRuns] = await Promise.all([
    prisma.supplierProduct.count({ where: { active: true } }),
    prisma.ownProduct.count({ where: { active: true } }),
    prisma.supplierProduct.findMany({
      where: { active: true, mapping: { isNot: null } },
      include: { mapping: { include: { ownProduct: true } } },
      orderBy: [{ isFavorite: "desc" }, { updatedAt: "desc" }],
      take: 2000
    }),
    prisma.scrapeRun.findMany({ orderBy: { startedAt: "desc" }, take: 5 })
  ]);

  const ready = mappedProducts
    .map((product) => ({ product, own: product.mapping?.ownProduct ?? null, values: marginValues(product.latestPrice, product.mapping?.ownProduct.latestPrice) }))
    .filter((row) => row.values.tcgPrice !== null && row.values.cpcPrice !== null);

  const avgMargin = average(ready.map((row) => row.values.marginPercent ?? 0));
  const avgMargin2000 = average(ready.map((row) => row.values.marginPercent2000 ?? 0));
  const avgDiff = average(ready.map((row) => row.values.diff ?? 0));
  const tcgdCheaper = ready.filter((row) => (row.values.diff ?? 0) > 0).sort((a, b) => (b.values.diff ?? 0) - (a.values.diff ?? 0)).slice(0, 8);
  const cpcCheaper = ready.filter((row) => (row.values.diff ?? 0) < 0).sort((a, b) => (a.values.diff ?? 0) - (b.values.diff ?? 0)).slice(0, 8);

  return (
    <div className="stack">
      <section className="grid grid-4 summary-kpis">
        <div className="card stat"><span>TCGD</span><strong>{tcgCount}</strong><em>produits suivis</em></div>
        <div className="card stat"><span>CPC</span><strong>{cpcCount}</strong><em>produits importés</em></div>
        <div className="card stat"><span>Comparatifs</span><strong>{ready.length}</strong><em>avec deux prix</em></div>
        <div className="card stat"><span>Marge moyenne x{CPC_SUPPLIER_FACTOR.toFixed(2)}</span><strong>{formatPercent(avgMargin)}</strong><em>x{CPC_SUPPLIER_FACTOR_2000.toFixed(2)} : {formatPercent(avgMargin2000)}</em></div>
      </section>

      <section className="card panel summary-global">
        <div>
          <p className="eyebrow">Comparatif global</p>
          <h2>{avgDiff === null ? "Pas encore assez de données" : avgDiff >= 0 ? "En moyenne TCGD est moins cher" : "En moyenne CPC est moins cher"}</h2>
          <p className="subtitle">Écart moyen CPC fournisseur x{CPC_SUPPLIER_FACTOR.toFixed(2)} vs TCGD : <strong>{formatPrice(avgDiff)}</strong>.</p>
        </div>
        <div className="row-actions">
          <Link className="button" href="/admin/tcg-prices/import">Importer</Link>
          <Link className="button secondary" href="/admin/tcg-prices/comparatif">Comparatif</Link>
          <form action={refreshTcgAction}><SubmitButton pendingText="TCGD...">Refresh TCGD</SubmitButton></form>
          <form action={refreshCpcAction}><SubmitButton pendingText="CPC...">Refresh CPC</SubmitButton></form>
          <form action={probeFavoriteStocksAction}><input name="max" type="hidden" value="1000" /><SubmitButton pendingText="Stock...">Stock favoris</SubmitButton></form>
        </div>
      </section>

      <section className="grid grid-2">
        <div className="card panel">
          <h2>Top TCGD moins cher que CPC</h2>
          <p className="subtitle">À prioriser chez TCGD si stock OK.</p>
          <div className="mini-list top-list">
            {tcgdCheaper.length === 0 ? <p className="empty">Aucun avantage TCGD détecté.</p> : tcgdCheaper.map(({ product, values }) => (
              <Link className="mini-item" href={`/admin/tcg-prices/comparatif?q=${encodeURIComponent(product.sku ?? product.name ?? "")}`} key={product.id}>
                {product.imageUrl ? <img src={product.imageUrl} alt="" /> : <div className="thumb-placeholder" />}
                <div><strong>{product.name}</strong><span>TCGD {formatPrice(values.tcgPrice)} · CPC x0.88 {formatPrice(values.cpcPrice)} · écart {formatPrice(values.diff)}</span></div>
              </Link>
            ))}
          </div>
        </div>

        <div className="card panel">
          <h2>Top CPC moins cher que TCGD</h2>
          <p className="subtitle">À acheter plutôt chez CPC / ton fournisseur.</p>
          <div className="mini-list top-list">
            {cpcCheaper.length === 0 ? <p className="empty">Aucun avantage CPC détecté.</p> : cpcCheaper.map(({ product, own, values }) => (
              <Link className="mini-item" href={`/admin/tcg-prices/comparatif?q=${encodeURIComponent(product.sku ?? product.name ?? "")}`} key={product.id}>
                {(own?.imageUrl ?? product.imageUrl) ? <img src={own?.imageUrl ?? product.imageUrl ?? ""} alt="" /> : <div className="thumb-placeholder" />}
                <div><strong>{product.name}</strong><span>TCGD {formatPrice(values.tcgPrice)} · CPC x0.88 {formatPrice(values.cpcPrice)} · écart {formatPrice(values.diff)}</span></div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="card panel">
        <h2>Derniers imports / scans</h2>
        <div className="mini-list run-grid">
          {lastRuns.length === 0 ? <p className="empty">Aucun scan lancé.</p> : lastRuns.map((run) => (
            <div className="run-item" key={run.id}>
              <strong>{run.supplier} · {run.status}</strong>
              <span>{formatDate(run.startedAt)} · {run.success} OK · {run.failed} erreurs · {run.discovered} découverts</span>
              {run.message ? <small>{run.message}</small> : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
