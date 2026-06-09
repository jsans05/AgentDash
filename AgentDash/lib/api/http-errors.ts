import { NextResponse } from "next/server";

type ErrorResponseOptions = {
  status?: number;
  publicMessage?: string;
  code?: string;
  cause?: unknown;
  context?: string;
};

export function apiErrorResponse(options: ErrorResponseOptions = {}) {
  const {
    status = 500,
    publicMessage = status >= 500 ? "Internal server error" : "Request failed",
    code,
    cause,
    context = "api",
  } = options;

  if (cause !== undefined) {
    console.error(`[${context}]`, cause);
  }

  return NextResponse.json(
    {
      error: publicMessage,
      ...(code ? { code } : {}),
    },
    { status }
  );
}

export function internalServerError(cause?: unknown, context?: string, publicMessage?: string) {
  return apiErrorResponse({
    status: 500,
    publicMessage: publicMessage ?? "Internal server error",
    cause,
    context,
  });
}
