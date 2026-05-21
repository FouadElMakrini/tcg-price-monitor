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
      <section className="card panel import-hero">
        <div>
          <p className="eyebrow">Import en masse</p>
          <h2>Colle une page entière, l’app importe tout.</h2>
        </div>
        <form action={autoMatchAction} className="match-panel compact-match-panel">
          <input name="threshold" type="number" min="40" max="95" defaultValue="82" />
          <SubmitButton pendingText="Match...">Relancer match auto</SubmitButton>
        </form>
      </section>

      <section className="grid grid-2">
        <form className="card panel form-card" action={importTcgAction}>
          <div><p className="eyebrow">Fournisseur</p><h2>Importer TCGD</h2></div>
          <label>URL TCGD<input name="tcgUrl" placeholder="https://tcgdistribution.fr/cartes-a-collectionner-japonais/" required /></label>
          <label>Max produits<input name="max" type="number" min="1" max="2000" defaultValue="500" /></label>
          <SubmitButton pendingText="Import TCGD...">Importer TCGD</SubmitButton>
        </form>

        <form className="card panel form-card" action={importCpcAction}>
          <div><p className="eyebrow">Ton site</p><h2>Importer CPC</h2></div>
          <label>URL CartesPokemon.com<input name="cpcUrl" placeholder="https://cartespokemon.com/fr-be/collections/display-cartes-pokemon" required /></label>
          <label>Max produits<input name="max" type="number" min="1" max="2000" defaultValue="500" /></label>
          <SubmitButton pendingText="Import CPC...">Importer CPC</SubmitButton>
        </form>
      </section>

      <section className="card panel"><div className="section-head"><h2>Après import</h2><Link className="button secondary" href="/admin/tcg-prices/comparatif">Ouvrir le comparatif</Link></div></section>

      <section className="grid grid-2">
        <div className="card panel">
          <h2>Pages ajoutées</h2>
          <div className="source-list">{sources.length === 0 ? <p className="empty">Aucune source.</p> : sources.map((source) => <div className="source-item" key={source.id}><span className={`pill ${source.supplier === "tcgdistribution" ? "pill-tcg" : "pill-cpc"}`}>{source.supplier === "tcgdistribution" ? "TCGD" : "CPC"}</span><a href={source.url} target="_blank">{source.url}</a></div>)}</div>
        </div>
        <div className="card panel">
          <h2>Derniers résultats</h2>
          <div className="mini-list">{runs.length === 0 ? <p className="empty">Aucun import.</p> : runs.map((run) => <div className="run-item" key={run.id}><strong>{run.supplier} · {run.status}</strong><span>{formatDate(run.startedAt)} · {run.success}/{run.total} importés · {run.discovered} découverts</span>{run.message ? <small>{run.message}</small> : null}</div>)}</div>
        </div>
      </section>
    </div>
  );
}
