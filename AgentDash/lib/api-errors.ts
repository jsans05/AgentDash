import { NextResponse } from "next/server";

export function logServerError(context: string, error: unknown) {
  console.error(`[api] ${context}`, error);
}

export function internalErrorResponse(message = "Internal server error") {
  return NextResponse.json({ error: message }, { status: 500 });
}
