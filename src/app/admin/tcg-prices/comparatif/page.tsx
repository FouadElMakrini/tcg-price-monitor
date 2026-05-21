import { prisma } from "@/lib/db";
import { formatDate, formatPrice } from "@/lib/format";
import { CPC_SUPPLIER_FACTOR, CPC_SUPPLIER_FACTOR_2000, findOwnCandidates, marginValues } from "@/lib/compare";
import {
  addExternalSiteAction,
  archiveTcgAction,
  autoMatchAction,
  cleanupAutoMatchesAction,
  linkCpcUrlAction,
  probeFavoriteStocksAction,
  probeOneStockAction,
  refreshCpcAction,
  refreshExternalSiteAction,
  refreshOneTcgAction,
  refreshTcgAction,
  removeExternalSiteAction,
  removeLinkAction,
  setPackagingAction,
  toggleFavoriteAction
} from "../actions";
import { SecretMorpion, SecretSnake, SmallSubmitButton, SubmitButton } from "../_components";

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
  const showSecret = q.toUpperCase() === "XOXO";
  const showSnake = q.toLowerCase() === "snake";

  const where = {
    active: true,
    ...(q && !showSecret && !showSnake ? {
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
        externalProducts: { include: { snapshots: { orderBy: { scrapedAt: "desc" }, take: 2 } }, orderBy: { updatedAt: "desc" } },
        snapshots: { orderBy: { scrapedAt: "desc" }, take: 3 }
      },
      orderBy: [{ isFavorite: "desc" }, { updatedAt: "desc" }],
      take: 1200
    }),
    prisma.ownProduct.findMany({ where: { active: true }, orderBy: { updatedAt: "desc" }, take: 2000 })
  ]);

  const filtered = products.filter((product) => {
    if (only === "favorites") return product.isFavorite;
    if (only === "missingCpc") return !product.mapping;
    if (only === "missingTcgPrice") return product.latestPrice === null;
    if (only === "ready") return Boolean(product.mapping && product.latestPrice && product.mapping.ownProduct.latestPrice);
    if (only === "shrink") return product.packagingMode === "shrink";
    if (only === "no_shrink") return product.packagingMode === "no_shrink";
    if (only === "stockProbe") return product.stockProbeMax !== null;
    return true;
  });

  const mappedCount = products.filter((product) => product.mapping).length;
  const favoritesCount = products.filter((product) => product.isFavorite).length;

  return (
    <div className="stack">
      {showSecret ? <SecretMorpion /> : null}
      {showSnake ? <SecretSnake /> : null}

      <section className="toolbar-card card panel">
        <div>
          <h2>Comparatif</h2>
          <div className="small-metrics">
            <span>{products.length} TCGD</span>
            <span>{ownProducts.length} CPC</span>
            <span>{mappedCount} liés</span>
            <span>{favoritesCount} favoris</span>
          </div>
        </div>
        <div className="row-actions toolbar-actions">
          <form action={refreshTcgAction}><SubmitButton pendingText="TCGD...">Refresh TCGD</SubmitButton></form>
          <form action={refreshCpcAction}><SubmitButton pendingText="CPC...">Refresh CPC</SubmitButton></form>
          <form action={autoMatchAction}><input name="threshold" type="hidden" value="82" /><SubmitButton pendingText="Match...">Match auto</SubmitButton></form>
          <form action={cleanupAutoMatchesAction}><input name="threshold" type="hidden" value="82" /><SubmitButton pendingText="Nettoyage...">Nettoyer matchs</SubmitButton></form>
          <form action={probeFavoriteStocksAction} className="probe-favorites-form"><input name="max" type="hidden" value="1000" /><SubmitButton pendingText="Stock...">Stock favoris</SubmitButton></form>
          <a className="button secondary" href="/api/tcg/export-csv">CSV</a>
        </div>
      </section>

      <section className="card panel filters compact-filter-card">
        <form className="filter-form wide-filter">
          <input name="q" placeholder="Rechercher : M4, OP-15, display..." defaultValue={q} />
          <select name="only" defaultValue={only}>
            <option value="all">Tous</option>
            <option value="ready">Comparatifs prêts</option>
            <option value="favorites">Favoris</option>
            <option value="missingCpc">Sans lien CPC</option>
            <option value="missingTcgPrice">Prix TCGD manquant</option>
            <option value="stockProbe">Stock max connu</option>
            <option value="shrink">Shrink</option>
            <option value="no_shrink">No shrink</option>
          </select>
          <select name="view" defaultValue={view}>
            <option value="grid">Grille</option>
            <option value="list">Liste</option>
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
            <article className={`card compare-card ${view === "list" ? "compare-row" : ""} ${product.isFavorite ? "favorite-row" : ""}`} key={product.id}>
              <div className="compare-main">
                <div className="product-side">
                  {product.imageUrl ? <img className="product-img" src={product.imageUrl} alt="" /> : <div className="product-img placeholder" />}
                  <div className="product-main">
                    <div className="label-row">
                      <span className="pill pill-tcg">TCGD</span>
                      {product.isFavorite ? <span className="favorite-badge">★</span> : null}
                      <span className="packaging-badge">{packagingLabel(product.packagingMode)}</span>
                      {product.sku ? <span className="sku">{product.sku}</span> : null}
                    </div>
                    <h3>{product.name ?? product.url}</h3>
                    <a href={product.url} target="_blank">ouvrir TCGD</a>
                    <div className="price-line"><strong>{formatPrice(product.latestPrice)}</strong><span>{product.latestStockStatus ?? "stock ?"}</span><span>{formatDate(product.lastSeenAt)}</span></div>
                    <div className="stock-probe-line">
                      <strong>Stock max :</strong> {product.stockProbeMax ?? "—"}
                      {product.stockProbeCheckedAt ? <span> · {formatDate(product.stockProbeCheckedAt)}</span> : null}
                    </div>
                    {product.stockProbeNote ? <details className="mini-details"><summary>note stock</summary><p>{product.stockProbeNote}</p></details> : null}
                    <div className="row-actions compact-actions">
                      <form action={refreshOneTcgAction} className="inline-form"><input name="id" type="hidden" value={product.id} /><SmallSubmitButton pendingText="...">Refresh</SmallSubmitButton></form>
                      <form action={probeOneStockAction} className="inline-form"><input name="id" type="hidden" value={product.id} /><input name="max" type="hidden" value="1000" /><SmallSubmitButton pendingText="...">Stock</SmallSubmitButton></form>
                      <form action={toggleFavoriteAction} className="inline-form"><input name="id" type="hidden" value={product.id} /><input name="value" type="hidden" value={String(!product.isFavorite)} /><SmallSubmitButton pendingText="...">{product.isFavorite ? "★ off" : "★ favori"}</SmallSubmitButton></form>
                    </div>
                    <form action={setPackagingAction} className="packaging-form">
                      <input name="id" type="hidden" value={product.id} />
                      <select name="packagingMode" defaultValue={product.packagingMode ?? "unknown"}>
                        <option value="unknown">Shrink : à définir</option>
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
                        <div className="label-row"><span className="pill pill-cpc">CPC</span>{matchScore !== null ? <span className="match-score">{matchScore}%</span> : null}{own.sku ? <span className="sku">{own.sku}</span> : null}</div>
                        <strong>{own.name ?? own.url}</strong>
                        <a href={own.url} target="_blank">ouvrir CPC</a>
                        <div className="price-two-lines compact-prices">
                          <div><span>Site</span><strong>{formatPrice(own.latestPrice)}</strong></div>
                          <div><span>x{CPC_SUPPLIER_FACTOR.toFixed(2)}</span><strong>{formatPrice(values.cpcPrice)}</strong></div>
                          <div><span>x{CPC_SUPPLIER_FACTOR_2000.toFixed(2)}</span><strong>{formatPrice(values.cpcPrice2000)}</strong></div>
                        </div>
                        <form action={removeLinkAction} className="inline-form"><input name="tcgProductId" type="hidden" value={product.id} /><SmallSubmitButton pendingText="...">Retirer</SmallSubmitButton></form>
                      </div>
                    </div>
                  ) : (
                    <div className="map-block">
                      <form action={linkCpcUrlAction} className="map-form">
                        <input name="tcgProductId" type="hidden" value={product.id} />
                        <input name="cpcUrl" placeholder="URL CPC à lier" required />
                        <SmallSubmitButton pendingText="Lien...">Lier CPC</SmallSubmitButton>
                      </form>
                      {candidates.length > 0 ? (
                        <details className="candidate-list" open={view === "list"}>
                          <summary>Candidats CPC possibles</summary>
                          {candidates.map((candidate) => (
                            <form action={linkCpcUrlAction} className="candidate-item" key={candidate.product.id}>
                              <input name="tcgProductId" type="hidden" value={product.id} />
                              <input name="cpcUrl" type="hidden" value={candidate.product.url} />
                              {candidate.product.imageUrl ? <img src={candidate.product.imageUrl} alt="" /> : <span className="mini-placeholder" />}
                              <span>{candidate.score}% · {candidate.product.name ?? candidate.product.url}</span>
                              <SmallSubmitButton pendingText="...">Lier</SmallSubmitButton>
                            </form>
                          ))}
                        </details>
                      ) : <p className="history-line">Aucun candidat fiable.</p>}
                    </div>
                  )}
                </div>
              </div>

              <div className="result-side compact-result-side">
                <div className="result-grid-mini">
                  <div><span>CPC x0.88</span><strong>{formatPrice(values.cpcPrice)}</strong></div>
                  <div><span>CPC x0.77</span><strong>{formatPrice(values.cpcPrice2000)}</strong></div>
                  <div><span>Écart 0.88</span><strong>{formatPrice(values.diff)}</strong></div>
                  <div><span>Marge 0.88</span><strong>{formatPercent(values.marginPercent)}</strong></div>
                  <div><span>Coef 0.88</span><strong>{formatCoeff(values.coefficient)}</strong></div>
                  <div><span>Écart 0.77</span><strong>{formatPrice(values.diff2000)}</strong></div>
                </div>
                <details className="mini-details"><summary>Historique prix</summary><p>TCGD : {product.snapshots.map((snap) => formatPrice(snap.price)).join(" → ") || "—"}</p>{own ? <p>CPC : {own.snapshots.map((snap) => formatPrice(snap.price)).join(" → ") || "—"}</p> : null}</details>
                <details className="mini-details external-sites">
                  <summary>Autres sites ({product.externalProducts.length})</summary>
                  <form action={addExternalSiteAction} className="external-form">
                    <input name="tcgProductId" type="hidden" value={product.id} />
                    <input name="externalUrl" placeholder="URL Hikaru / autre site" />
                    <SmallSubmitButton pendingText="...">Ajouter</SmallSubmitButton>
                  </form>
                  <div className="external-list">
                    {product.externalProducts.map((external) => (
                      <div className="external-item" key={external.id}>
                        {external.imageUrl ? <img src={external.imageUrl} alt="" /> : null}
                        <div><strong>{external.siteName}</strong><a href={external.url} target="_blank">{formatPrice(external.latestPrice)} · {external.latestStockStatus ?? "stock ?"}</a></div>
                        <form action={refreshExternalSiteAction}><input name="externalId" type="hidden" value={external.id} /><SmallSubmitButton pendingText="...">↻</SmallSubmitButton></form>
                        <form action={removeExternalSiteAction}><input name="externalId" type="hidden" value={external.id} /><SmallSubmitButton pendingText="...">×</SmallSubmitButton></form>
                      </div>
                    ))}
                  </div>
                </details>
                <form action={archiveTcgAction} className="inline-form archive-form"><input name="id" type="hidden" value={product.id} /><SmallSubmitButton pendingText="Archive...">Archiver</SmallSubmitButton></form>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
