# TCG Price Monitor

App Next.js pour suivre régulièrement les prix visibles sur `https://tcgdistribution.fr` avec ta propre session client.

L'app fait 4 choses :

1. tu ajoutes des fiches produits ou des pages catégories/listing ;
2. Playwright ouvre les pages avec ta session sauvegardée ;
3. les prix, stocks et changements sont enregistrés en base ;
4. une page admin affiche les variations et l'historique des scans.

> Important : utilise uniquement ton compte autorisé. L'app ne contourne pas les captchas, protections, paywalls ou permissions. Mets un délai raisonnable entre les pages.

## Installation

```bash
cp .env.example .env
npm install
npx playwright install chromium
npm run db:push
npm run dev
```

Ouvre ensuite :

```txt
http://localhost:3000/admin/tcg-prices
```

## Sauvegarder ta session TCG Distribution

Le site affiche probablement les prix seulement après connexion client pro. Lance :

```bash
npm run login:tcg
```

Une fenêtre Chromium s'ouvre. Connecte-toi manuellement à TCG Distribution, vérifie que les prix sont visibles, puis reviens dans le terminal et appuie sur Entrée.

La session est sauvegardée dans :

```txt
storage/tcg-auth.json
```

Ne commit jamais ce fichier.

## Ajouter des URLs

Dans l'admin, ajoute :

- une **fiche produit** pour suivre un produit précis ;
- une **page listing/catégorie** pour découvrir automatiquement des fiches produits liées.

Exemple de page produit :

```txt
https://tcgdistribution.fr/one-piece-trading-card-game-boite-de-24-boosters-adventure-on-kami-s-island-op-15-jap
```

## Lancer un scan manuel

Depuis l'admin : bouton **Lancer un scan maintenant**.

Ou depuis le terminal :

```bash
npm run scrape:once
```

## Lancer régulièrement avec cron

L'endpoint cron est :

```txt
GET /api/cron/scrape-tcg
Authorization: Bearer <CRON_SECRET>
```

Exemple crontab sur un VPS, toutes les 6 heures :

```cron
0 */6 * * * curl -H "Authorization: Bearer change-moi-long-et-secret" https://ton-domaine.com/api/cron/scrape-tcg
```

Tu peux aussi utiliser GitHub Actions, Coolify, Dokploy, Ploi, Render cron jobs, ou un cron système classique.

## Variables importantes

```env
DATABASE_URL="file:./dev.db"
CRON_SECRET="change-moi-long-et-secret"
TCG_STORAGE_STATE_PATH="storage/tcg-auth.json"
SCRAPE_DELAY_MS="2500"
SCRAPE_MAX_PRODUCTS="80"
DISCOVER_FROM_WATCH_URLS="true"
DISCORD_WEBHOOK_URL=""
PLAYWRIGHT_NO_SANDBOX="false"
```

## Alertes Discord

Ajoute un webhook Discord :

```env
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
```

Quand un prix change, l'app envoie une alerte avec l'ancien prix, le nouveau prix et l'URL du produit.

## Notes de production

Pour une vraie prod, je recommande :

- VPS ou serveur Docker plutôt que Vercel, car Playwright headless est plus stable ;
- PostgreSQL à la place de SQLite si plusieurs personnes utilisent l'admin ;
- `SCRAPE_DELAY_MS` entre 2500 et 6000 ms ;
- limiter `SCRAPE_MAX_PRODUCTS` si le site est lent ;
- contacter TCG Distribution pour demander un export CSV/XML/API si possible.

## Structure

```txt
src/app/admin/tcg-prices/page.tsx       page admin
src/app/admin/tcg-prices/actions.ts    actions admin
src/app/api/cron/scrape-tcg/route.ts   endpoint cron sécurisé
src/lib/scraper/tcg.ts                 scraper Playwright
prisma/schema.prisma                   base de données
scripts/login-tcg.ts                   login manuel + sauvegarde session
scripts/scrape-tcg-once.ts             scan manuel terminal
```
