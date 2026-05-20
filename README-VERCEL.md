# Déploiement Vercel

Cette app peut être déployée sur Vercel, mais il faut éviter SQLite et éviter un navigateur Playwright local persistant.

## 1. Base de données

Crée une base PostgreSQL externe : Neon, Supabase, Vercel Postgres ou Railway Postgres.

Puis dans le projet :

```bash
npm run use:postgres
```

Dans Vercel, ajoute :

```env
DATABASE_URL="postgresql://..."
CRON_SECRET="un_secret_long"
SCRAPE_MAX_PRODUCTS="80"
OWN_SCRAPE_MAX_PRODUCTS="120"
TCG_DISCOVER_MAX_PAGES="12"
```

Puis localement ou depuis Vercel build :

```bash
npx prisma db push
```

## 2. Navigateur Playwright

Pour Vercel, le plus fiable est un navigateur distant Browserless/Browserbase.

Ajoute :

```env
BROWSERLESS_WS_ENDPOINT="wss://..."
```

Sinon, garde le scraping lourd en local/VPS/Coolify et laisse Vercel afficher le dashboard.

## 3. Session TCG Distribution

En local :

```bash
npm run login:tcg
```

Puis copie le contenu de `storage/tcg-auth.json` dans une variable Vercel :

```env
TCG_STORAGE_STATE_JSON='{...contenu du fichier...}'
```

Ne commit jamais `storage/tcg-auth.json` dans GitHub.

## 4. Cron

Appelle :

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://ton-domaine.vercel.app/api/cron/scrape-tcg
```
