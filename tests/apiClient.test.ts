import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  OpenVikingClient,
  DEFAULT_OPENVIKING_ENDPOINT,
  resolveEndpoint,
  resolveApiKey,
  checkHealth,
  fetchSession,
  getSession,
  commitSession,
} from "../lib/client.js";

interface MockRequestRecord {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

describe("OpenVikingClient - Endpoint and API Key Resolution", () => {
  let originalWindow: unknown;
  let originalLocalStorage: unknown;

  beforeEach(() => {
    originalWindow = (globalThis as unknown as Record<string, unknown>).window;
    originalLocalStorage = (globalThis as unknown as Record<string, unknown>)
      .localStorage;
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).window = originalWindow;
    (globalThis as unknown as Record<string, unknown>).localStorage =
      originalLocalStorage;
  });

  it("resolves default endpoint when none provided", () => {
    const client = new OpenVikingClient();
    assert.strictEqual(client.endpoint, DEFAULT_OPENVIKING_ENDPOINT);
    assert.strictEqual(client.endpoint, "http://127.0.0.1:1933");
    assert.strictEqual(client.apiKey, undefined);
  });

  it("resolves custom endpoint and strips trailing slashes", () => {
    const client1 = new OpenVikingClient("http://localhost:8080");
    assert.strictEqual(client1.endpoint, "http://localhost:8080");

    const client2 = new OpenVikingClient("https://ov.example.com:9000///");
    assert.strictEqual(client2.endpoint, "https://ov.example.com:9000");

    const client3 = new OpenVikingClient("   ");
    assert.strictEqual(client3.endpoint, DEFAULT_OPENVIKING_ENDPOINT);
  });

  it("resolves endpoint from global window.__OPENVIKING_ENDPOINT__", () => {
    (globalThis as unknown as Record<string, unknown>).window = {
      __OPENVIKING_ENDPOINT__: "http://window-host:1933/",
    };
    assert.strictEqual(resolveEndpoint(), "http://window-host:1933");
  });

  it("resolves endpoint from localStorage openviking_endpoint and OPENVIKING_ENDPOINT", () => {
    (globalThis as unknown as Record<string, unknown>).localStorage = {
      getItem: (key: string) => {
        if (key === "openviking_endpoint") return "http://storage-host:1933/";
        return null;
      },
    };
    assert.strictEqual(resolveEndpoint(), "http://storage-host:1933");

    (globalThis as unknown as Record<string, unknown>).localStorage = {
      getItem: (key: string) => {
        if (key === "OPENVIKING_ENDPOINT") return "http://caps-storage:1933";
        return null;
      },
    };
    assert.strictEqual(resolveEndpoint(), "http://caps-storage:1933");
  });

  it("gracefully falls back to default endpoint if localStorage access throws", () => {
    (globalThis as unknown as Record<string, unknown>).localStorage = {
      getItem: () => {
        throw new Error("SecurityError: Access is denied");
      },
    };
    assert.strictEqual(resolveEndpoint(), DEFAULT_OPENVIKING_ENDPOINT);
  });

  it("resolves custom API key from constructor options", () => {
    const client = new OpenVikingClient(
      "http://127.0.0.1:1933",
      "ov-secret-token"
    );
    assert.strictEqual(client.apiKey, "ov-secret-token");

    const clientEmpty = new OpenVikingClient("http://127.0.0.1:1933", "   ");
    assert.strictEqual(clientEmpty.apiKey, undefined);
  });

  it("resolves API key from window.__OPENVIKING_API_KEY__ and localStorage", () => {
    assert.strictEqual(resolveApiKey("explicit-key"), "explicit-key");

    (globalThis as unknown as Record<string, unknown>).window = {
      __OPENVIKING_API_KEY__: "window-token",
    };
    assert.strictEqual(resolveApiKey(), "window-token");

    (globalThis as unknown as Record<string, unknown>).window = undefined;
    (globalThis as unknown as Record<string, unknown>).localStorage = {
      getItem: (key: string) => {
        if (key === "openviking_api_key") return "storage-token";
        return null;
      },
    };
    assert.strictEqual(resolveApiKey(), "storage-token");

    (globalThis as unknown as Record<string, unknown>).localStorage = {
      getItem: (key: string) => {
        if (key === "OPENVIKING_API_KEY") return "caps-storage-token";
        return null;
      },
    };
    assert.strictEqual(resolveApiKey(), "caps-storage-token");

    (globalThis as unknown as Record<string, unknown>).localStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    };
    assert.strictEqual(resolveApiKey(), undefined);
  });

  it("injects Bearer token into request headers when apiKey is present and omits it when absent", async () => {
    const originalFetch = globalThis.fetch;
    const requests: MockRequestRecord[] = [];

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        method: init?.method || "GET",
        headers: (init?.headers as Record<string, string>) || {},
        body: init?.body as string,
      });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ ok: true }),
        text: async () => JSON.stringify({ ok: true }),
      } as Response;
    }) as typeof fetch;

    try {
      // Client with API key
      const clientWithKey = new OpenVikingClient(
        "http://127.0.0.1:1933",
        "secret-jwt-123"
      );
      await clientWithKey.checkHealth();

      assert.strictEqual(requests.length, 1);
      assert.strictEqual(
        requests[0].headers["Authorization"],
        "Bearer secret-jwt-123"
      );
      assert.strictEqual(
        requests[0].headers["Content-Type"],
        "application/json"
      );

      // Client without API key
      const clientNoKey = new OpenVikingClient("http://127.0.0.1:1933");
      await clientNoKey.checkHealth();

      assert.strictEqual(requests.length, 2);
      assert.strictEqual(requests[1].headers["Authorization"], undefined);
      assert.strictEqual(
        requests[1].headers["Content-Type"],
        "application/json"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("OpenVikingClient - checkHealth()", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns ok: true with version and storage when backend is healthy", async () => {
    globalThis.fetch = (async (url: string) => {
      assert.strictEqual(url, "http://127.0.0.1:1933/health");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          ok: true,
          version: "0.2.1",
          storage: "vfs",
        }),
      } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const health = await client.checkHealth();

    assert.deepStrictEqual(health, {
      ok: true,
      version: "0.2.1",
      storage: "vfs",
    });
  });

  it("handles alternative healthy status indicators: status: 'ok' or status: 'healthy'", async () => {
    globalThis.fetch = (async () => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ status: "ok", version: "0.3.0" }),
      } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const health = await client.checkHealth();
    assert.strictEqual(health.ok, true);
    assert.strictEqual(health.version, "0.3.0");

    globalThis.fetch = (async () => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ status: "healthy" }),
      } as Response;
    }) as typeof fetch;

    const health2 = await client.checkHealth();
    assert.strictEqual(health2.ok, true);
  });

  it("returns ok: false with error details when HTTP response is non-ok", async () => {
    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => ({}),
      } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const health = await client.checkHealth();

    assert.strictEqual(health.ok, false);
    assert.strictEqual(health.error, "HTTP 503: Service Unavailable");
  });

  it("returns ok: false when response body indicates status: 'error' or ok: false", async () => {
    globalThis.fetch = (async () => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ ok: false, status: "error" }),
      } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const health = await client.checkHealth();

    assert.strictEqual(health.ok, false);
  });

  it("returns ok: false when network error occurs during fetch", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed: ECONNREFUSED 127.0.0.1:1933");
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const health = await client.checkHealth();

    assert.strictEqual(health.ok, false);
    assert.ok(health.error?.includes("ECONNREFUSED"));
  });

  it("returns ok: false when non-Error exception is thrown", async () => {
    globalThis.fetch = (async () => {
      throw "Network socket abruptly closed";
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const health = await client.checkHealth();

    assert.strictEqual(health.ok, false);
    assert.strictEqual(health.error, "Network socket abruptly closed");
  });
});

describe("OpenVikingClient - fetchSession(sessionId)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches session with direct ID match and maps all fields", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      requestedUrls.push(url);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          session_id: "dsh-session-12345",
          peer_id: "peer-desktop",
          pending_tokens: 3450,
          message_count: 15,
          commit_count: 2,
          last_commit_at: "2026-09-19T20:00:00Z",
          created_at: "2026-09-19T18:00:00Z",
          updated_at: "2026-09-19T20:30:00Z",
        }),
      } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const session = await client.fetchSession("dsh-session-12345");

    assert.strictEqual(requestedUrls.length, 1);
    assert.strictEqual(
      requestedUrls[0],
      "http://127.0.0.1:1933/api/v1/sessions/dsh-session-12345"
    );
    assert.deepStrictEqual(session, {
      session_id: "dsh-session-12345",
      peer_id: "peer-desktop",
      pending_tokens: 3450,
      message_count: 15,
      commit_count: 2,
      last_commit_at: "2026-09-19T20:00:00Z",
      created_at: "2026-09-19T18:00:00Z",
      updated_at: "2026-09-19T20:30:00Z",
    });
  });

  it("handles response wrapped in 'result' or 'data' container and 'last_commit' alias", async () => {
    globalThis.fetch = (async () => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          result: {
            session_id: "dsh-session-nested",
            pending_tokens: 1200,
            last_commit: "2026-09-19T19:00:00Z",
          },
        }),
      } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const session = await client.fetchSession("dsh-session-nested");

    assert.ok(session);
    assert.strictEqual(session.session_id, "dsh-session-nested");
    assert.strictEqual(session.pending_tokens, 1200);
    assert.strictEqual(session.last_commit_at, "2026-09-19T19:00:00Z");
  });

  it("performs ID resolution fallback: dsh-session-<id> -> dsh-<id> on 404", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      requestedUrls.push(url);
      if (url.endsWith("/dsh-session-abc")) {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: async () => ({ error: "Not Found" }),
        } as Response;
      }
      if (url.endsWith("/dsh-abc")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            session_id: "dsh-abc",
            pending_tokens: 4500,
          }),
        } as Response;
      }
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({}),
      } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const session = await client.fetchSession("dsh-session-abc");

    assert.strictEqual(requestedUrls.length, 2);
    assert.ok(requestedUrls[0].endsWith("/dsh-session-abc"));
    assert.ok(requestedUrls[1].endsWith("/dsh-abc"));
    assert.ok(session);
    assert.strictEqual(session.session_id, "dsh-abc");
    assert.strictEqual(session.pending_tokens, 4500);
  });

  it("performs reverse ID resolution fallback: dsh-<id> -> dsh-session-<id> on 404", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      requestedUrls.push(url);
      if (url.endsWith("/dsh-xyz")) {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: async () => ({}),
        } as Response;
      }
      if (url.endsWith("/dsh-session-xyz")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            session_id: "dsh-session-xyz",
            pending_tokens: 2800,
          }),
        } as Response;
      }
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({}),
      } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const session = await client.fetchSession("dsh-xyz");

    assert.strictEqual(requestedUrls.length, 2);
    assert.ok(requestedUrls[0].endsWith("/dsh-xyz"));
    assert.ok(requestedUrls[1].endsWith("/dsh-session-xyz"));
    assert.ok(session);
    assert.strictEqual(session.session_id, "dsh-session-xyz");
    assert.strictEqual(session.pending_tokens, 2800);
  });

  it("handles raw session IDs without dsh- prefix: tries dsh-session-, dsh-, then raw", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      requestedUrls.push(url);
      if (url.endsWith("/plain123")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            session_id: "plain123",
            pending_tokens: 1000,
          }),
        } as Response;
      }
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({}),
      } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const session = await client.fetchSession("plain123");

    assert.strictEqual(requestedUrls.length, 3);
    assert.ok(requestedUrls[0].endsWith("/dsh-session-plain123"));
    assert.ok(requestedUrls[1].endsWith("/dsh-plain123"));
    assert.ok(requestedUrls[2].endsWith("/plain123"));
    assert.ok(session);
    assert.strictEqual(session.session_id, "plain123");
  });

  it("uses cached resolved session ID on subsequent calls", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      requestedUrls.push(url);
      if (url.endsWith("/dsh-session-cached")) {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: async () => ({}),
        } as Response;
      }
      if (url.endsWith("/dsh-cached")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            session_id: "dsh-cached",
            pending_tokens: 3000,
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient();

    // First call triggers resolution: tries dsh-session-cached (404), then dsh-cached (200)
    const session1 = await client.fetchSession("dsh-session-cached");
    assert.strictEqual(requestedUrls.length, 2);
    assert.strictEqual(session1?.session_id, "dsh-cached");

    // Second call uses cached resolved session ID dsh-cached directly
    const session2 = await client.fetchSession("dsh-session-cached");
    assert.strictEqual(requestedUrls.length, 3);
    assert.ok(requestedUrls[2].endsWith("/dsh-cached"));
    assert.strictEqual(session2?.session_id, "dsh-cached");
  });

  it("gracefully returns null for empty or whitespace sessionId without fetch", async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return {} as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient();
    assert.strictEqual(await client.fetchSession(""), null);
    assert.strictEqual(await client.fetchSession("   "), null);
    assert.strictEqual(fetchCalled, false);
  });

  it("gracefully returns null when all candidates return 404", async () => {
    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({}),
      } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const session = await client.fetchSession("dsh-session-missing");
    assert.strictEqual(session, null);
  });

  it("gracefully returns null on 500 error or authorization error", async () => {
    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({}),
      } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const session = await client.fetchSession("dsh-session-err");
    assert.strictEqual(session, null);
  });

  it("gracefully returns null on network exception", async () => {
    globalThis.fetch = (async () => {
      throw new Error("Network offline");
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const session = await client.fetchSession("dsh-session-network-fail");
    assert.strictEqual(session, null);
  });

  it("getSession alias delegates to fetchSession", async () => {
    globalThis.fetch = (async () => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ session_id: "alias-test", pending_tokens: 10 }),
      } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const session = await client.getSession("alias-test");
    assert.strictEqual(session?.session_id, "alias-test");
  });
});

describe("OpenVikingClient - commitSession(sessionId, options)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("successfully performs commit POST with specified options", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody = "";
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init?.method || "";
      capturedBody = init?.body as string;
      capturedHeaders = (init?.headers as Record<string, string>) || {};
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ ok: true }),
      } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient(
      "http://127.0.0.1:1933",
      "test-auth-token"
    );
    const result = await client.commitSession("dsh-session-target", {
      keep_recent_count: 5,
    });

    // Двухфазный коммит: результат несёт разрешённый resource_id. Демон-мок не
    // вернул task_id, поэтому поле отсутствует (undefined).
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.resource_id, "dsh-session-target");
    assert.strictEqual(result.task_id, undefined);
    assert.strictEqual(
      capturedUrl,
      "http://127.0.0.1:1933/api/v1/sessions/dsh-session-target/commit"
    );
    assert.strictEqual(capturedMethod, "POST");
    assert.strictEqual(capturedBody, JSON.stringify({ keep_recent_count: 5 }));
    assert.strictEqual(capturedHeaders["Content-Type"], "application/json");
    assert.strictEqual(
      capturedHeaders["Authorization"],
      "Bearer test-auth-token"
    );
  });

  it("defaults keep_recent_count to 10 when options omitted", async () => {
    let capturedBody = "";
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ ok: true }),
      } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const result = await client.commitSession("dsh-session-target");

    assert.strictEqual(result.ok, true);
    assert.strictEqual(capturedBody, JSON.stringify({ keep_recent_count: 10 }));
  });

  it("resolves ID fallback on commit when initial candidate returns 404", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      requestedUrls.push(url);
      if (url.includes("/dsh-session-fb/commit")) {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: async () => ({ error: "Session not found" }),
        } as Response;
      }
      if (url.includes("/dsh-fb/commit")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ ok: true }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const result = await client.commitSession("dsh-session-fb");

    assert.strictEqual(requestedUrls.length, 2);
    assert.ok(requestedUrls[0].includes("/dsh-session-fb/commit"));
    assert.ok(requestedUrls[1].includes("/dsh-fb/commit"));
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.resource_id, "dsh-fb");
  });

  it("returns error on empty or whitespace sessionId", async () => {
    const client = new OpenVikingClient();
    assert.deepStrictEqual(await client.commitSession(""), {
      ok: false,
      error: "Missing sessionId",
    });
    assert.deepStrictEqual(await client.commitSession("   "), {
      ok: false,
      error: "Missing sessionId",
    });
  });

  it("handles 404 on all candidates with descriptive error", async () => {
    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({}),
      } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const result = await client.commitSession("dsh-session-notfound");

    assert.strictEqual(result.ok, false);
    assert.ok(result.error?.includes("Session not found:"));
  });

  it("extracts error message from nested JSON error: errBody.error.message", async () => {
    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({
          error: { message: "Concurrent commit conflict detected" },
        }),
      } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const result = await client.commitSession("dsh-session-conflict");

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "Concurrent commit conflict detected");
  });

  it("extracts error message from top-level errBody.message and errBody.error", async () => {
    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({ message: "Tokens threshold not reached" }),
      } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const result = await client.commitSession("dsh-session-msg");
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "Tokens threshold not reached");

    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({ error: "String error payload" }),
      } as Response;
    }) as typeof fetch;

    const result2 = await client.commitSession("dsh-session-err-str");
    assert.strictEqual(result2.ok, false);
    assert.strictEqual(result2.error, "String error payload");
  });

  it("extracts HTTP status code and text when error response has non-JSON body", async () => {
    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        json: async () => {
          throw new Error("Invalid JSON");
        },
      } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const result = await client.commitSession("dsh-session-gateway");

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "HTTP 502: Bad Gateway");
  });

  it("gracefully returns error message on network failure during commit", async () => {
    globalThis.fetch = (async () => {
      throw new Error("Socket connection timed out");
    }) as typeof fetch;

    const client = new OpenVikingClient();
    const result = await client.commitSession("dsh-session-timeout");

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "Socket connection timed out");
  });
});

describe("Standalone API helper functions", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("checkHealth helper calls client checkHealth", async () => {
    globalThis.fetch = (async (url: string) => {
      assert.strictEqual(url, "http://custom-host:8080/health");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ ok: true, version: "0.4.0" }),
      } as Response;
    }) as typeof fetch;

    const res = await checkHealth("http://custom-host:8080", "custom-token");
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.version, "0.4.0");
  });

  it("fetchSession and getSession helpers call client fetchSession", async () => {
    globalThis.fetch = (async (url: string) => {
      assert.ok(url.includes("/api/v1/sessions/dsh-session-helper"));
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          session_id: "dsh-session-helper",
          pending_tokens: 500,
        }),
      } as Response;
    }) as typeof fetch;

    const res1 = await fetchSession("dsh-session-helper");
    assert.strictEqual(res1?.session_id, "dsh-session-helper");

    const res2 = await getSession("dsh-session-helper");
    assert.strictEqual(res2?.session_id, "dsh-session-helper");
  });

  it("commitSession helper calls client commitSession", async () => {
    globalThis.fetch = (async (url: string) => {
      assert.ok(
        url.includes("/api/v1/sessions/dsh-session-helper-commit/commit")
      );
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ ok: true }),
      } as Response;
    }) as typeof fetch;

    const res = await commitSession("dsh-session-helper-commit", {
      keep_recent_count: 3,
    });
    assert.strictEqual(res.ok, true);
  });
});
