# Mise en ligne Vercel

## Variables nécessaires

```env
DATABASE_URL="postgresql://..."
CRON_SECRET="un_secret_long"
CPC_SUPPLIER_FACTOR="0.88"
CPC_SUPPLIER_BIG_FACTOR="0.77"
AUTO_MATCH_THRESHOLD="82"
SCRAPE_MAX_PRODUCTS="500"
REFRESH_MAX_PRODUCTS="700"
STOCK_PROBE_MAX="1000"
STOCK_PROBE_HARD_MAX="5000"
TCG_DISCOVER_MAX_PAGES="30"
CPC_DISCOVER_MAX_PAGES="50"
```

## Session TCGD

En local :

```bash
npm run login:tcg
```

Puis copie le contenu de `storage/tcg-auth.json` dans Vercel :

```env
TCG_STORAGE_STATE_JSON='{...}'
```

Ne commit jamais `storage/tcg-auth.json`.

## Stock panier sur Vercel

Le probe stock utilise Playwright quand il doit tester le panier. Sur Vercel, le plus fiable est un navigateur distant :

```env
BROWSERLESS_WS_ENDPOINT="wss://..."
```

Sans navigateur distant, l’import HTML et le comparatif fonctionnent, mais le stock exact par panier peut être limité.

## Base PostgreSQL

Avant de déployer, passe Prisma en PostgreSQL :

```bash
npm run use:postgres
npx prisma migrate dev --name init
```

Commande de build conseillée dans Vercel :

```bash
npx prisma migrate deploy && npx prisma generate && next build
```
