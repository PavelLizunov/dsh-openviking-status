import z from "@deepseek-ai/schemastery";
import { resolveHostCredentials } from "./credentials.js";
import {
  enforceTrustFence,
  validateEndpointUrl,
  isLoopbackHost,
} from "./trustFence.js";

export * from "./credentials.js";
export * from "./trustFence.js";
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

export interface AuthProbeResult {
  authState:
    | "authenticated"
    | "unauthorized"
    | "forbidden"
    | "not_found"
    | "server_error"
    | "unreachable"
    | "unexpected_status";
  httpStatus: number | null;
  reason: string;
}

export function classifyAuthProbe(
  status: number | null | undefined
): AuthProbeResult {
  if (
    status === null ||
    status === undefined ||
    typeof status !== "number" ||
    !Number.isFinite(status) ||
    status === 0
  ) {
    return {
      authState: "unreachable",
      httpStatus: null,
      reason: "Network error or timeout",
    };
  }
  if (status >= 200 && status < 300) {
    return {
      authState: "authenticated",
      httpStatus: status,
      reason: "Credentials verified",
    };
  }
  if (status === 401) {
    return {
      authState: "unauthorized",
      httpStatus: 401,
      reason: "Credentials rejected or missing",
    };
  }
  if (status === 403) {
    return {
      authState: "forbidden",
      httpStatus: 403,
      reason: "Access forbidden",
    };
  }
  if (status === 404) {
    return {
      authState: "not_found",
      httpStatus: 404,
      reason: "Endpoint or route not found; auth unverified",
    };
  }
  if (status >= 500 && status < 600) {
    return {
      authState: "server_error",
      httpStatus: status,
      reason: `Server error ${status}; auth unknown`,
    };
  }
  return {
    authState: "unexpected_status",
    httpStatus: status,
    reason: `Unexpected HTTP ${status}`,
  };
}

function maskApiKey(key: string | undefined): string | undefined {
  if (!key || typeof key !== "string") return undefined;
  const trimmed = key.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export function redactConfigDto(effective: {
  endpoint: string;
  apiKey?: string;
  source: string;
}): {
  endpoint: string;
  hasApiKey: boolean;
  apiKeyPresent: boolean;
  apiKeyHint?: string;
  maskedApiKey?: string;
  source: string;
} {
  const masked = maskApiKey(effective.apiKey);
  const hasKey = Boolean(
    effective.apiKey && effective.apiKey.trim().length > 0
  );
  return {
    endpoint: effective.endpoint,
    hasApiKey: hasKey,
    apiKeyPresent: hasKey,
    apiKeyHint: masked,
    maskedApiKey: masked,
    source: effective.source,
  };
}

async function readJson(req: any): Promise<Record<string, any>> {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 1024 * 64) {
      throw new Error("Payload Too Large: body exceeded 64KB");
    }
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

const TASKS_LIMIT_CAP = 200;
const SESSION_COMMIT_TASK_TYPE = "session_commit";

function clampLimit(raw: unknown, fallback = TASKS_LIMIT_CAP): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(TASKS_LIMIT_CAP, Math.max(1, Math.floor(n)));
}

function extractTaskId(body: Record<string, unknown> | null): string | null {
  if (!body || typeof body !== "object") return null;
  const containers = [
    body,
    body.result as Record<string, unknown> | undefined,
    body.data as Record<string, unknown> | undefined,
  ];
  for (const c of containers) {
    if (!c || typeof c !== "object") continue;
    const id = c.task_id ?? c.id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

function extractTaskItems(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data)) return data;
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.result)) return obj.result;
  if (Array.isArray(obj.items)) return obj.items;
  if (Array.isArray(obj.tasks)) return obj.tasks;
  if (obj.result && typeof obj.result === "object") {
    const res = obj.result as Record<string, unknown>;
    if (Array.isArray(res.items)) return res.items;
    if (Array.isArray(res.tasks)) return res.tasks;
  }
  return [];
}

async function resolveResourceId(
  endpoint: string,
  headers: Record<string, string>,
  sessionId: string,
  cache?: Map<string, string>
): Promise<string | null> {
  const key = sessionId.trim();
  const cached = cache?.get(key);
  if (cached) return cached;

  for (const candidateId of getCandidateSessionIds(sessionId)) {
    const daemonRes = await fetch(
      `${endpoint}/api/v1/sessions/${encodeURIComponent(candidateId)}`,
      { method: "GET", headers }
    ).catch(() => null);
    if (!daemonRes) continue;
    if (daemonRes.status === 404) continue;
    if (daemonRes.ok) {
      cache?.set(key, candidateId);
      return candidateId;
    }
  }
  return null;
}

export function apply(ctx: any, config?: OpenVikingConfig) {
  let currentSettings = () => config ?? {};
  let settingsService: any = null;

  const resourceIdCache = new Map<string, string>();

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

  // GET & POST /openviking-status/api/config (V1 & V2 & V4 Fixed)
  ctx.effect?.(() => {
    return ctx.webServer?.register({
      kind: "exact",
      path: `${API_PREFIX}/config`,
      handler: async (req: any, res: any) => {
        if (!enforceTrustFence(req, res)) return;

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
              sendJson(res, 200, {
                ok: true,
                reset: true,
                config: redactConfigDto(resolveEffective()),
              });
              return;
            }

            const ops: any[] = [];
            const effective = resolveEffective();
            let newEndpoint = effective.endpoint;
            let originChanged = false;

            if (
              typeof body.endpoint === "string" &&
              body.endpoint.trim().length > 0
            ) {
              newEndpoint = validateEndpointUrl(body.endpoint);
              const newOrigin = new URL(newEndpoint).origin;
              const oldOrigin = (() => {
                try {
                  return new URL(effective.endpoint).origin;
                } catch {
                  return null;
                }
              })();
              originChanged = newOrigin !== oldOrigin;
              ops.push({
                op: "set",
                path: ["endpoint"],
                value: newEndpoint,
              });
            }

            // V2 FIX: Endpoint-Credential Binding across config updates
            if (originChanged) {
              if (
                typeof body.apiKey === "string" &&
                body.apiKey.trim().length > 0
              ) {
                ops.push({
                  op: "set",
                  path: ["apiKey"],
                  value: body.apiKey.trim(),
                });
              } else {
                // Clear the key if endpoint origin changed and no key provided for new origin
                ops.push({ op: "unset", path: ["apiKey"] });
              }
            } else if (typeof body.apiKey === "string") {
              ops.push({
                op: "set",
                path: ["apiKey"],
                value: body.apiKey.trim(),
              });
            }

            if (ops.length > 0) {
              await settings.mutate(NS, ops);
            }

            // V1 FIX: Return redacted DTO, NEVER raw apiKey
            sendJson(res, 200, {
              ok: true,
              config: redactConfigDto(resolveEffective()),
            });
            return;
          }

          // GET /openviking-status/api/config
          // V1 FIX: Always return redacted DTO without raw secrets
          sendJson(res, 200, redactConfigDto(resolveEffective()));
        } catch (err: any) {
          sendJson(res, 500, { ok: false, error: err.message || String(err) });
        }
      },
    });
  }, "openviking-status: config route");

  // POST /openviking-status/api/test-connection (V2 & V3 & V4 Fixed)
  ctx.effect?.(() => {
    return ctx.webServer?.register({
      kind: "exact",
      path: `${API_PREFIX}/test-connection`,
      handler: async (req: any, res: any) => {
        if (!enforceTrustFence(req, res)) return;

        try {
          const body = await readJson(req);
          const effective = resolveEffective();

          // Validate target URL against scheme and metadata SSRF
          let targetUrl = effective.endpoint;
          let isCustomEndpoint = false;

          if (body.endpoint && String(body.endpoint).trim().length > 0) {
            targetUrl = validateEndpointUrl(body.endpoint);
            const targetOrigin = new URL(targetUrl).origin;
            const effectiveOrigin = new URL(effective.endpoint).origin;
            isCustomEndpoint = targetOrigin !== effectiveOrigin;
          }

          // V2 FIX: Strict Endpoint-Credential Binding
          // If custom endpoint -> use body.apiKey if provided, otherwise undefined (NEVER saved key)
          const targetKey =
            typeof body.apiKey === "string" && body.apiKey.trim().length > 0
              ? body.apiKey.trim()
              : isCustomEndpoint
                ? undefined
                : effective.apiKey;

          // Probe health with redirect: 'error'
          const healthRes = await fetch(`${targetUrl}/health`, {
            method: "GET",
            headers: getHeaders(targetKey),
            redirect: "error",
            signal: AbortSignal.timeout(5000),
          }).catch(
            (err) => ({ ok: false, status: 0, statusText: err.message }) as any
          );

          if (!healthRes.ok) {
            // V3 FIX: Classify HTTP 500/4xx properly
            const healthProbe = classifyAuthProbe(healthRes.status || 0);
            sendJson(res, 200, {
              ok: false,
              authenticated: false,
              authState: healthProbe.authState,
              httpStatus: healthRes.status || null,
              reason:
                healthRes.status === 0
                  ? `Connection failed: ${healthRes.statusText}`
                  : `HTTP ${healthRes.status}`,
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

          // V3 FIX: Probe authorization against tasks endpoint, falling back to session probe
          let authProbe = await fetch(`${targetUrl}/api/v1/tasks?limit=1`, {
            method: "GET",
            headers: getHeaders(targetKey),
            redirect: "error",
            signal: AbortSignal.timeout(5000),
          }).catch((err) => ({ status: 0, statusText: err.message }) as any);

          if (authProbe && authProbe.status === 404) {
            const probeCandidate = "dsh-session-test-probe";
            const sessionProbe = await fetch(
              `${targetUrl}/api/v1/sessions/${probeCandidate}`,
              {
                method: "GET",
                headers: getHeaders(targetKey),
                redirect: "error",
                signal: AbortSignal.timeout(5000),
              }
            ).catch(() => null);
            if (sessionProbe) {
              if (
                sessionProbe.status === 200 ||
                (sessionProbe.status === 404 && Boolean(targetKey))
              ) {
                authProbe = { status: 200, statusText: "OK" } as any;
              } else {
                authProbe = sessionProbe;
              }
            }
          }

          const probeResult = classifyAuthProbe(
            authProbe ? authProbe.status : 0
          );
          const isAuthenticated = probeResult.authState === "authenticated";

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
            authState: probeResult.authState,
            httpStatus: probeResult.httpStatus,
            reason: probeResult.reason,
            authenticated: isAuthenticated,
            error: isAuthenticated ? undefined : probeResult.reason,
          });
        } catch (err: any) {
          sendJson(res, 400, { ok: false, error: err.message || String(err) });
        }
      },
    });
  }, "openviking-status: test connection route");

  // GET /openviking-status/api/health
  ctx.effect?.(() => {
    return ctx.webServer?.register({
      kind: "exact",
      path: `${API_PREFIX}/health`,
      handler: async (req: any, res: any) => {
        if (!enforceTrustFence(req, res)) return;

        try {
          const effective = resolveEffective();
          const daemonRes = await fetch(`${effective.endpoint}/health`, {
            method: "GET",
            headers: getHeaders(effective.apiKey),
            redirect: "error",
            signal: AbortSignal.timeout(5000),
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
          sendJson(res, 200, { ...body, endpoint: effective.endpoint });
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
        if (!enforceTrustFence(req, res)) return;

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
                redirect: "error",
                signal: AbortSignal.timeout(5000),
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
        if (!enforceTrustFence(req, res)) return;

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
                redirect: "error",
                signal: AbortSignal.timeout(10000),
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

            const okBody = (await daemonRes.json().catch(() => null)) as Record<
              string,
              unknown
            > | null;
            const taskId = extractTaskId(okBody);
            sendJson(res, 200, {
              ok: true,
              ...(taskId ? { task_id: taskId } : {}),
              resource_id: candidateId,
            });
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

  // GET /openviking-status/api/tasks
  ctx.effect?.(() => {
    return ctx.webServer?.register({
      kind: "exact",
      path: `${API_PREFIX}/tasks`,
      handler: async (req: any, res: any) => {
        if (!enforceTrustFence(req, res)) return;

        try {
          const url = new URL(req.url || "/", "http://localhost");
          const sessionId = url.searchParams.get("session");
          if (!sessionId || !sessionId.trim()) {
            sendJson(res, 400, { status: "missing", error: "Missing session" });
            return;
          }

          const effective = resolveEffective();
          const headers = getHeaders(effective.apiKey);
          const resourceId = await resolveResourceId(
            effective.endpoint,
            headers,
            sessionId.trim(),
            resourceIdCache
          );

          if (!resourceId) {
            sendJson(res, 200, { status: "missing", tasks: [] });
            return;
          }

          const limit = clampLimit(url.searchParams.get("limit"));
          const query = new URLSearchParams({
            resource_id: resourceId,
            task_type: SESSION_COMMIT_TASK_TYPE,
            limit: String(limit),
          });

          const daemonRes = await fetch(
            `${effective.endpoint}/api/v1/tasks?${query.toString()}`,
            {
              method: "GET",
              headers,
              redirect: "error",
              signal: AbortSignal.timeout(10000),
            }
          ).catch(() => null);

          if (!daemonRes) {
            sendJson(res, 200, { status: "unreachable", tasks: [] });
            return;
          }
          if (daemonRes.status === 401 || daemonRes.status === 403) {
            sendJson(res, 200, { status: "unauthorized", tasks: [] });
            return;
          }
          if (!daemonRes.ok) {
            sendJson(res, 200, {
              status: "error",
              detail: `HTTP ${daemonRes.status}`,
              tasks: [],
            });
            return;
          }

          const data = (await daemonRes.json().catch(() => ({}))) as Record<
            string,
            unknown
          >;
          const items = extractTaskItems(data);

          sendJson(res, 200, {
            status: "ok",
            resource_id: resourceId,
            tasks: items,
          });
        } catch (err) {
          sendJson(res, 200, { status: "unreachable", detail: String(err) });
        }
      },
    });
  }, "openviking-status: tasks proxy route");

  // GET /openviking-status/api/task
  ctx.effect?.(() => {
    return ctx.webServer?.register({
      kind: "exact",
      path: `${API_PREFIX}/task`,
      handler: async (req: any, res: any) => {
        if (!enforceTrustFence(req, res)) return;

        try {
          const url = new URL(req.url || "/", "http://localhost");
          const taskId = url.searchParams.get("id");
          if (!taskId || !taskId.trim()) {
            sendJson(res, 400, { status: "missing", error: "Missing id" });
            return;
          }
          const withEvents =
            url.searchParams.get("events") === "1" ||
            url.searchParams.get("events") === "true";

          const effective = resolveEffective();
          const query = withEvents ? "?include_events=true" : "";
          const daemonRes = await fetch(
            `${effective.endpoint}/api/v1/tasks/${encodeURIComponent(
              taskId.trim()
            )}${query}`,
            {
              method: "GET",
              headers: getHeaders(effective.apiKey),
              redirect: "error",
              signal: AbortSignal.timeout(10000),
            }
          ).catch(() => null);

          if (!daemonRes) {
            sendJson(res, 200, { status: "unreachable" });
            return;
          }
          if (daemonRes.status === 404) {
            sendJson(res, 200, { status: "missing" });
            return;
          }
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
          const task = (data?.result ?? data?.data ?? data) as Record<
            string,
            unknown
          >;
          sendJson(res, 200, { status: "ok", task });
        } catch (err) {
          sendJson(res, 200, { status: "unreachable", detail: String(err) });
        }
      },
    });
  }, "openviking-status: task detail proxy route");
}
