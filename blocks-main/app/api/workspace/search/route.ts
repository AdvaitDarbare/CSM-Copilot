import { NextRequest, NextResponse } from "next/server";
import { searchWorkspaceAccounts } from "@/lib/csm-data";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const query = searchParams.get("q") ?? "";
  const limit = Number(searchParams.get("limit") ?? "6");
  const data = await searchWorkspaceAccounts(query, Number.isFinite(limit) ? limit : 6);

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
