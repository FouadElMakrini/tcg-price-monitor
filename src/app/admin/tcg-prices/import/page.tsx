import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { autoMatchAction, importCpcAction, importTcgAction } from "../actions";
import { SubmitButton } from "../_components";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const [sources, runs] = await Promise.all([
    prisma.supplierWatchUrl.findMany({ where: { active: true }, orderBy: { updatedAt: "desc" }, take: 20 }),
    prisma.scrapeRun.findMany({ orderBy: { startedAt: "desc" }, take: 8 })
  ]);

  return (
    <div className="stack">
      <section className="card panel warning-panel">
        <div className="section-head">
          <div>
            <h2>Principe</h2>
            <p>
              Tu colles une page entière TCGD et une collection CPC. Après chaque import, l’app tente automatiquement
              de lier les produits par SKU/code et par nom.
            </p>
            <p className="subtitle">
              Les prix CPC sont ensuite utilisés en prix fournisseur avec le multiplicateur <strong>x0,88</strong>, et aussi en seuil gros achat <strong>x0,77</strong>.
              Pour TCGD, si le prix n’est visible qu’après connexion, lance d’abord <code>npm run login:tcg</code>.
            </p>
          </div>
          <form action={autoMatchAction} className="match-panel">
            <input name="threshold" type="number" min="40" max="95" defaultValue="82" />
            <SubmitButton pendingText="Match auto...">Relancer le match auto</SubmitButton>
          </form>
        </div>
      </section>

      <section className="grid grid-2">
        <form className="card panel form-card" action={importTcgAction}>
          <div>
            <p className="eyebrow">Source fournisseur</p>
            <h2>Importer une page TCGD</h2>
            <p className="subtitle">Exemple : une catégorie M4, Pokémon Japonais, One Piece, etc.</p>
          </div>
          <label>
            URL TCGD
            <input name="tcgUrl" placeholder="https://tcgdistribution.fr/cartes-a-collectionner-japonais/" required />
          </label>
          <label>
            Nombre max à importer maintenant
            <input name="max" type="number" min="1" max="2000" defaultValue="500" />
          </label>
          <SubmitButton pendingText="Import TCGD en cours...">Importer TCGD</SubmitButton>
        </form>

        <form className="card panel form-card" action={importCpcAction}>
          <div>
            <p className="eyebrow">Ton site Shopify</p>
            <h2>Importer une collection CPC</h2>
            <p className="subtitle">Exemple : display Pokémon, boosters, One Piece, etc.</p>
          </div>
          <label>
            URL CartesPokemon.com
            <input name="cpcUrl" placeholder="https://cartespokemon.com/fr-be/collections/display-cartes-pokemon" required />
          </label>
          <label>
            Nombre max à importer maintenant
            <input name="max" type="number" min="1" max="2000" defaultValue="500" />
          </label>
          <SubmitButton pendingText="Import CPC en cours...">Importer CPC</SubmitButton>
        </form>
      </section>

      <section className="card panel">
        <div className="section-head">
          <div>
            <h2>Après import</h2>
            <p className="subtitle">Va dans le comparatif. Les bons matchs seront déjà liés. Si un match est mauvais, retire le lien et colle l’URL CPC correcte.</p>
          </div>
          <Link className="button secondary" href="/admin/tcg-prices/comparatif">Ouvrir le comparatif</Link>
        </div>
      </section>

      <section className="grid grid-2">
        <div className="card panel">
          <h2>Pages déjà ajoutées</h2>
          <div className="source-list">
            {sources.length === 0 ? <p className="empty">Aucune source ajoutée.</p> : sources.map((source) => (
              <div className="source-item" key={source.id}>
                <span className={`pill ${source.supplier === "tcgdistribution" ? "pill-tcg" : "pill-cpc"}`}>{source.supplier === "tcgdistribution" ? "TCGD" : "CPC"}</span>
                <a href={source.url} target="_blank">{source.url}</a>
              </div>
            ))}
          </div>
        </div>
        <div className="card panel">
          <h2>Derniers résultats</h2>
          <div className="mini-list">
            {runs.length === 0 ? <p className="empty">Aucun import pour le moment.</p> : runs.map((run) => (
              <div className="run-item" key={run.id}>
                <strong>{run.supplier} · {run.status}</strong>
                <span>{formatDate(run.startedAt)} · {run.success}/{run.total} importés · {run.discovered} découverts</span>
                {run.message ? <small>{run.message}</small> : null}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
