import { NextResponse } from "next/server";

export const MAX_API_PAYLOAD_BYTES = 25 * 1024 * 1024;

export function payloadTooLargeResponse(message = "Payload too large") {
  return NextResponse.json({ error: message }, { status: 413 });
}

export function enforceContentLengthLimit(
  req: Request,
  maxBytes = MAX_API_PAYLOAD_BYTES,
  message?: string
) {
  const raw = req.headers.get("content-length");
  if (!raw) return null;

  const contentLength = Number(raw);
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    return payloadTooLargeResponse(message ?? "Invalid Content-Length");
  }
  if (contentLength > maxBytes) {
    return payloadTooLargeResponse(message ?? `Payload too large. Max ${maxBytes} bytes.`);
  }

  return null;
}

export function enforceFileSizeLimit(
  file: Pick<File, "size"> | null | undefined,
  maxBytes = MAX_API_PAYLOAD_BYTES,
  message?: string
) {
  if (!file) return null;
  if (file.size > maxBytes) {
    return payloadTooLargeResponse(message ?? `Uploaded file too large. Max ${maxBytes} bytes.`);
  }
  return null;
}

export function enforceTextSizeLimit(
  value: string,
  maxBytes = MAX_API_PAYLOAD_BYTES,
  message?: string
) {
  const byteLength = new TextEncoder().encode(value).length;
  if (byteLength > maxBytes) {
    return payloadTooLargeResponse(message ?? `Payload field too large. Max ${maxBytes} bytes.`);
  }
  return null;
}
