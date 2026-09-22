import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { apply } from "../lib/index.js";

interface MockRoute {
  kind: string;
  path: string;
  handler: (req: any, res: any) => void;
}

function startMockDaemon(): Promise<{
  server: Server;
  url: string;
  requests: any[];
}> {
  return new Promise((resolve) => {
    const requests: any[] = [];
    const server = createServer((req, res) => {
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
      });

      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            healthy: true,
            version: "v0.4.20",
            storage: "sqlite",
          })
        );
        return;
      }

      if (req.url?.startsWith("/api/v1/sessions/")) {
        if (!req.headers.authorization) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              status: "error",
              error: { code: "UNAUTHENTICATED" },
            })
          );
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            result: {
              session_id: "dsh-session-123",
              pending_tokens: 4200,
              message_count: 12,
            },
          })
        );
        return;
      }

      if (req.url?.startsWith("/api/v1/sessions/dsh-session-123/commit")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}`, requests });
    });
  });
}

function createMockContext(
  routes: MockRoute[],
  settingsStore: Record<string, any> = {}
) {
  return {
    effect(fn: () => void) {
      fn();
    },
    inject(deps: string[], fn: (ctx: any) => void) {
      if (deps.includes("settings")) {
        fn({
          settings: {
            installSection(
              owner: any,
              ns: string,
              schema: any,
              entry: any,
              hooks: any
            ) {
              hooks.setSource(() => settingsStore[ns] || entry);
            },
            mutate: async (ns: string, ops: any[]) => {
              for (const op of ops) {
                if (op.op === "set") {
                  settingsStore[ns] = op.value;
                } else if (op.op === "unset") {
                  delete settingsStore[ns];
                }
              }
            },
            describe: () => [{ ns: "openviking-status", revision: 1 }],
          },
        });
      }
    },
    webServer: {
      register(route: MockRoute) {
        if (
          routes.some((r) => r.kind === route.kind && r.path === route.path)
        ) {
          throw new Error(
            `webserver: duplicate ${route.kind} route "${route.path}"`
          );
        }
        routes.push(route);
      },
    },
  };
}

async function invokeHandler(
  route: MockRoute,
  method: string,
  url: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve) => {
    const req = {
      method,
      url,
      headers: {
        host: "localhost:3080",
        "content-type": "application/json",
        ...headers,
      },
      [Symbol.asyncIterator]: async function* () {
        if (body) {
          yield JSON.stringify(body);
        }
      },
    };

    let statusCode = 200;
    let responseData = "";
    const res = {
      writeHead(status: number) {
        statusCode = status;
      },
      end(chunk?: string) {
        if (chunk) responseData += chunk;
        resolve({
          status: statusCode,
          body: responseData ? JSON.parse(responseData) : null,
        });
      },
    };

    route.handler(req, res);
  });
}

test("host proxy routes - registers routes and proxies health & session requests", async () => {
  const daemon = await startMockDaemon();
  const routes: MockRoute[] = [];
  const settingsStore: Record<string, any> = {
    "openviking-status": {
      endpoint: daemon.url,
      apiKey: "test-auth-token",
    },
  };

  const ctx = createMockContext(routes, settingsStore);
  apply(ctx as any);

  try {
    const healthRoute = routes.find(
      (r) => r.path === "/openviking-status/api/health"
    );
    assert.ok(
      healthRoute,
      "GET /openviking-status/api/health must be registered"
    );

    const healthRes = await invokeHandler(
      healthRoute!,
      "GET",
      "/openviking-status/api/health"
    );
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.body.healthy, true);
    assert.equal(healthRes.body.version, "v0.4.20");

    const sessionRoute = routes.find(
      (r) => r.path === "/openviking-status/api/session"
    );
    assert.ok(
      sessionRoute,
      "GET /openviking-status/api/session must be registered"
    );

    const sessionRes = await invokeHandler(
      sessionRoute!,
      "GET",
      "/openviking-status/api/session?id=session-123"
    );
    assert.equal(sessionRes.status, 200);
    assert.equal(sessionRes.body.status, "ok");
    assert.equal(sessionRes.body.session.pending_tokens, 4200);

    // Verify Authorization header was attached to daemon request
    const sessionDaemonReq = daemon.requests.find((r) =>
      r.url.includes("dsh-session-123")
    );
    assert.ok(sessionDaemonReq);
    assert.equal(
      sessionDaemonReq.headers.authorization,
      "Bearer test-auth-token"
    );

    // Test commit proxy
    const commitRoute = routes.find(
      (r) => r.path === "/openviking-status/api/session/commit"
    );
    assert.ok(
      commitRoute,
      "POST /openviking-status/api/session/commit must be registered"
    );
    const commitRes = await invokeHandler(
      commitRoute!,
      "POST",
      "/openviking-status/api/session/commit",
      {
        sessionId: "session-123",
        keep_recent_count: 5,
      }
    );
    assert.equal(commitRes.status, 200);
    assert.equal(commitRes.body.ok, true);

    // Test config read
    const configRoute = routes.find(
      (r) => r.path === "/openviking-status/api/config"
    );
    assert.ok(
      configRoute,
      "GET /openviking-status/api/config must be registered"
    );
    const configRes = await invokeHandler(
      configRoute!,
      "GET",
      "/openviking-status/api/config"
    );
    assert.equal(configRes.status, 200);
    assert.equal(configRes.body.endpoint, daemon.url);
    assert.equal(configRes.body.hasApiKey, true);

    // Test connection probe
    const testRoute = routes.find(
      (r) => r.path === "/openviking-status/api/test-connection"
    );
    assert.ok(
      testRoute,
      "POST /openviking-status/api/test-connection must be registered"
    );
    const testRes = await invokeHandler(
      testRoute!,
      "POST",
      "/openviking-status/api/test-connection",
      {
        endpoint: daemon.url,
        apiKey: "test-auth-token",
      }
    );
    assert.equal(testRes.status, 200);
    assert.equal(testRes.body.ok, true);
    assert.equal(testRes.body.version, "v0.4.20");
    assert.equal(testRes.body.authenticated, true);
  } finally {
    daemon.server.close();
  }
});
