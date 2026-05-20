import { prisma } from "@/lib/db";
import { formatDate, formatPrice } from "@/lib/format";
import { CPC_SUPPLIER_FACTOR, CPC_SUPPLIER_FACTOR_2000, findOwnCandidates, marginValues } from "@/lib/compare";
import {
  archiveTcgAction,
  autoMatchAction,
  cleanupAutoMatchesAction,
  linkCpcUrlAction,
  refreshCpcAction,
  refreshOneTcgAction,
  refreshTcgAction,
  removeLinkAction,
  setPackagingAction,
  toggleFavoriteAction
} from "../actions";
import { SmallSubmitButton, SubmitButton } from "../_components";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ q?: string; only?: string; view?: string }>;

function toNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} %`;
}

function formatCoeff(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `x${value.toFixed(2)}`;
}

function evolution(currentRaw: unknown, previousRaw: unknown) {
  const current = toNumber(currentRaw);
  const previous = toNumber(previousRaw);
  if (current === null || previous === null) return "stable / nouveau";
  const diff = current - previous;
  if (Math.abs(diff) < 0.01) return "stable";
  return `${diff > 0 ? "+" : ""}${formatPrice(diff)}`;
}

function packagingLabel(value: string | null | undefined) {
  if (value === "shrink") return "Shrink";
  if (value === "no_shrink") return "No shrink";
  return "À définir";
}

export default async function ComparatifPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const only = params.only ?? "all";
  const view = params.view === "list" ? "list" : "grid";

  const where = {
    active: true,
    ...(q ? {
      OR: [
        { name: { contains: q } },
        { sku: { contains: q } },
        { url: { contains: q } }
      ]
    } : {})
  };

  const [products, ownProducts] = await Promise.all([
    prisma.supplierProduct.findMany({
      where,
      include: {
        mapping: {
          include: {
            ownProduct: {
              include: { snapshots: { orderBy: { scrapedAt: "desc" }, take: 3 } }
            }
          }
        },
        snapshots: { orderBy: { scrapedAt: "desc" }, take: 3 }
      },
      orderBy: [{ isFavorite: "desc" }, { updatedAt: "desc" }],
      take: 1200
    }),
    prisma.ownProduct.findMany({
      where: { active: true },
      orderBy: { updatedAt: "desc" },
      take: 2000
    })
  ]);

  const filtered = products.filter((product) => {
    if (only === "favorites") return product.isFavorite;
    if (only === "missingCpc") return !product.mapping;
    if (only === "missingTcgPrice") return product.latestPrice === null;
    if (only === "ready") return Boolean(product.mapping && product.latestPrice && product.mapping.ownProduct.latestPrice);
    if (only === "shrink") return product.packagingMode === "shrink";
    if (only === "no_shrink") return product.packagingMode === "no_shrink";
    return true;
  });

  const mappedCount = products.filter((product) => product.mapping).length;
  const favoritesCount = products.filter((product) => product.isFavorite).length;

  return (
    <div className="stack">
      <section className="card panel">
        <div className="section-head">
          <div>
            <h2>Comparatif direct</h2>
            <p className="subtitle">
              Matching plus prudent : l’app bloque maintenant les mélanges JP / FR / coréen / chinois quand l’info est visible. Les calculs affichent le prix CPC fournisseur en x{CPC_SUPPLIER_FACTOR.toFixed(2).replace(".", ",")} et aussi le seuil gros achat x{CPC_SUPPLIER_FACTOR_2000.toFixed(2).replace(".", ",")}.
            </p>
            <div className="small-metrics">
              <span>{products.length} TCGD</span>
              <span>{ownProducts.length} CPC importés</span>
              <span>{mappedCount} liés CPC</span>
              <span>{favoritesCount} favoris</span>
            </div>
          </div>
          <div className="row-actions">
            <form action={refreshTcgAction}><SubmitButton pendingText="Refresh TCGD...">Refresh TCGD</SubmitButton></form>
            <form action={refreshCpcAction}><SubmitButton pendingText="Refresh CPC...">Refresh CPC</SubmitButton></form>
            <form action={autoMatchAction} className="auto-match-form">
              <input name="threshold" type="hidden" value="82" />
              <SubmitButton pendingText="Match auto...">Match auto prudent</SubmitButton>
            </form>
            <form action={cleanupAutoMatchesAction} className="auto-match-form">
              <input name="threshold" type="hidden" value="82" />
              <SubmitButton pendingText="Nettoyage...">Nettoyer mauvais matchs</SubmitButton>
            </form>
            <a className="button secondary" href="/api/tcg/export-csv">Exporter CSV</a>
          </div>
        </div>
      </section>

      <section className="card panel filters">
        <form className="filter-form wide-filter">
          <input name="q" placeholder="Rechercher : M4, OP-15, display..." defaultValue={q} />
          <select name="only" defaultValue={only}>
            <option value="all">Tous les produits</option>
            <option value="favorites">Favoris en haut uniquement</option>
            <option value="missingCpc">Sans lien CPC</option>
            <option value="missingTcgPrice">Prix TCGD manquant</option>
            <option value="ready">Comparatifs prêts</option>
            <option value="shrink">Shrink</option>
            <option value="no_shrink">No shrink</option>
          </select>
          <select name="view" defaultValue={view}>
            <option value="grid">Vue grille</option>
            <option value="list">Vue liste</option>
          </select>
          <button className="button secondary" type="submit">Filtrer</button>
        </form>
      </section>

      <section className={view === "grid" ? "comparison-grid" : "comparison-list"}>
        {filtered.length === 0 ? <div className="card panel empty">Aucun produit à afficher. Commence par importer une page TCGD.</div> : null}
        {filtered.map((product) => {
          const own = product.mapping?.ownProduct ?? null;
          const values = marginValues(product.latestPrice, own?.latestPrice);
          const matchScore = product.mapping?.matchScore ?? null;
          const candidates = own ? [] : findOwnCandidates(product, ownProducts, 45, 8);

          return (
            <article className={`card ${view === "grid" ? "compare-grid-card" : "compare-row"} ${product.isFavorite ? "favorite-row" : ""}`} key={product.id}>
              <div className="product-side">
                {product.imageUrl ? <img className="product-img" src={product.imageUrl} alt="" /> : <div className="product-img placeholder" />}
                <div className="product-main">
                  <div className="label-row">
                    <span className="pill pill-tcg">TCGD</span>
                    {product.isFavorite ? <span className="favorite-badge">★ Favori</span> : null}
                    <span className="packaging-badge">{packagingLabel(product.packagingMode)}</span>
                    {product.sku ? <span className="sku">{product.sku}</span> : null}
                  </div>
                  <h3>{product.name ?? product.url}</h3>
                  <a href={product.url} target="_blank">ouvrir TCGD</a>
                  <div className="price-line"><strong>{formatPrice(product.latestPrice)}</strong><span>{product.latestStockStatus ?? "stock ?"}</span><span>{formatDate(product.lastSeenAt)}</span></div>
                  <div className="history-line">Évolution TCGD : {evolution(product.latestPrice, product.previousPrice)}</div>
                  <div className="row-actions compact-actions">
                    <form action={refreshOneTcgAction} className="inline-form">
                      <input name="id" type="hidden" value={product.id} />
                      <SmallSubmitButton pendingText="Refresh...">Refresh</SmallSubmitButton>
                    </form>
                    <form action={toggleFavoriteAction} className="inline-form">
                      <input name="id" type="hidden" value={product.id} />
                      <input name="value" type="hidden" value={String(!product.isFavorite)} />
                      <SmallSubmitButton pendingText="...">{product.isFavorite ? "Retirer favori" : "Mettre favori"}</SmallSubmitButton>
                    </form>
                  </div>
                  <form action={setPackagingAction} className="packaging-form">
                    <input name="id" type="hidden" value={product.id} />
                    <select name="packagingMode" defaultValue={product.packagingMode ?? "unknown"}>
                      <option value="unknown">Shrink / no shrink : à définir</option>
                      <option value="shrink">Shrink</option>
                      <option value="no_shrink">No shrink</option>
                    </select>
                    <SmallSubmitButton pendingText="OK...">OK</SmallSubmitButton>
                  </form>
                </div>
              </div>

              <div className="link-side">
                {own ? (
                  <div className="linked-product">
                    {own.imageUrl ? <img className="small-img" src={own.imageUrl} alt="" /> : <div className="small-img placeholder" />}
                    <div>
                      <div className="label-row">
                        <span className="pill pill-cpc">CPC</span>
                        {matchScore !== null ? <span className="match-score">match {matchScore}%</span> : null}
                        {own.sku ? <span className="sku">{own.sku}</span> : null}
                      </div>
                      <strong>{own.name ?? own.url}</strong>
                      <a href={own.url} target="_blank">ouvrir CPC</a>
                      <div className="price-two-lines">
                        <div><span>Prix site</span><strong>{formatPrice(own.latestPrice)}</strong></div>
                        <div><span>x{CPC_SUPPLIER_FACTOR.toFixed(2)}</span><strong>{formatPrice(values.cpcPrice)}</strong></div>
                        <div><span>+2000€ x{CPC_SUPPLIER_FACTOR_2000.toFixed(2)}</span><strong>{formatPrice(values.cpcPrice2000)}</strong></div>
                      </div>
                      <div className="history-line">{own.latestStockStatus ?? "stock ?"} · {formatDate(own.lastSeenAt)}</div>
                      <form action={removeLinkAction} className="inline-form">
                        <input name="tcgProductId" type="hidden" value={product.id} />
                        <SmallSubmitButton pendingText="Suppression...">Retirer le lien</SmallSubmitButton>
                      </form>
                    </div>
                  </div>
                ) : (
                  <div className="map-block">
                    <form action={linkCpcUrlAction} className="map-form">
                      <input name="tcgProductId" type="hidden" value={product.id} />
                      <label>
                        Aucun match CPC. Coller l’URL CPC si besoin.
                        <input name="cpcUrl" placeholder="https://cartespokemon.com/fr-be/products/..." required />
                      </label>
                      <SmallSubmitButton pendingText="Import + lien...">Importer et lier CPC</SmallSubmitButton>
                    </form>
                    {candidates.length > 0 ? (
                      <div className="candidate-list">
                        <strong>Candidats possibles</strong>
                        {candidates.map((candidate) => (
                          <form action={linkCpcUrlAction} className="candidate-item" key={candidate.product.id}>
                            <input name="tcgProductId" type="hidden" value={product.id} />
                            <input name="cpcUrl" type="hidden" value={candidate.product.url} />
                            {candidate.product.imageUrl ? <img src={candidate.product.imageUrl} alt="" /> : <span className="mini-placeholder" />}
                            <span>{candidate.score}% · {candidate.product.name ?? candidate.product.url}</span>
                            <SmallSubmitButton pendingText="Lien...">Lier</SmallSubmitButton>
                          </form>
                        ))}
                      </div>
                    ) : <p className="history-line">Aucun candidat CPC fiable. Importe plus de pages CPC ou colle l’URL.</p>}
                  </div>
                )}
              </div>

              <div className="result-side">
                <div className="result-kpi"><span>CPC fournisseur x{CPC_SUPPLIER_FACTOR.toFixed(2)}</span><strong>{formatPrice(values.cpcPrice)}</strong></div>
                <div className="result-kpi"><span>CPC +2000€ x{CPC_SUPPLIER_FACTOR_2000.toFixed(2)}</span><strong>{formatPrice(values.cpcPrice2000)}</strong></div>
                <div className="result-kpi"><span>Écart x{CPC_SUPPLIER_FACTOR.toFixed(2)}</span><strong>{formatPrice(values.diff)}</strong></div>
                <div className="result-kpi"><span>Marge x{CPC_SUPPLIER_FACTOR.toFixed(2)}</span><strong>{formatPercent(values.marginPercent)}</strong></div>
                <div className="result-kpi"><span>Coef x{CPC_SUPPLIER_FACTOR.toFixed(2)}</span><strong>{formatCoeff(values.coefficient)}</strong></div>
                <div className="result-kpi soft"><span>Écart +2000€</span><strong>{formatPrice(values.diff2000)}</strong></div>
                <div className="result-kpi soft"><span>Marge +2000€</span><strong>{formatPercent(values.marginPercent2000)}</strong></div>
                <div className="history-line">TCGD hist. : {product.snapshots.map((snap) => formatPrice(snap.price)).join(" → ") || "—"}</div>
                {own ? <div className="history-line">CPC hist. : {own.snapshots.map((snap) => formatPrice(snap.price)).join(" → ") || "—"}</div> : null}
                <form action={archiveTcgAction} className="inline-form archive-form">
                  <input name="id" type="hidden" value={product.id} />
                  <SmallSubmitButton pendingText="Archive...">Archiver</SmallSubmitButton>
                </form>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
