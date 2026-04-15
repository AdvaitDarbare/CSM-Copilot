import { NextResponse } from "next/server";
import { getWorkspaceBootstrapData } from "@/lib/csm-data";

export async function GET() {
  const data = await getWorkspaceBootstrapData();

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
