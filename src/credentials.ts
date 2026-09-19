import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface HostCredentials {
  endpoint: string;
  apiKey?: string;
  source: "env" | "ovcli" | "ov" | "default";
}

export interface ResolveOptions {
  cliConfigPath?: string;
  ovConfigPath?: string;
}

const DEFAULT_ENDPOINT = "http://127.0.0.1:1933";

function cleanStr(val: unknown): string | undefined {
  if (typeof val === "string" && val.trim().length > 0) {
    return val.trim();
  }
  return undefined;
}

function cleanUrl(val: unknown): string | undefined {
  const s = cleanStr(val);
  return s ? s.replace(/\/+$/, "") : undefined;
}

function tryReadJson(path: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Resolves OpenViking connection credentials on the host side:
 * 1. Environment variables (OPENVIKING_URL / OPENVIKING_BASE_URL, OPENVIKING_API_KEY / OPENVIKING_BEARER_TOKEN)
 * 2. ~/.openviking/ovcli.conf (url, api_key)
 * 3. ~/.openviking/ov.conf (server.url or server.host:server.port, server.root_api_key)
 * 4. Default fallback: http://127.0.0.1:1933
 */
export function resolveHostCredentials(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  options?: ResolveOptions
): HostCredentials {
  let endpoint = cleanUrl(env.OPENVIKING_URL || env.OPENVIKING_BASE_URL);
  let apiKey = cleanStr(env.OPENVIKING_API_KEY || env.OPENVIKING_BEARER_TOKEN);
  let source: "env" | "ovcli" | "ov" | "default" =
    endpoint || apiKey ? "env" : "default";

  // Check ~/.openviking/ovcli.conf if endpoint or apiKey missing
  if (!endpoint || !apiKey) {
    const cliPath =
      options?.cliConfigPath ||
      env.OPENVIKING_CLI_CONFIG_FILE ||
      join(homedir(), ".openviking", "ovcli.conf");

    const cliData = tryReadJson(cliPath);
    if (cliData) {
      if (!endpoint && cleanUrl(cliData.url)) {
        endpoint = cleanUrl(cliData.url);
        if (source === "default") source = "ovcli";
      }
      if (!apiKey && cleanStr(cliData.api_key)) {
        apiKey = cleanStr(cliData.api_key);
        if (source === "default") source = "ovcli";
      }
    }
  }

  // Check ~/.openviking/ov.conf if endpoint or apiKey still missing
  if (!endpoint || !apiKey) {
    const ovPath =
      options?.ovConfigPath ||
      env.OPENVIKING_CONFIG_FILE ||
      join(homedir(), ".openviking", "ov.conf");

    const ovData = tryReadJson(ovPath);
    if (ovData) {
      const server = (ovData.server as Record<string, unknown>) || {};
      if (!endpoint) {
        let ovUrl = cleanUrl(server.url);
        if (!ovUrl && server.port) {
          const host = cleanStr(server.host) || "127.0.0.1";
          ovUrl = `http://${host.replace("0.0.0.0", "127.0.0.1")}:${server.port}`;
        }
        if (ovUrl) {
          endpoint = ovUrl;
          if (source === "default") source = "ov";
        }
      }
      if (!apiKey && cleanStr(server.root_api_key)) {
        apiKey = cleanStr(server.root_api_key);
        if (source === "default") source = "ov";
      }
    }
  }

  return {
    endpoint: endpoint || DEFAULT_ENDPOINT,
    apiKey,
    source,
  };
}
