import z from "@deepseek-ai/schemastery";
import { resolveHostCredentials } from "./credentials.js";

export * from "./credentials.js";
export const name = "@dipertq/dsh-openviking-status";
export const inject = ["webServer"];

const NS = "openviking-status";
const API_PREFIX = "/openviking-status/api";

export const Config = z.object({
  endpoint: z.string().default("http://127.0.0.1:1933"),
  apiKey: z.string().role("secret").default(""),
});

export type OpenVikingConfig = {
  endpoint?: string;
  apiKey?: string;
};

async function readJson(req: any): Promise<Record<string, any>> {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
  }
  try {
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

function sendJson(res: any, status: number, body: any): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function getCandidateSessionIds(sessionId: string): string[] {
  const raw = sessionId.trim();
  const candidates: string[] = [];

  if (raw.startsWith("dsh-session-")) {
    const suffix = raw.slice("dsh-session-".length);
    candidates.push(raw, `dsh-${suffix}`);
  } else if (raw.startsWith("dsh-")) {
    const suffix = raw.slice("dsh-".length);
    candidates.push(raw, `dsh-session-${suffix}`);
  } else if (raw.startsWith("session-")) {
    candidates.push(`dsh-${raw}`, raw);
  } else {
    candidates.push(`dsh-session-${raw}`, `dsh-${raw}`, raw);
  }

  return Array.from(new Set(candidates));
}

export function apply(ctx: any, config?: OpenVikingConfig) {
  let currentSettings = () => config ?? {};
  let settingsService: any = null;

  // Attach to DSH settings if available
  ctx.inject?.(["settings"], (settingsCtx: any) => {
    settingsService = settingsCtx.settings;
    settingsCtx.settings?.installSection(
      ctx,
      NS,
      Config,
      config ?? { endpoint: "http://127.0.0.1:1933", apiKey: "" },
      {
        setSource: (src: () => OpenVikingConfig) => {
          currentSettings = src;
        },
        onChange: () => {},
      }
    );
  });

  function resolveEffective(): {
    endpoint: string;
    apiKey?: string;
    source: "env" | "ovcli" | "ov" | "settings" | "default";
  } {
    const saved = currentSettings() as Record<string, any>;
    const auto = resolveHostCredentials();

    const hasSavedEndpoint =
      typeof saved?.endpoint === "string" && saved.endpoint.trim().length > 0;
    const hasSavedKey =
      typeof saved?.apiKey === "string" && saved.apiKey.trim().length > 0;

    const endpoint = (
      hasSavedEndpoint ? saved.endpoint.trim() : auto.endpoint
    ).replace(/\/+$/, "");
    const apiKey = hasSavedKey ? saved.apiKey.trim() : auto.apiKey;
    const source = hasSavedEndpoint || hasSavedKey ? "settings" : auto.source;

    return { endpoint, apiKey, source };
  }

  function getHeaders(
    apiKey?: string,
    extra: Record<string, string> = {}
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...extra,
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    return headers;
  }

  // GET & POST /openviking-status/api/config
  ctx.effect?.(() => {
    return ctx.webServer?.register({
      kind: "exact",
      path: `${API_PREFIX}/config`,
      handler: async (req: any, res: any) => {
        try {
          if (req.method === "POST") {
            const body = await readJson(req);
            const settings =
              settingsService || ctx.get?.("settings") || ctx.settings;

            if (!settings) {
              sendJson(res, 503, { error: "Settings service unavailable" });
              return;
            }

            if (body.reset) {
              await settings.mutate(NS, [
                { op: "unset", path: ["endpoint"] },
                { op: "unset", path: ["apiKey"] },
              ]);
              sendJson(res, 200, { ok: true, reset: true });
              return;
            }

            const ops: any[] = [];
            if (
              typeof body.endpoint === "string" &&
              body.endpoint.trim().length > 0
            ) {
              const ep = body.endpoint.trim();
              if (!ep.startsWith("http://") && !ep.startsWith("https://")) {
                sendJson(res, 400, {
                  error: "Endpoint must start with http:// or https://",
                });
                return;
              }
              ops.push({
                op: "set",
                path: ["endpoint"],
                value: ep.replace(/\/+$/, ""),
              });
            }
            if (typeof body.apiKey === "string") {
              ops.push({
                op: "set",
                path: ["apiKey"],
                value: body.apiKey.trim(),
              });
            }

            if (ops.length > 0) {
              await settings.mutate(NS, ops);
            }

            sendJson(res, 200, { ok: true, config: resolveEffective() });
            return;
          }

          // GET /openviking-status/api/config
          const effective = resolveEffective();
          const maskedApiKey = effective.apiKey
            ? effective.apiKey.length > 8
              ? `${effective.apiKey.slice(0, 4)}••••${effective.apiKey.slice(-4)}`
              : "••••••••"
            : undefined;

          sendJson(res, 200, {
            endpoint: effective.endpoint,
            hasApiKey: Boolean(effective.apiKey),
            maskedApiKey,
            source: effective.source,
          });
        } catch (err) {
          sendJson(res, 500, { error: String(err) });
        }
      },
    });
  }, "openviking-status: config route");

  // POST /openviking-status/api/test-connection
  ctx.effect?.(() => {
    return ctx.webServer?.register({
      kind: "exact",
      path: `${API_PREFIX}/test-connection`,
      handler: async (req: any, res: any) => {
        try {
          const body = await readJson(req);
          const effective = resolveEffective();
          const targetUrl =
            (body.endpoint &&
              String(body.endpoint).trim().replace(/\/+$/, "")) ||
            effective.endpoint;
          const targetKey =
            typeof body.apiKey === "string"
              ? body.apiKey.trim()
              : effective.apiKey;

          const healthRes = await fetch(`${targetUrl}/health`, {
            method: "GET",
            headers: getHeaders(targetKey),
          }).catch(
            (err) => ({ ok: false, status: 0, statusText: err.message }) as any
          );

          if (!healthRes.ok) {
            sendJson(res, 200, {
              ok: false,
              authenticated: false,
              error:
                healthRes.status === 0
                  ? `Connection failed: ${healthRes.statusText}`
                  : `HTTP ${healthRes.status}: ${healthRes.statusText}`,
            });
            return;
          }

          const healthData = (await healthRes
            .json()
            .catch(() => ({}))) as Record<string, unknown>;

          // Probe authorization against session endpoint
          const probeCandidate = "dsh-session-test-probe";
          const authProbe = await fetch(
            `${targetUrl}/api/v1/sessions/${probeCandidate}`,
            {
              method: "GET",
              headers: getHeaders(targetKey),
            }
          ).catch(() => null);

          let authenticated = true;
          if (
            authProbe &&
            (authProbe.status === 401 || authProbe.status === 403)
          ) {
            authenticated = false;
          }

          sendJson(res, 200, {
            ok: true,
            version:
              typeof healthData.version === "string"
                ? healthData.version
                : undefined,
            storage:
              typeof healthData.storage === "string"
                ? healthData.storage
                : undefined,
            authenticated,
            error: authenticated
              ? undefined
              : "Daemon reachable, but API key is missing or invalid (HTTP 401)",
          });
        } catch (err) {
          sendJson(res, 500, { ok: false, error: String(err) });
        }
      },
    });
  }, "openviking-status: test connection route");

  // GET /openviking-status/api/health
  ctx.effect?.(() => {
    return ctx.webServer?.register({
      kind: "exact",
      path: `${API_PREFIX}/health`,
      handler: async (_req: any, res: any) => {
        try {
          const effective = resolveEffective();
          const daemonRes = await fetch(`${effective.endpoint}/health`, {
            method: "GET",
            headers: getHeaders(effective.apiKey),
          }).catch(
            (err) =>
              ({ ok: false, status: 502, statusText: err.message }) as any
          );

          if (!daemonRes.ok) {
            sendJson(res, daemonRes.status || 502, {
              ok: false,
              healthy: false,
              error: `Daemon returned ${daemonRes.status}: ${daemonRes.statusText}`,
            });
            return;
          }

          const body = await daemonRes.json().catch(() => ({}));
          sendJson(res, 200, body);
        } catch (err) {
          sendJson(res, 502, { ok: false, healthy: false, error: String(err) });
        }
      },
    });
  }, "openviking-status: health proxy route");

  // GET /openviking-status/api/session
  ctx.effect?.(() => {
    return ctx.webServer?.register({
      kind: "exact",
      path: `${API_PREFIX}/session`,
      handler: async (req: any, res: any) => {
        try {
          const url = new URL(req.url || "/", "http://localhost");
          const sessionId = url.searchParams.get("id");

          if (!sessionId || !sessionId.trim()) {
            sendJson(res, 400, {
              status: "missing",
              error: "Missing session id",
            });
            return;
          }

          const effective = resolveEffective();
          const candidates = getCandidateSessionIds(sessionId);

          for (const candidateId of candidates) {
            const daemonRes = await fetch(
              `${effective.endpoint}/api/v1/sessions/${encodeURIComponent(candidateId)}`,
              {
                method: "GET",
                headers: getHeaders(effective.apiKey),
              }
            ).catch(() => null);

            if (!daemonRes) continue;
            if (daemonRes.status === 404) continue;

            if (daemonRes.status === 401 || daemonRes.status === 403) {
              sendJson(res, 200, { status: "unauthorized" });
              return;
            }

            if (!daemonRes.ok) {
              sendJson(res, 200, {
                status: "error",
                detail: `HTTP ${daemonRes.status}`,
              });
              return;
            }

            const data = (await daemonRes.json().catch(() => ({}))) as Record<
              string,
              unknown
            >;
            const raw = (data?.result ?? data?.data ?? data) as Record<
              string,
              unknown
            >;

            sendJson(res, 200, {
              status: "ok",
              session: {
                session_id:
                  typeof raw.session_id === "string"
                    ? raw.session_id
                    : candidateId,
                peer_id:
                  typeof raw.peer_id === "string" ? raw.peer_id : undefined,
                pending_tokens:
                  typeof raw.pending_tokens === "number"
                    ? raw.pending_tokens
                    : 0,
                message_count:
                  typeof raw.message_count === "number"
                    ? raw.message_count
                    : undefined,
                commit_count:
                  typeof raw.commit_count === "number"
                    ? raw.commit_count
                    : undefined,
                last_commit_at:
                  typeof raw.last_commit_at === "string"
                    ? raw.last_commit_at
                    : undefined,
                created_at:
                  typeof raw.created_at === "string"
                    ? raw.created_at
                    : undefined,
                updated_at:
                  typeof raw.updated_at === "string"
                    ? raw.updated_at
                    : undefined,
              },
            });
            return;
          }

          sendJson(res, 200, { status: "missing" });
        } catch (err) {
          sendJson(res, 200, { status: "unreachable", detail: String(err) });
        }
      },
    });
  }, "openviking-status: session proxy route");

  // POST /openviking-status/api/session/commit
  ctx.effect?.(() => {
    return ctx.webServer?.register({
      kind: "exact",
      path: `${API_PREFIX}/session/commit`,
      handler: async (req: any, res: any) => {
        try {
          const body = await readJson(req);
          const sessionId = body.sessionId;

          if (!sessionId || typeof sessionId !== "string") {
            sendJson(res, 400, { ok: false, error: "Missing sessionId" });
            return;
          }

          const effective = resolveEffective();
          const candidates = getCandidateSessionIds(sessionId);
          const payload = JSON.stringify({
            keep_recent_count: body.keep_recent_count ?? 10,
          });

          for (const candidateId of candidates) {
            const daemonRes = await fetch(
              `${effective.endpoint}/api/v1/sessions/${encodeURIComponent(candidateId)}/commit`,
              {
                method: "POST",
                headers: getHeaders(effective.apiKey),
                body: payload,
              }
            ).catch(() => null);

            if (!daemonRes) continue;
            if (daemonRes.status === 404) continue;

            if (!daemonRes.ok) {
              const errBody = (await daemonRes
                .json()
                .catch(() => null)) as Record<string, unknown> | null;
              const errorMsg =
                (errBody?.error as Record<string, unknown>)?.message ||
                errBody?.message ||
                errBody?.error ||
                `HTTP ${daemonRes.status}`;
              sendJson(res, 200, { ok: false, error: String(errorMsg) });
              return;
            }

            sendJson(res, 200, { ok: true });
            return;
          }

          sendJson(res, 200, {
            ok: false,
            error: "Session not found on commit",
          });
        } catch (err) {
          sendJson(res, 500, { ok: false, error: String(err) });
        }
      },
    });
  }, "openviking-status: session commit proxy route");
}
