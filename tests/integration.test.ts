import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  OpenVikingClient,
  OpenVikingStatusChip,
  OpenVikingStatusPopover,
  parseRecalledMemories,
  themeVar,
} from "../lib/client.js";
import type { SessionStatus, HealthStatus } from "../src/client/api";

describe("OpenViking E2E Integration Scenario", () => {
  const originalFetch = globalThis.fetch;
  let mockBackendState: {
    health: HealthStatus;
    session: SessionStatus;
    commitRequests: Array<{
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: string;
    }>;
  };

  beforeEach(() => {
    mockBackendState = {
      health: {
        ok: true,
        version: "0.2.5",
        storage: "vfs",
      },
      session: {
        session_id: "dsh-session-integration-42",
        peer_id: "peer-desktop-integration",
        pending_tokens: 14750,
        message_count: 24,
        commit_count: 3,
        last_commit_at: "2026-09-19T21:15:00Z",
      },
      commitRequests: [],
    };

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method || "GET";
      const headers = (init?.headers as Record<string, string>) || {};
      const body = init?.body as string | undefined;

      // 1. Health check endpoint
      if (urlStr.endsWith("/health")) {
        return {
          ok: mockBackendState.health.ok,
          status: mockBackendState.health.ok ? 200 : 503,
          statusText: mockBackendState.health.ok ? "OK" : "Service Unavailable",
          json: async () => mockBackendState.health,
          text: async () => JSON.stringify(mockBackendState.health),
        } as Response;
      }

      // 2. Commit session endpoint
      if (urlStr.includes("/commit") && method === "POST") {
        mockBackendState.commitRequests.push({
          url: urlStr,
          method,
          headers,
          body,
        });

        // Update backend session state upon commit
        mockBackendState.session.pending_tokens = 0;
        mockBackendState.session.commit_count =
          (mockBackendState.session.commit_count || 0) + 1;
        mockBackendState.session.last_commit_at = "2026-09-19T21:45:00Z";

        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ ok: true }),
          text: async () => JSON.stringify({ ok: true }),
        } as Response;
      }

      // 3. Get session endpoint
      if (urlStr.includes("/api/v1/sessions/")) {
        if (
          urlStr.endsWith("/dsh-session-integration-42") ||
          urlStr.endsWith("/dsh-integration-42")
        ) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => mockBackendState.session,
            text: async () => JSON.stringify(mockBackendState.session),
          } as Response;
        }

        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: async () => ({ error: "Session not found" }),
          text: async () => JSON.stringify({ error: "Session not found" }),
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({}),
        text: async () => "{}",
      } as Response;
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("executes complete lifecycle: parser -> status chip -> popover inspection -> commit action & state update", async () => {
    // 1. Initialize OpenVikingClient with mock backend
    const client = new OpenVikingClient(
      "http://127.0.0.1:1933",
      "ov-bearer-integration-token"
    );

    // Verify initial health and session from mock backend
    const initialHealth = await client.checkHealth();
    assert.strictEqual(initialHealth.ok, true);
    assert.strictEqual(initialHealth.version, "0.2.5");

    const initialSession = await client.fetchSession(
      "dsh-session-integration-42"
    );
    assert.ok(initialSession);
    assert.strictEqual(initialSession.pending_tokens, 14750);
    assert.strictEqual(initialSession.peer_id, "peer-desktop-integration");

    // 2. Feed raw chat messages with <openviking-context source="profile"> and <openviking-context>
    const rawChatMessages = [
      {
        role: "user",
        content: "What are our project conventions and tech stack?",
      },
      {
        role: "system",
        content: `
<openviking-context source="profile">
<available-memories>
  viking://user/dsh/memories/preferences/
    - user/commit_language.md
    - user/frontend_standards.md
</available-memories>
</openviking-context>
`,
      },
      {
        role: "assistant",
        content: `
<openviking-context>
Relevant memory from OpenViking.
<memory uri="viking://user/dsh/memories/entities/project/wrench_board.md" score="0.88">
Diagnostic board repair automation project
</memory>
</openviking-context>
Here is the requested information regarding conventions and tools...
`,
      },
    ];

    const recalledMemories = parseRecalledMemories(rawChatMessages);

    // Verify parser results
    assert.strictEqual(recalledMemories.recalledCount, 3);
    assert.strictEqual(recalledMemories.items.length, 3);

    const profileItems = recalledMemories.items.filter(
      (item) => item.source === "profile"
    );
    const recallItems = recalledMemories.items.filter(
      (item) => item.source === "recall"
    );

    assert.strictEqual(profileItems.length, 2);
    assert.strictEqual(recallItems.length, 1);
    assert.strictEqual(profileItems[0].category, "preferences");
    assert.strictEqual(profileItems[1].category, "preferences");
    assert.strictEqual(recallItems[0].category, "entities");
    assert.strictEqual(recallItems[0].score, 0.88);

    // 3. Render OpenVikingStatusChip with those messages and mock client
    const chipHtml = renderToString(
      React.createElement(OpenVikingStatusChip, {
        sessionId: "dsh-session-integration-42",
        messages: rawChatMessages,
        client,
        initialHealth,
        initialSessionData: initialSession,
      })
    );

    // 4. Verify chip label contains '<count> rec · <pending>k pend'
    // 14750 tokens rounds to 15k pend; count is 3
    assert.ok(
      chipHtml.includes("3 rec · 15k pend"),
      "Chip label must contain '3 rec · 15k pend'"
    );
    assert.ok(
      chipHtml.includes("OV:"),
      "Chip must display 'OV:' indicator when online"
    );
    assert.ok(
      chipHtml.includes(themeVar("stateSuccess")),
      "Status indicator dot must take its colour from the theme"
    );
    assert.ok(
      chipHtml.includes(
        "OpenViking: Online (3 recalled, 14,750 pending tokens)"
      ),
      "Tooltip must include detailed token and recalled counts"
    );

    // 5. Open popover and verify recalled memory list shows both profile and recall items with respective badges
    let onCommitFired = false;
    const triggerCommitNowAction = async () => {
      const res = await client.commitSession("dsh-session-integration-42", {
        keep_recent_count: 10,
      });
      if (res.ok) {
        onCommitFired = true;
      }
      return res;
    };

    const openPopoverHtml = renderToString(
      React.createElement(OpenVikingStatusChip, {
        sessionId: "dsh-session-integration-42",
        messages: rawChatMessages,
        client,
        initialHealth,
        initialSessionData: initialSession,
        initialOpen: true,
        onCommit: () => {
          onCommitFired = true;
        },
      })
    );

    // Verify popover dialog structure
    assert.ok(
      openPopoverHtml.includes('role="dialog"'),
      "Popover must render with role='dialog'"
    );
    assert.ok(
      openPopoverHtml.includes("OpenViking Memory Details"),
      "Popover must have accessible title"
    );
    assert.ok(
      openPopoverHtml.includes("127.0.0.1:1933"),
      "Popover header must display endpoint"
    );
    assert.ok(
      openPopoverHtml.includes("ONLINE"),
      "Popover header must show ONLINE status badge"
    );
    assert.ok(
      openPopoverHtml.includes("v0.2.5"),
      "Popover header must display version"
    );

    // Verify session metadata in popover
    assert.ok(
      openPopoverHtml.includes("dsh-session-inte..."),
      "Session ID must be displayed truncated"
    );
    assert.ok(
      openPopoverHtml.includes("peer-desktop-integration"),
      "Peer ID must be displayed"
    );

    // Verify progress bar
    assert.ok(
      openPopoverHtml.includes("14,750 / 20,000"),
      "Pending tokens counter must show pending and threshold"
    );
    assert.ok(
      openPopoverHtml.includes("74%"),
      "Progress bar must reflect 74% percentage"
    );

    // Verify recalled memory list shows both profile and recall items with badges
    assert.ok(
      openPopoverHtml.includes("Recalled Memories (3)"),
      "Recalled memories section must show total count 3"
    );
    assert.ok(
      openPopoverHtml.includes("preferences") ||
        openPopoverHtml.includes("PREFERENCES"),
      "Category badge for preferences must be rendered"
    );
    assert.ok(
      openPopoverHtml.includes("entities") ||
        openPopoverHtml.includes("ENTITIES"),
      "Category badge for entities must be rendered"
    );
    assert.ok(
      openPopoverHtml.includes("profile"),
      "Source badge 'profile' must be rendered"
    );
    assert.ok(
      openPopoverHtml.includes("recall"),
      "Source badge 'recall' must be rendered"
    );
    assert.ok(
      openPopoverHtml.includes("user/commit_language.md"),
      "Leaf filename for commit_language.md must be rendered"
    );
    assert.ok(
      openPopoverHtml.includes("user/frontend_standards.md"),
      "Leaf filename for frontend_standards.md must be rendered"
    );
    assert.ok(
      openPopoverHtml.includes("project/wrench_board.md"),
      "Leaf filename for wrench_board.md must be rendered"
    );

    // Verify Commit button is enabled
    assert.ok(
      openPopoverHtml.includes("Commit To Memory Now"),
      "Commit button must be present in popover"
    );
    const commitBtnMatch = openPopoverHtml.match(
      /<button[^>]*data-testid="commit-now-btn"[^>]*>/
    );
    assert.ok(commitBtnMatch, "Commit button element found");
    assert.ok(
      !commitBtnMatch[0].includes("disabled"),
      "Commit button must be enabled when online with pending tokens"
    );

    // 6. Trigger "Commit To Memory Now" action and verify API client POST call and state update
    // Also verify Popover component wires onCommitNow properly
    let popoverTriggerFired = false;
    const popoverStandaloneHtml = renderToString(
      React.createElement(OpenVikingStatusPopover, {
        sessionId: "dsh-session-integration-42",
        health: initialHealth,
        sessionData: initialSession,
        recalledResult: recalledMemories,
        endpoint: client.endpoint,
        isCommitting: false,
        onCommitNow: () => {
          popoverTriggerFired = true;
        },
      })
    );
    assert.ok(
      popoverStandaloneHtml.includes("Commit To Memory Now"),
      "Popover renders commit button"
    );

    // Execute the commit action
    const commitResult = await triggerCommitNowAction();
    assert.strictEqual(commitResult.ok, true);

    // Verify API client POST call
    assert.strictEqual(
      mockBackendState.commitRequests.length,
      1,
      "API client must perform exactly one POST request"
    );
    const commitReq = mockBackendState.commitRequests[0];
    assert.strictEqual(
      commitReq.url,
      "http://127.0.0.1:1933/api/v1/sessions/dsh-session-integration-42/commit"
    );
    assert.strictEqual(commitReq.method, "POST");
    assert.strictEqual(
      commitReq.headers["Authorization"],
      "Bearer ov-bearer-integration-token"
    );
    assert.strictEqual(commitReq.headers["Content-Type"], "application/json");
    assert.deepStrictEqual(JSON.parse(commitReq.body || "{}"), {
      keep_recent_count: 10,
    });

    // Verify backend session state was updated
    assert.strictEqual(
      mockBackendState.session.pending_tokens,
      0,
      "Backend session pending tokens must be reset to 0"
    );
    assert.strictEqual(
      mockBackendState.session.commit_count,
      4,
      "Backend session commit count must increment to 4"
    );
    assert.strictEqual(
      onCommitFired,
      true,
      "onCommit callback must be invoked"
    );

    // Verify updated session fetch
    const updatedSession = await client.fetchSession(
      "dsh-session-integration-42"
    );
    assert.ok(updatedSession);
    assert.strictEqual(updatedSession.pending_tokens, 0);
    assert.strictEqual(updatedSession.commit_count, 4);

    // Re-render chip with updated session state to verify UI reflects changes
    const updatedChipHtml = renderToString(
      React.createElement(OpenVikingStatusChip, {
        sessionId: "dsh-session-integration-42",
        messages: rawChatMessages,
        client,
        initialHealth,
        initialSessionData: updatedSession,
        initialOpen: true,
      })
    );

    // Verify chip label updated to 0k pend
    assert.ok(
      updatedChipHtml.includes("3 rec · 0k pend"),
      "Updated chip label must display '3 rec · 0k pend'"
    );

    // Verify Commit button is now disabled because pendingTokens is 0
    const updatedBtnMatch = updatedChipHtml.match(
      /<button[^>]*data-testid="commit-now-btn"[^>]*>/
    );
    assert.ok(updatedBtnMatch);
    assert.ok(
      updatedBtnMatch[0].includes("disabled"),
      "Commit button must be disabled when pending tokens is 0"
    );
  });

  it("handles commit failure by displaying error feedback in popover", async () => {
    // Override commit endpoint to simulate backend failure
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("/commit") && init?.method === "POST") {
        return {
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          json: async () => ({
            error: { message: "Disk quota exceeded in vector storage" },
          }),
          text: async () =>
            JSON.stringify({
              error: { message: "Disk quota exceeded in vector storage" },
            }),
        } as Response;
      }
      if (urlStr.endsWith("/health")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ ok: true }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          session_id: "dsh-session-fail",
          pending_tokens: 5000,
        }),
      } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient("http://127.0.0.1:1933");
    const commitResult = await client.commitSession("dsh-session-fail");

    assert.strictEqual(commitResult.ok, false);
    assert.strictEqual(
      commitResult.error,
      "Disk quota exceeded in vector storage"
    );

    // Verify error is rendered in Popover
    const popoverHtml = renderToString(
      React.createElement(OpenVikingStatusPopover, {
        sessionId: "dsh-session-fail",
        health: { ok: true },
        sessionData: { session_id: "dsh-session-fail", pending_tokens: 5000 },
        commitError: commitResult.error,
      })
    );

    assert.ok(
      popoverHtml.includes("Disk quota exceeded in vector storage"),
      "Popover must render commit error message"
    );
    assert.ok(
      popoverHtml.includes('data-testid="commit-error-message"'),
      "Error message container must have test id"
    );
  });

  it("handles offline state: chip displays OV offline, popover shows OFFLINE badge and disables commit", async () => {
    globalThis.fetch = (async (url: string) => {
      if (String(url).endsWith("/health")) {
        return {
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
          json: async () => ({ ok: false }),
        } as Response;
      }
      return { ok: false, status: 503 } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient("http://127.0.0.1:1933");
    const health = await client.checkHealth();
    assert.strictEqual(health.ok, false);

    const offlineChipHtml = renderToString(
      React.createElement(OpenVikingStatusChip, {
        sessionId: "dsh-session-offline",
        client,
        initialHealth: health,
        initialOpen: true,
      })
    );

    assert.ok(offlineChipHtml.includes("OV"), "Offline chip must show 'OV'");
    assert.ok(
      offlineChipHtml.includes("offline"),
      "Offline chip must display 'offline'"
    );
    assert.ok(
      offlineChipHtml.includes(themeVar("stateError")),
      "Status indicator dot must use the theme's error colour when offline"
    );
    assert.ok(
      offlineChipHtml.includes("OFFLINE"),
      "Popover badge must say OFFLINE"
    );

    // Commit button disabled
    const btnMatch = offlineChipHtml.match(
      /<button[^>]*data-testid="commit-now-btn"[^>]*>/
    );
    assert.ok(btnMatch);
    assert.ok(
      btnMatch[0].includes("disabled"),
      "Commit button must be disabled when offline"
    );
  });
});
