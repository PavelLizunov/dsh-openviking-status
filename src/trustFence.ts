/**
 * Trust Fence & Network Validator for OpenViking Status Plugin.
 *
 * Enforces:
 * - Loopback or trusted Host header validation (strict IPv4 127.0.0.0/8, IPv6 [::1], localhost).
 * - Same-origin / trusted Origin check on mutating HTTP methods.
 * - Safe handling of Origin: 'null' and malformed origin headers.
 * - application/json Content-Type requirement for POST/PUT/PATCH to prevent form-based CSRF.
 * - Method 405 for unsupported HTTP methods.
 * - URL scheme allowlist (http/https only) and metadata IP blocking (SSRF prevention).
 */

const CLOUD_METADATA_IPS = new Set([
  "169.254.169.254",
  "169.254.170.2",
  "metadata.google.internal",
  "100.100.100.200",
]);

const SUPPORTED_METHODS = new Set([
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isLoopbackHost(hostHeader: string | undefined | null): boolean {
  if (!hostHeader || typeof hostHeader !== "string") return false;

  let host = hostHeader.trim();

  // 1. Handle IPv6 bracketed notation: [::1]:port or [::1]
  if (host.startsWith("[")) {
    const closeBracket = host.indexOf("]");
    if (closeBracket === -1) return false;
    const ipv6Addr = host.slice(1, closeBracket).toLowerCase();
    const remainder = host.slice(closeBracket + 1);
    if (remainder && !/^:\d+$/.test(remainder)) return false;
    return ipv6Addr === "::1";
  }

  // 2. Handle IPv4 / hostname with optional port
  const lastColon = host.lastIndexOf(":");
  if (lastColon > 0) {
    const portPart = host.slice(lastColon + 1);
    if (/^\d+$/.test(portPart)) {
      host = host.slice(0, lastColon);
    }
  }
  host = host.toLowerCase().trim();

  if (host === "localhost" || host === "::1") return true;

  // 3. Strict IPv4 127.0.0.0/8 check: exactly four decimal numbers separated by dots
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) return false;

  const octets = ipv4Match.slice(1).map(Number);
  if (octets.some((o) => o < 0 || o > 255)) return false;
  return octets[0] === 127;
}

export function validateEndpointUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("Endpoint must be a non-empty string");
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (err: any) {
    throw new Error(`Invalid URL format: ${err.message}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Endpoint protocol must be http: or https:, received: ${parsed.protocol}`
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error(
      "Endpoint must not contain user credentials in URL authority"
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  if (CLOUD_METADATA_IPS.has(hostname) || hostname.startsWith("169.254.")) {
    throw new Error(
      `Access to link-local cloud metadata destination "${hostname}" is prohibited (SSRF prevention)`
    );
  }

  return parsed.origin;
}

export interface TrustFenceOptions {
  trustedHosts?: string[];
}

export function enforceTrustFence(
  req: any,
  res: any,
  options: TrustFenceOptions = {}
): boolean {
  const trustedHosts = options.trustedHosts || [
    "localhost:3080",
    "127.0.0.1:3080",
    "harness-test.tail9fd337.ts.net",
  ];
  const method = (req.method || "GET").toUpperCase();

  // 1. Method allowlist check (405 Method Not Allowed)
  if (!SUPPORTED_METHODS.has(method)) {
    res.writeHead(405, {
      "Content-Type": "application/json",
      Allow: Array.from(SUPPORTED_METHODS).join(", "),
    });
    res.end(
      JSON.stringify({ ok: false, error: `Method ${method} Not Allowed` })
    );
    return false;
  }

  // 2. Host header validation
  const hostHeader = req.headers["host"];
  const hostOk =
    isLoopbackHost(hostHeader) ||
    (hostHeader &&
      trustedHosts.some((th) => th.toLowerCase() === hostHeader.toLowerCase()));
  if (!hostOk) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ ok: false, error: "Forbidden: untrusted Host header" })
    );
    return false;
  }

  // 3. Mutating requests inspection (POST, PUT, PATCH, DELETE)
  if (MUTATING_METHODS.has(method)) {
    // 3a. Content-Type check (blocks simple form submissions)
    const contentType = (req.headers["content-type"] || "").toLowerCase();
    if (!contentType.includes("application/json")) {
      res.writeHead(415, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          error: "Unsupported Media Type: application/json required",
        })
      );
      return false;
    }

    // 3b. Origin / Referer check
    const origin = req.headers["origin"];
    if (origin !== undefined && origin !== null) {
      if (origin === "null" || origin.trim() === "") {
        // Sandboxed, opaque, or empty origin on mutating requests must be rejected
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error:
              "Forbidden: opaque or null Origin rejected on mutating requests",
          })
        );
        return false;
      }

      let originUrl: URL;
      try {
        originUrl = new URL(origin);
      } catch {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: "Forbidden: invalid Origin header",
          })
        );
        return false;
      }

      const originHost = originUrl.host.toLowerCase();
      const originOk =
        isLoopbackHost(originHost) ||
        trustedHosts.some((th) => th.toLowerCase() === originHost);
      if (!originOk) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: "Forbidden: cross-origin mutating request rejected",
          })
        );
        return false;
      }
    }
  }

  return true;
}
