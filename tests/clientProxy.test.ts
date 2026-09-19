import test from "node:test";
import assert from "node:assert/strict";
import { OpenVikingClient } from "../lib/client.js";

test("OpenVikingClient - proxy mode calls DSH host proxy endpoints", async () => {
  const requests: Array<{ url: string; method?: string; body?: any }> = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({
      url,
      method: init?.method || "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    if (url.includes("/openviking-status/api/health")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "ok",
          healthy: true,
          version: "v0.4.20",
          storage: "sqlite",
        }),
      } as any;
    }

    if (url.includes("/openviking-status/api/session?id=session-123")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "ok",
          session: {
            session_id: "dsh-session-123",
            pending_tokens: 3500,
          },
        }),
      } as any;
    }

    if (url.includes("/openviking-status/api/session/commit")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as any;
    }

    return { ok: false, status: 404, json: async () => ({}) } as any;
  }) as any;

  try {
    const client = new OpenVikingClient("/openviking-status/api");

    const health = await client.checkHealth();
    assert.equal(health.ok, true);
    assert.equal(health.version, "v0.4.20");

    const sessionRes = await client.readSession("session-123");
    assert.equal(sessionRes.status, "ok");
    if (sessionRes.status === "ok") {
      assert.equal(sessionRes.session.pending_tokens, 3500);
    }

    const commitRes = await client.commitSession("session-123", {
      keep_recent_count: 5,
    });
    assert.equal(commitRes.ok, true);

    assert.equal(requests.length, 3);
    assert.ok(requests[0]!.url.endsWith("/openviking-status/api/health"));
    assert.ok(
      requests[1]!.url.includes("/openviking-status/api/session?id=session-123")
    );
    assert.ok(
      requests[2]!.url.endsWith("/openviking-status/api/session/commit")
    );
    assert.equal(requests[2]!.body?.keep_recent_count, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenVikingClient - updateConfig updates endpoint and apiKey reactively", () => {
  const client = new OpenVikingClient("http://127.0.0.1:1933");
  assert.equal(client.endpoint, "http://127.0.0.1:1933");
  assert.equal(client.apiKey, undefined);

  client.updateConfig({
    endpoint: "http://100.1.2.3:1933/",
    apiKey: "updated-key",
  });

  assert.equal(client.endpoint, "http://100.1.2.3:1933");
  assert.equal(client.apiKey, "updated-key");
});
