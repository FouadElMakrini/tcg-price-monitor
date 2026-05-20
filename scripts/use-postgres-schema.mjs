import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "prisma", "schema.vercel.prisma");
const target = path.join(root, "prisma", "schema.prisma");

if (!fs.existsSync(source)) {
  console.error("schema.vercel.prisma introuvable. Applique d'abord le fix 06.");
  process.exit(1);
}

fs.copyFileSync(source, target);
console.log("Schema Prisma passé en PostgreSQL pour Vercel. Mets DATABASE_URL avec Neon/Supabase/Vercel Postgres puis lance: npx prisma db push");
