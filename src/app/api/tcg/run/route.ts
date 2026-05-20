import { NextResponse } from "next/server";
import { refreshAllCpc, refreshAllTcg } from "@/lib/scraper/simple";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (expected && received !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await refreshAllTcg(Number(process.env.REFRESH_MAX_PRODUCTS ?? 700));
  await refreshAllCpc(Number(process.env.REFRESH_MAX_PRODUCTS ?? 700));
  return NextResponse.json({ ok: true });
}
