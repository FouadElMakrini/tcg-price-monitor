import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TCG Price Monitor",
  description: "Suivi automatique des prix fournisseur TCG Distribution"
};

const themeScript = `
(function () {
  try {
    var setting = localStorage.getItem('tcg-theme') || 'system';
    var resolved = setting === 'system'
      ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : setting;
    document.documentElement.dataset.themeSetting = setting;
    document.documentElement.dataset.theme = resolved;
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
  }
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
