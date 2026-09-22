import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { apply } from "../lib/index.js";

/**
 * Хост-прокси задач Phase 2.
 *
 * - `POST /session/commit` пробрасывает `task_id` из ответа демона (раньше
 *   схлопывался в `{ ok: true }`).
 * - `GET /tasks?session=<id>` разрешает id в `dsh-session-*`, запрашивает
 *   `resource_id`+`task_type=session_commit`, клэмпит `limit<=200`.
 * - `GET /task?id=<id>&events=1` тянет одну задачу с `include_events=true`.
 * - Авторизация server-to-server: браузер ключ не держит, прокси добавляет
 *   `Authorization` сам.
 */

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
      requests.push({ method: req.method, url: req.url, headers: req.headers });

      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", version: "v0.4.20" }));
        return;
      }

      // Session probe used for resource_id resolution.
      if (
        req.url?.startsWith("/api/v1/sessions/dsh-session-abc") &&
        !req.url.includes("/commit")
      ) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ result: { session_id: "dsh-session-abc" } }));
        return;
      }

      if (req.url?.startsWith("/api/v1/sessions/dsh-session-abc/commit")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, task_id: "task-777" }));
        return;
      }

      if (req.url?.startsWith("/api/v1/tasks/task-777")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            result: {
              task_id: "task-777",
              status: "completed",
              execution_events: {
                items: [
                  { seq: 0, status: "created" },
                  { seq: 1, status: "running" },
                  { seq: 2, status: "completed" },
                ],
              },
            },
          })
        );
        return;
      }

      if (req.url?.startsWith("/api/v1/tasks?")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            items: [
              { task_id: "r", status: "running" },
              { task_id: "p", status: "pending" },
              { task_id: "c", status: "completed" },
            ],
          })
        );
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
  settingsStore: Record<string, any>
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
              _o: any,
              ns: string,
              _s: any,
              entry: any,
              hooks: any
            ) {
              hooks.setSource(() => settingsStore[ns] || entry);
            },
            mutate: async () => {},
            describe: () => [],
          },
        });
      }
    },
    webServer: {
      register(route: MockRoute) {
        routes.push(route);
      },
    },
  };
}

function invokeHandler(
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
        if (body) yield JSON.stringify(body);
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

test("commit proxy forwards task_id and resolved resource_id", async () => {
  const daemon = await startMockDaemon();
  const routes: MockRoute[] = [];
  const settingsStore = {
    "openviking-status": { endpoint: daemon.url, apiKey: "srv-token" },
  };
  apply(createMockContext(routes, settingsStore) as any);

  try {
    const commit = routes.find(
      (r) => r.path === "/openviking-status/api/session/commit"
    )!;
    const res = await invokeHandler(
      commit,
      "POST",
      "/openviking-status/api/session/commit",
      {
        sessionId: "session-abc",
      }
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.task_id, "task-777");
    assert.strictEqual(res.body.resource_id, "dsh-session-abc");
  } finally {
    daemon.server.close();
  }
});

test("tasks proxy resolves id, forwards task_type, clamps limit, attaches auth", async () => {
  const daemon = await startMockDaemon();
  const routes: MockRoute[] = [];
  const settingsStore = {
    "openviking-status": { endpoint: daemon.url, apiKey: "srv-token" },
  };
  apply(createMockContext(routes, settingsStore) as any);

  try {
    const tasks = routes.find(
      (r) => r.path === "/openviking-status/api/tasks"
    )!;
    // Request an over-cap limit to prove clamping.
    const res = await invokeHandler(
      tasks,
      "GET",
      "/openviking-status/api/tasks?session=session-abc&limit=9999"
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, "ok");
    assert.strictEqual(res.body.resource_id, "dsh-session-abc");
    assert.strictEqual(res.body.tasks.length, 3);

    const taskReq = daemon.requests.find((r) =>
      r.url.startsWith("/api/v1/tasks?")
    );
    assert.ok(taskReq, "daemon must receive a /tasks query");
    assert.match(taskReq.url, /resource_id=dsh-session-abc/);
    assert.match(taskReq.url, /task_type=session_commit/);
    assert.match(taskReq.url, /limit=200/); // clamped from 9999
    assert.strictEqual(taskReq.headers.authorization, "Bearer srv-token");
  } finally {
    daemon.server.close();
  }
});

test("tasks proxy extracts tasks when daemon responds with real OpenViking shape { status: 'ok', result: [...] }", async () => {
  const requests: any[] = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    if (req.url?.startsWith("/api/v1/sessions/dsh-session-ov")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result: { session_id: "dsh-session-ov" } }));
      return;
    }
    if (req.url?.startsWith("/api/v1/tasks?")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      // Real OpenViking response shape: { status: "ok", result: [...] }
      res.end(
        JSON.stringify({
          status: "ok",
          result: [
            {
              task_id: "task-real-1",
              task_type: "session_commit",
              status: "running",
              resource_id: "dsh-session-ov",
            },
          ],
        })
      );
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  const daemon = await new Promise<{ server: Server; url: string }>(
    (resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        resolve({ server, url: `http://127.0.0.1:${port}` });
      });
    }
  );

  const routes: MockRoute[] = [];
  const settingsStore = {
    "openviking-status": { endpoint: daemon.url, apiKey: "srv-token" },
  };
  apply(createMockContext(routes, settingsStore) as any);

  try {
    const tasks = routes.find(
      (r) => r.path === "/openviking-status/api/tasks"
    )!;
    const res = await invokeHandler(
      tasks,
      "GET",
      "/openviking-status/api/tasks?session=session-ov"
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, "ok");
    assert.strictEqual(res.body.resource_id, "dsh-session-ov");
    assert.strictEqual(res.body.tasks.length, 1);
    assert.strictEqual(res.body.tasks[0].task_id, "task-real-1");
  } finally {
    daemon.server.close();
  }
});

test("task detail proxy forwards include_events=true", async () => {
  const daemon = await startMockDaemon();
  const routes: MockRoute[] = [];
  const settingsStore = {
    "openviking-status": { endpoint: daemon.url, apiKey: "srv-token" },
  };
  apply(createMockContext(routes, settingsStore) as any);

  try {
    const task = routes.find((r) => r.path === "/openviking-status/api/task")!;
    const res = await invokeHandler(
      task,
      "GET",
      "/openviking-status/api/task?id=task-777&events=1"
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, "ok");
    assert.strictEqual(res.body.task.task_id, "task-777");

    const detailReq = daemon.requests.find((r) =>
      r.url.startsWith("/api/v1/tasks/task-777")
    );
    assert.ok(detailReq);
    assert.match(detailReq.url, /include_events=true/);
  } finally {
    daemon.server.close();
  }
});

test("tasks proxy returns missing when the session never resolves", async () => {
  const daemon = await startMockDaemon();
  const routes: MockRoute[] = [];
  const settingsStore = {
    "openviking-status": { endpoint: daemon.url, apiKey: "srv-token" },
  };
  apply(createMockContext(routes, settingsStore) as any);

  try {
    const tasks = routes.find(
      (r) => r.path === "/openviking-status/api/tasks"
    )!;
    const res = await invokeHandler(
      tasks,
      "GET",
      "/openviking-status/api/tasks?session=ghost-xyz"
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, "missing");
    assert.deepStrictEqual(res.body.tasks, []);
  } finally {
    daemon.server.close();
  }
});
