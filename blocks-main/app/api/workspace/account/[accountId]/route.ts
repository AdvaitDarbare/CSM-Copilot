import { NextResponse } from "next/server";
import { getAccountWorkspaceData } from "@/lib/csm-data";

export async function GET(
  _request: Request,
  context: { params: Promise<unknown> }
) {
  const { accountId } = (await context.params) as { accountId: string };
  const data = await getAccountWorkspaceData(accountId);

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
