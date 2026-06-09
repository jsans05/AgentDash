import { NextResponse, type NextRequest } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const LOCAL_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

function parseCsvEnv(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function normalizeProto(value: string | null): "http" | "https" {
  if (!value) return "https";
  return value.toLowerCase().startsWith("http://") || value.toLowerCase() === "http" ? "http" : "https";
}

function originFromHost(host: string, proto: string): string | null {
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

function addLocalLoopbackAliases(origins: Set<string>, baseOrigin: string) {
  try {
    const url = new URL(baseOrigin);
    if (!LOCAL_LOOPBACK_HOSTS.has(url.hostname)) return;
    const port = url.port ? `:${url.port}` : "";
    for (const hostname of LOCAL_LOOPBACK_HOSTS) {
      origins.add(`${url.protocol}//${hostname}${port}`);
    }
  } catch {
    // Ignore malformed origin and proceed with known valid origins.
  }
}

function getAllowedOrigins(req: NextRequest): Set<string> {
  const origins = new Set<string>([req.nextUrl.origin]);
  addLocalLoopbackAliases(origins, req.nextUrl.origin);

  const forwardedProto = normalizeProto(req.headers.get("x-forwarded-proto"));
  const forwardedHost = req.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const forwardedOrigin = originFromHost(forwardedHost, forwardedProto);
    if (forwardedOrigin) {
      origins.add(forwardedOrigin);
      addLocalLoopbackAliases(origins, forwardedOrigin);
    }
  }

  const hostHeader = req.headers.get("host");
  if (hostHeader) {
    const hostOrigin = originFromHost(hostHeader, req.nextUrl.protocol.replace(":", ""));
    if (hostOrigin) {
      origins.add(hostOrigin);
      addLocalLoopbackAliases(origins, hostOrigin);
    }
  }

  const additionalOrigins = parseCsvEnv("CSRF_ALLOWED_ORIGINS");
  for (const origin of additionalOrigins) {
    const normalized = normalizeOrigin(origin);
    if (normalized) origins.add(normalized);
  }
  return origins;
}

function getRequestOrigin(req: NextRequest): string | null {
  const originHeader = req.headers.get("origin");
  if (originHeader) {
    return normalizeOrigin(originHeader);
  }

  const refererHeader = req.headers.get("referer");
  if (refererHeader) {
    return normalizeOrigin(refererHeader);
  }

  return null;
}

function isExemptPath(pathname: string): boolean {
  const exemptPaths = parseCsvEnv("CSRF_EXEMPT_PATHS");
  return exemptPaths.some((prefix) => pathname.startsWith(prefix));
}

export function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (!MUTATING_METHODS.has(req.method)) {
    return NextResponse.next();
  }

  if (isExemptPath(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const requestOrigin = getRequestOrigin(req);
  const allowedOrigins = getAllowedOrigins(req);

  if (!requestOrigin || !allowedOrigins.has(requestOrigin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
