import { describe, it } from "node:test";
import assert from "node:assert";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  OpenVikingStatusPopover,
  getProgressBarPercent,
  getProgressBarColor,
  formatRelativeTime,
  formatMemoryLeafName,
  formatEndpoint,
  truncateSessionId,
  handleEscapeKey,
  COMMIT_THRESHOLD,
} from "../lib/client.mjs";

describe("getProgressBarPercent", () => {
  it("returns 0 for 0 or negative tokens", () => {
    assert.strictEqual(getProgressBarPercent(0), 0);
    assert.strictEqual(getProgressBarPercent(-100), 0);
  });

  it("calculates correct percentage for values below threshold", () => {
    assert.strictEqual(getProgressBarPercent(5000), 25);
    assert.strictEqual(getProgressBarPercent(10000), 50);
    assert.strictEqual(getProgressBarPercent(16000), 80);
  });

  it("returns 100 for threshold value", () => {
    assert.strictEqual(getProgressBarPercent(20000), 100);
  });

  it("caps at 100 when exceeding threshold", () => {
    assert.strictEqual(getProgressBarPercent(25000), 100);
    assert.strictEqual(getProgressBarPercent(100000), 100);
  });

  it("handles custom thresholds", () => {
    assert.strictEqual(getProgressBarPercent(500, 1000), 50);
    assert.strictEqual(getProgressBarPercent(0, 0), 0);
  });
});

describe("getProgressBarColor", () => {
  it("returns success green when percentage is below 80%", () => {
    assert.strictEqual(
      getProgressBarColor(0),
      "var(--dsw-status-success, #34d399)"
    );
    assert.strictEqual(
      getProgressBarColor(50),
      "var(--dsw-status-success, #34d399)"
    );
    assert.strictEqual(
      getProgressBarColor(79),
      "var(--dsw-status-success, #34d399)"
    );
  });

  it("returns warning yellow/amber when percentage is 80% or above", () => {
    assert.strictEqual(
      getProgressBarColor(80),
      "var(--dsw-status-warning, #fbbf24)"
    );
    assert.strictEqual(
      getProgressBarColor(95),
      "var(--dsw-status-warning, #fbbf24)"
    );
    assert.strictEqual(
      getProgressBarColor(100),
      "var(--dsw-status-warning, #fbbf24)"
    );
  });
});

describe("formatRelativeTime", () => {
  const now = 1700000000000;

  it("returns undefined for empty, null, or undefined values", () => {
    assert.strictEqual(formatRelativeTime(undefined), undefined);
    assert.strictEqual(formatRelativeTime(null), undefined);
    assert.strictEqual(formatRelativeTime(""), undefined);
  });

  it("returns 'just now' for recent times under 60 seconds", () => {
    assert.strictEqual(formatRelativeTime(now - 10000, now), "just now");
    assert.strictEqual(formatRelativeTime(now - 59000, now), "just now");
    assert.strictEqual(formatRelativeTime(now + 5000, now), "just now");
  });

  it("formats minutes ago for times under 60 minutes", () => {
    assert.strictEqual(formatRelativeTime(now - 2 * 60 * 1000, now), "2m ago");
    assert.strictEqual(
      formatRelativeTime(now - 45 * 60 * 1000, now),
      "45m ago"
    );
  });

  it("formats hours ago for times under 24 hours", () => {
    assert.strictEqual(
      formatRelativeTime(now - 3 * 3600 * 1000, now),
      "3h ago"
    );
    assert.strictEqual(
      formatRelativeTime(now - 23 * 3600 * 1000, now),
      "23h ago"
    );
  });

  it("formats days ago for times over 24 hours", () => {
    assert.strictEqual(
      formatRelativeTime(now - 2 * 86400 * 1000, now),
      "2d ago"
    );
    assert.strictEqual(
      formatRelativeTime(now - 10 * 86400 * 1000, now),
      "10d ago"
    );
  });

  it("returns original string for invalid date formats", () => {
    assert.strictEqual(
      formatRelativeTime("not-a-valid-date"),
      "not-a-valid-date"
    );
  });
});

describe("formatMemoryLeafName", () => {
  it("extracts relative path after /memories/<category>/", () => {
    assert.strictEqual(
      formatMemoryLeafName(
        "viking://user/dsh/memories/preferences/user/code_style.md"
      ),
      "user/code_style.md"
    );
    assert.strictEqual(
      formatMemoryLeafName(
        "viking://user/dsh/memories/entities/project/wrench_board.md"
      ),
      "project/wrench_board.md"
    );
  });

  it("extracts leaf or last segments for other viking:// URIs", () => {
    assert.strictEqual(
      formatMemoryLeafName("viking://user/dsh/skills/wayfinder"),
      "skills/wayfinder"
    );
    assert.strictEqual(formatMemoryLeafName("viking://wayfinder"), "wayfinder");
  });

  it("returns empty string for empty input", () => {
    assert.strictEqual(formatMemoryLeafName(""), "");
  });
});

describe("formatEndpoint", () => {
  it("defaults to 127.0.0.1:1933 when missing or empty", () => {
    assert.strictEqual(formatEndpoint(), "127.0.0.1:1933");
    assert.strictEqual(formatEndpoint(""), "127.0.0.1:1933");
    assert.strictEqual(formatEndpoint("   "), "127.0.0.1:1933");
  });

  it("strips http:// and https:// prefixes", () => {
    assert.strictEqual(
      formatEndpoint("http://127.0.0.1:1933"),
      "127.0.0.1:1933"
    );
    assert.strictEqual(
      formatEndpoint("https://openviking.lan:8443"),
      "openviking.lan:8443"
    );
  });
});

describe("truncateSessionId", () => {
  it("leaves short IDs untouched", () => {
    assert.strictEqual(truncateSessionId("short-id", 16), "short-id");
  });

  it("truncates long IDs with ellipsis", () => {
    assert.strictEqual(
      truncateSessionId("dsh-session-12345678-abcdef", 16),
      "dsh-session-1234..."
    );
  });

  it("handles empty ID", () => {
    assert.strictEqual(truncateSessionId(""), "");
  });
});

describe("handleEscapeKey", () => {
  it("calls onClose and returns true when key is Escape", () => {
    let closed = false;
    const result = handleEscapeKey({ key: "Escape" }, () => {
      closed = true;
    });
    assert.strictEqual(result, true);
    assert.strictEqual(closed, true);
  });

  it("does not call onClose and returns false for other keys", () => {
    let closed = false;
    const result = handleEscapeKey({ key: "Enter" }, () => {
      closed = true;
    });
    assert.strictEqual(result, false);
    assert.strictEqual(closed, false);
  });
});

describe("OpenVikingStatusPopover Component Rendering", () => {
  it("renders header with title, endpoint, and ONLINE badge with version", () => {
    const html = renderToString(
      React.createElement(OpenVikingStatusPopover, {
        sessionId: "session-abc-123",
        health: { ok: true, version: "0.2.1" },
        sessionData: {
          session_id: "session-abc-123",
          pending_tokens: 4500,
        },
        endpoint: "http://127.0.0.1:1933",
      })
    );

    assert.ok(html.includes("OpenViking Memory"));
    assert.ok(html.includes("127.0.0.1:1933"));
    assert.ok(html.includes("ONLINE v0.2.1"));
    assert.ok(html.includes("var(--dsw-status-success, #34d399)"));
  });

  it("renders header with OFFLINE badge when health.ok is false", () => {
    const html = renderToString(
      React.createElement(OpenVikingStatusPopover, {
        sessionId: "session-offline-1",
        health: { ok: false },
        sessionData: null,
      })
    );

    assert.ok(html.includes("OFFLINE"));
    assert.ok(html.includes("var(--dsw-status-error, #f87171)"));
  });

  it("renders session details: truncated ID, peer ID, and relative last commit", () => {
    const html = renderToString(
      React.createElement(OpenVikingStatusPopover, {
        sessionId: "dsh-session-long-identifier-12345",
        health: { ok: true },
        sessionData: {
          session_id: "dsh-session-long-identifier-12345",
          peer_id: "pet/dsh-plugins/dsh-openviking-status",
          pending_tokens: 3000,
          last_commit_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        },
      })
    );

    assert.ok(html.includes("Session ID:"));
    assert.ok(html.includes("dsh-session-long..."));
    assert.ok(html.includes("Peer ID:"));
    assert.ok(html.includes("pet/dsh-plugins/dsh-openviking-status"));
    assert.ok(html.includes("Last Commit:"));
    assert.ok(html.includes("5m ago"));
  });

  it("omits Peer ID and Last Commit when not present in sessionData", () => {
    const html = renderToString(
      React.createElement(OpenVikingStatusPopover, {
        sessionId: "simple-sess",
        health: { ok: true },
        sessionData: {
          session_id: "simple-sess",
          pending_tokens: 1000,
        },
      })
    );

    assert.ok(!html.includes("Peer ID:"));
    assert.ok(!html.includes("Last Commit:"));
  });

  it("renders progress bar with green color when below 80%", () => {
    const html = renderToString(
      React.createElement(OpenVikingStatusPopover, {
        sessionId: "sess-progress-green",
        health: { ok: true },
        sessionData: {
          session_id: "sess-progress-green",
          pending_tokens: 8000,
        },
      })
    );

    assert.ok(html.includes("8,000 / 20,000"));
    assert.ok(html.includes("width:40%"));
    assert.ok(html.includes("var(--dsw-status-success, #34d399)"));
  });

  it("renders progress bar with yellow/amber color when at or above 80%", () => {
    const html = renderToString(
      React.createElement(OpenVikingStatusPopover, {
        sessionId: "sess-progress-amber",
        health: { ok: true },
        sessionData: {
          session_id: "sess-progress-amber",
          pending_tokens: 17000,
        },
      })
    );

    assert.ok(html.includes("17,000 / 20,000"));
    assert.ok(html.includes("width:85%"));
    assert.ok(html.includes("var(--dsw-status-warning, #fbbf24)"));
  });

  it("renders empty memories message when no memories recalled", () => {
    const html = renderToString(
      React.createElement(OpenVikingStatusPopover, {
        sessionId: "sess-no-memories",
        health: { ok: true },
        sessionData: {
          session_id: "sess-no-memories",
          pending_tokens: 0,
        },
        recalledResult: {
          recalledCount: 0,
          items: [],
          profileItems: [],
          recallItems: [],
        },
      })
    );

    assert.ok(html.includes("Recalled Memories (0)"));
    assert.ok(html.includes("No memories recalled in this session"));
  });

  it("renders list of recalled memories with category badges, source badges, and leaf filenames", () => {
    const recalledResult = {
      recalledCount: 2,
      items: [
        {
          uri: "viking://user/dsh/memories/preferences/user/code_style.md",
          category: "preferences",
          source: "profile" as const,
        },
        {
          uri: "viking://user/dsh/memories/entities/project/wrench_board.md",
          category: "entities",
          source: "recall" as const,
          score: 0.92,
        },
      ],
      profileItems: [],
      recallItems: [],
    };

    const html = renderToString(
      React.createElement(OpenVikingStatusPopover, {
        sessionId: "sess-with-memories",
        health: { ok: true },
        sessionData: {
          session_id: "sess-with-memories",
          pending_tokens: 2500,
        },
        recalledResult,
      })
    );

    assert.ok(html.includes("Recalled Memories (2)"));
    assert.ok(html.includes("PREFERENCES") || html.includes("preferences"));
    assert.ok(html.includes("ENTITIES") || html.includes("entities"));
    assert.ok(html.includes("profile"));
    assert.ok(html.includes("recall"));
    assert.ok(html.includes("user/code_style.md"));
    assert.ok(html.includes("project/wrench_board.md"));
  });

  it("disables Commit button when offline, 0 pending tokens, or committing", () => {
    // 1. Offline
    const offlineHtml = renderToString(
      React.createElement(OpenVikingStatusPopover, {
        sessionId: "sess-off",
        health: { ok: false },
        sessionData: { session_id: "sess-off", pending_tokens: 5000 },
      })
    );
    assert.ok(
      offlineHtml.includes('disabled=""') || offlineHtml.includes("disabled")
    );

    // 2. 0 pending tokens
    const zeroTokensHtml = renderToString(
      React.createElement(OpenVikingStatusPopover, {
        sessionId: "sess-zero",
        health: { ok: true },
        sessionData: { session_id: "sess-zero", pending_tokens: 0 },
      })
    );
    assert.ok(
      zeroTokensHtml.includes('disabled=""') ||
        zeroTokensHtml.includes("disabled")
    );

    // 3. Committing
    const committingHtml = renderToString(
      React.createElement(OpenVikingStatusPopover, {
        sessionId: "sess-committing",
        health: { ok: true },
        sessionData: { session_id: "sess-committing", pending_tokens: 5000 },
        isCommitting: true,
      })
    );
    assert.ok(
      committingHtml.includes('disabled=""') ||
        committingHtml.includes("disabled")
    );
    assert.ok(committingHtml.includes("Committing..."));
  });

  it("enables Commit button when online with pending tokens > 0", () => {
    const readyHtml = renderToString(
      React.createElement(OpenVikingStatusPopover, {
        sessionId: "sess-ready",
        health: { ok: true },
        sessionData: { session_id: "sess-ready", pending_tokens: 5000 },
        isCommitting: false,
      })
    );

    assert.ok(readyHtml.includes("Commit To Memory Now"));
    // The button itself shouldn't have disabled attribute
    const btnMatch = readyHtml.match(
      /<button[^>]*data-testid="commit-now-btn"[^>]*>/
    );
    assert.ok(btnMatch);
    assert.ok(!btnMatch[0].includes("disabled"));
  });

  it("renders commit error message when commitError prop is provided", () => {
    const html = renderToString(
      React.createElement(OpenVikingStatusPopover, {
        sessionId: "sess-err",
        health: { ok: true },
        sessionData: { session_id: "sess-err", pending_tokens: 5000 },
        commitError: "HTTP 500: Server commit failed",
      })
    );

    assert.ok(html.includes("commit-error-message"));
    assert.ok(html.includes("HTTP 500: Server commit failed"));
  });

  it("applies custom className and custom style", () => {
    const html = renderToString(
      React.createElement(OpenVikingStatusPopover, {
        sessionId: "sess-custom",
        health: { ok: true },
        sessionData: { session_id: "sess-custom", pending_tokens: 0 },
        className: "custom-popover-class",
        style: { zIndex: 9999 },
      })
    );

    assert.ok(html.includes("custom-popover-class"));
    assert.ok(html.includes("z-index:9999") || html.includes("zIndex:9999"));
  });
});
