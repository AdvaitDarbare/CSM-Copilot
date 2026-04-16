import { NextResponse } from "next/server";

const API_BASE_URL =
  process.env.CSM_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://127.0.0.1:8000";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!response.ok) {
      let errorMessage = `Agent API error: ${response.status}`;
      let suggestedAccounts: unknown[] = [];

      try {
        const payload = await response.json();
        const detail =
          payload && typeof payload === "object" && "detail" in payload
            ? payload.detail
            : payload;

        if (typeof detail === "string") {
          errorMessage = detail;
        } else if (detail && typeof detail === "object") {
          const message =
            "message" in detail && typeof detail.message === "string"
              ? detail.message
              : null;
          const suggestions =
            "suggested_accounts" in detail && Array.isArray(detail.suggested_accounts)
              ? detail.suggested_accounts
              : [];

          errorMessage = message ?? errorMessage;
          suggestedAccounts = suggestions;
        }
      } catch {
        const errorText = await response.text();
        if (errorText) {
          errorMessage = errorText;
        }
      }

      return NextResponse.json(
        { error: errorMessage, suggested_accounts: suggestedAccounts },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    // Return a fallback response so the UI stays responsive
    return NextResponse.json(
      {
        reply:
          "I couldn't reach the agent backend right now. Make sure the Python API is running (`uvicorn main:app --reload`).",
        workflow: "morning",
        account_id: null,
        provenance: [],
        triage_accounts: null,
        brief_snapshot: null,
        similar_accounts: null,
      },
      { status: 200 }
    );
  }
}
