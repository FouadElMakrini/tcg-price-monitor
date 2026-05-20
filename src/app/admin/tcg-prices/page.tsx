import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate, formatPrice } from "@/lib/format";
import { refreshCpcAction, refreshTcgAction } from "./actions";
import { SubmitButton } from "./_components";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [tcgCount, tcgWithPrice, cpcCount, cpcWithPrice, mappedCount, lastRuns, latestProducts] = await Promise.all([
    prisma.supplierProduct.count({ where: { active: true } }),
    prisma.supplierProduct.count({ where: { active: true, latestPrice: { not: null } } }),
    prisma.ownProduct.count({ where: { active: true } }),
    prisma.ownProduct.count({ where: { active: true, latestPrice: { not: null } } }),
    prisma.productMapping.count(),
    prisma.scrapeRun.findMany({ orderBy: { startedAt: "desc" }, take: 5 }),
    prisma.supplierProduct.findMany({ where: { active: true }, orderBy: { updatedAt: "desc" }, take: 8 })
  ]);

  return (
    <div className="stack">
      <section className="grid grid-4">
        <div className="card stat"><span>Produits TCGD</span><strong>{tcgCount}</strong><em>{tcgWithPrice} avec prix</em></div>
        <div className="card stat"><span>Produits CPC</span><strong>{cpcCount}</strong><em>{cpcWithPrice} avec prix</em></div>
        <div className="card stat"><span>Produits liés</span><strong>{mappedCount}</strong><em>comparatifs prêts</em></div>
        <div className="card stat"><span>Prix TCGD manquants</span><strong>{Math.max(0, tcgCount - tcgWithPrice)}</strong><em>à retenter</em></div>
      </section>

      <section className="card panel split-panel">
        <div>
          <h2>La méthode claire</h2>
          <ol className="steps">
            <li><strong>Importer TCGD</strong> : colle une catégorie entière, ex. page M4 ou cartes japonaises.</li>
            <li><strong>Importer CPC</strong> : colle ta collection Shopify correspondante.</li>
            <li><strong>Comparer</strong> : si le matching auto n’est pas bon, colle l’URL CPC à côté du produit TCGD.</li>
            <li><strong>Exporter CSV</strong> : récupère le tableau final avec évolution des prix.</li>
          </ol>
        </div>
        <div className="action-box">
          <Link className="button" href="/admin/tcg-prices/import">Importer une page</Link>
          <Link className="button secondary" href="/admin/tcg-prices/comparatif">Voir le comparatif</Link>
        </div>
      </section>

      <section className="card panel">
        <div className="section-head">
          <div>
            <h2>Refresh rapides</h2>
            <p className="subtitle">Ne réimporte pas les pages. Ça remet juste à jour les produits déjà connus.</p>
          </div>
          <div className="row-actions">
            <form action={refreshTcgAction}><SubmitButton pendingText="Refresh TCGD...">Refresh TCGD</SubmitButton></form>
            <form action={refreshCpcAction}><SubmitButton pendingText="Refresh CPC...">Refresh CPC</SubmitButton></form>
          </div>
        </div>
      </section>

      <section className="grid grid-2">
        <div className="card panel">
          <h2>Derniers produits TCGD</h2>
          <div className="mini-list">
            {latestProducts.length === 0 ? <p className="empty">Aucun produit importé.</p> : latestProducts.map((product) => (
              <div className="mini-item" key={product.id}>
                {product.imageUrl ? <img src={product.imageUrl} alt="" /> : <div className="thumb-placeholder" />}
                <div>
                  <strong>{product.name ?? product.url}</strong>
                  <span>{formatPrice(product.latestPrice)} · {formatDate(product.lastSeenAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card panel">
          <h2>Derniers imports / scans</h2>
          <div className="mini-list">
            {lastRuns.length === 0 ? <p className="empty">Aucun scan lancé.</p> : lastRuns.map((run) => (
              <div className="run-item" key={run.id}>
                <strong>{run.supplier} · {run.status}</strong>
                <span>{formatDate(run.startedAt)} · {run.success} OK · {run.failed} erreurs · {run.discovered} découverts</span>
                {run.message ? <small>{run.message}</small> : null}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
