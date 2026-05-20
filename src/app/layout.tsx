import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TCG Price Monitor",
  description: "Suivi automatique des prix fournisseur TCG Distribution"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
