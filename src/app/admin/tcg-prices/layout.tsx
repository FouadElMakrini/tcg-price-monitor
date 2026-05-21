import { BurgerMenu } from "./_components";

export default function TcgAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="page-shell">
      <header className="top-appbar card">
        <div>
          <p className="eyebrow">Veille prix</p>
          <h1>TCGD × CartesPokemon.com</h1>
        </div>
        <BurgerMenu />
      </header>
      {children}
    </main>
  );
}
