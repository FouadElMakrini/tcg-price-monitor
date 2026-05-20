import Link from "next/link";

const navItems = [
  { href: "/admin/tcg-prices", label: "1. Résumé" },
  { href: "/admin/tcg-prices/import", label: "2. Importer" },
  { href: "/admin/tcg-prices/comparatif", label: "3. Comparatif" }
];

export default function TcgAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="page-shell">
      <section className="hero card">
        <div>
          <p className="eyebrow">Veille prix</p>
          <h1>TCGD × CartesPokemon.com</h1>
          <p className="subtitle">
            Workflow simple : importe une page TCGD, importe ou ajoute la page CPC correspondante,
            puis compare les prix et exporte le tableau.
          </p>
        </div>
        <nav className="admin-tabs" aria-label="Navigation veille prix">
          {navItems.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}
        </nav>
      </section>
      {children}
    </main>
  );
}
