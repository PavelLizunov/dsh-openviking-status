import { describe, it } from "node:test";
import assert from "node:assert";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  OpenVikingStatusChip,
  formatPendingTokens,
  formatStatusLabel,
  formatTooltipTitle,
  getStatusIndicatorColor,
  getStatusGlow,
  getFallbackSessionMessages,
  apply,
} from "../lib/client.mjs";

describe("formatPendingTokens", () => {
  it("formats 0 tokens as '0k pend'", () => {
    assert.strictEqual(formatPendingTokens(0), "0k pend");
  });

  it("rounds values below 500 to '0k pend'", () => {
    assert.strictEqual(formatPendingTokens(450), "0k pend");
  });

  it("rounds values >= 500 up to '1k pend'", () => {
    assert.strictEqual(formatPendingTokens(500), "1k pend");
    assert.strictEqual(formatPendingTokens(999), "1k pend");
  });

  it("rounds thousands properly", () => {
    assert.strictEqual(formatPendingTokens(3450), "3k pend");
    assert.strictEqual(formatPendingTokens(12499), "12k pend");
    assert.strictEqual(formatPendingTokens(20000), "20k pend");
  });
});

describe("formatStatusLabel", () => {
  it("formats online status as 'OV: <recalled> rec · <pending>k pend'", () => {
    assert.strictEqual(
      formatStatusLabel(true, 12, 3450),
      "OV: 12 rec · 3k pend"
    );
    assert.strictEqual(formatStatusLabel(true, 0, 0), "OV: 0 rec · 0k pend");
    assert.strictEqual(
      formatStatusLabel(true, 5, 15200),
      "OV: 5 rec · 15k pend"
    );
  });

  it("formats offline status as 'OV offline'", () => {
    assert.strictEqual(formatStatusLabel(false, 12, 3450), "OV offline");
    assert.strictEqual(formatStatusLabel(false, 0, 0), "OV offline");
  });
});

describe("formatTooltipTitle", () => {
  it("formats tooltip when offline", () => {
    assert.strictEqual(
      formatTooltipTitle({
        isOnline: false,
        recalledCount: 12,
        pendingTokens: 3450,
      }),
      "OpenViking: Offline"
    );
  });

  it("formats tooltip when online with counts and formatted tokens", () => {
    assert.strictEqual(
      formatTooltipTitle({
        isOnline: true,
        recalledCount: 12,
        pendingTokens: 3450,
      }),
      "OpenViking: Online (12 recalled, 3,450 pending tokens)"
    );
  });

  it("formats tooltip when committing", () => {
    assert.strictEqual(
      formatTooltipTitle({
        isOnline: true,
        isCommitting: true,
        recalledCount: 12,
        pendingTokens: 3450,
      }),
      "OpenViking: Committing... (12 recalled, 3,450 pending tokens)"
    );
  });
});

describe("getStatusIndicatorColor and getStatusGlow", () => {
  it("returns error red and no glow when offline", () => {
    assert.strictEqual(
      getStatusIndicatorColor(false),
      "var(--dsw-status-error, #f87171)"
    );
    assert.strictEqual(getStatusGlow(false), "none");
  });

  it("returns warning yellow and no glow when committing", () => {
    assert.strictEqual(
      getStatusIndicatorColor(true, true),
      "var(--dsw-status-warning, #fbbf24)"
    );
    assert.strictEqual(getStatusGlow(true, true), "none");
  });

  it("returns success green and subtle glow when online", () => {
    assert.strictEqual(
      getStatusIndicatorColor(true, false),
      "var(--dsw-status-success, #34d399)"
    );
    assert.strictEqual(
      getStatusGlow(true, false),
      "0 0 6px var(--dsw-status-success, #34d399)"
    );
  });
});

describe("OpenVikingStatusChip Component Rendering", () => {
  it("renders online status with parsed recalled memories and pending tokens", () => {
    const sampleMessages = [
      {
        role: "system",
        content: `
<openviking-context source="profile">
<available-memories>
  viking://user/dsh/memories/preferences/
    - user/code_style.md
    - user/git_workflow.md
</available-memories>
</openviking-context>
        `,
      },
      {
        role: "assistant",
        content: `
<openviking-context>
<memory uri="viking://user/dsh/memories/entities/project/wrench_board.md" score="0.88">
Wrench board
</memory>
</openviking-context>
        `,
      },
    ];

    const html = renderToString(
      React.createElement(OpenVikingStatusChip, {
        sessionId: "test-session-123",
        messages: sampleMessages,
        initialHealth: { ok: true },
        initialSessionData: {
          session_id: "test-session-123",
          pending_tokens: 3450,
        },
      })
    );

    // Should display OV: and 3 rec · 3k pend (2 from profile + 1 from recall = 3)
    assert.ok(html.includes("OV:"));
    assert.ok(html.includes("3 rec · 3k pend"));
    // Dot indicator with green color and glow
    assert.ok(html.includes("var(--dsw-status-success, #34d399)"));
    assert.ok(html.includes("0 0 6px var(--dsw-status-success, #34d399)"));
    // Accessible tooltip/title
    assert.ok(
      html.includes("OpenViking: Online (3 recalled, 3,450 pending tokens)")
    );
  });

  it("renders online status with contextText prop", () => {
    const contextText = `
<openviking-context>
<memory uri="viking://item1" score="0.95" />
<memory uri="viking://item2" score="0.85" />
</openviking-context>
    `;

    const html = renderToString(
      React.createElement(OpenVikingStatusChip, {
        sessionId: "test-session-456",
        contextText,
        initialHealth: { ok: true },
        initialSessionData: {
          session_id: "test-session-456",
          pending_tokens: 1200,
        },
      })
    );

    assert.ok(html.includes("OV:"));
    assert.ok(html.includes("2 rec · 1k pend"));
  });

  it("renders offline status with red dot and 'OV offline'", () => {
    const html = renderToString(
      React.createElement(OpenVikingStatusChip, {
        sessionId: "test-session-offline",
        initialHealth: { ok: false },
      })
    );

    assert.ok(html.includes("OV"));
    assert.ok(html.includes("offline"));
    assert.ok(html.includes("var(--dsw-status-error, #f87171)"));
    assert.ok(html.includes("OpenViking: Offline"));
    // No glow when offline
    assert.ok(
      html.includes("box-shadow:none") ||
        html.includes("boxShadow:none") ||
        !html.includes("0 0 6px")
    );
  });

  it("gracefully handles zero memories: 'OV: 0 rec · 0k pend'", () => {
    const html = renderToString(
      React.createElement(OpenVikingStatusChip, {
        sessionId: "test-session-empty",
        messages: [],
        initialHealth: { ok: true },
        initialSessionData: {
          session_id: "test-session-empty",
          pending_tokens: 0,
        },
      })
    );

    assert.ok(html.includes("OV:"));
    assert.ok(html.includes("0 rec · 0k pend"));
  });

  it("applies custom className", () => {
    const html = renderToString(
      React.createElement(OpenVikingStatusChip, {
        sessionId: "test-session-class",
        className: "custom-status-chip-class",
        initialHealth: { ok: false },
      })
    );

    assert.ok(html.includes("custom-status-chip-class"));
  });

  it("renders popover dialog when initialOpen is true", () => {
    const html = renderToString(
      React.createElement(OpenVikingStatusChip, {
        sessionId: "test-session-open",
        initialOpen: true,
        initialHealth: { ok: true, version: "0.2.1" },
        initialSessionData: {
          session_id: "test-session-open",
          pending_tokens: 5000,
        },
      })
    );

    assert.ok(html.includes('aria-expanded="true"'));
    assert.ok(html.includes('role="dialog"'));
    assert.ok(html.includes("OpenViking Memory Details"));
  });

  it("does not render popover dialog when closed (default)", () => {
    const html = renderToString(
      React.createElement(OpenVikingStatusChip, {
        sessionId: "test-session-closed",
        initialHealth: { ok: true },
        initialSessionData: {
          session_id: "test-session-closed",
          pending_tokens: 5000,
        },
      })
    );

    assert.ok(html.includes('aria-expanded="false"'));
    assert.ok(!html.includes('role="dialog"'));
  });
});

describe("apply(ctx) Cordis Registration", () => {
  it("registers conversation.input.right slot and injects sessionId and messages", () => {
    let registeredTargetSlot: string | null = null;
    let registeredOptions: any = null;
    let registeredComponent: any = null;

    const mockScope = {
      slots: {
        inject: (slotName: string, callback: () => void) => {
          registeredTargetSlot = slotName;
          callback();
        },
        register: (options: any, component: any) => {
          registeredOptions = options;
          registeredComponent = component;
        },
      },
    };

    const mockCtx = {
      inject: (deps: string[], callback: (scope: any) => void) => {
        assert.deepStrictEqual(deps, ["slots"]);
        callback(mockScope);
      },
    };

    apply(mockCtx);

    assert.strictEqual(registeredTargetSlot, "conversation.input.right");
    assert.ok(registeredOptions);
    assert.strictEqual(typeof registeredOptions.inject, "function");

    // Test inject function with string sessionId and extra scope
    const injectedProps = registeredOptions.inject("sess-789", {
      messages: [{ role: "user", content: "hello" }],
      contextText: "some context",
    });

    assert.strictEqual(injectedProps.sessionId, "sess-789");
    assert.strictEqual(injectedProps.messages.length, 1);
    assert.strictEqual(injectedProps.contextText, "some context");

    // Test inject function with object sessionOrScope
    const injectedPropsObj = registeredOptions.inject({
      sessionId: "sess-abc",
      messages: [{ role: "assistant", content: "hi" }],
    });

    assert.strictEqual(injectedPropsObj.sessionId, "sess-abc");
    assert.strictEqual(injectedPropsObj.messages.length, 1);

    // Component registered is OpenVikingStatusChip
    assert.strictEqual(registeredComponent, OpenVikingStatusChip);
  });
});

describe("getFallbackSessionMessages", () => {
  it("returns undefined for empty sessionId or when window is undefined", () => {
    assert.strictEqual(getFallbackSessionMessages(""), undefined);
  });

  it("extracts messages from window.__DSH_STORE__ conversations state", () => {
    const originalWindow = (globalThis as any).window;
    try {
      const mockMessages = [{ role: "user", content: "hello from store" }];
      (globalThis as any).window = {
        __DSH_STORE__: {
          getState: () => ({
            conversations: {
              "sess-1": { messages: mockMessages },
            },
          }),
        },
      };
      const result = getFallbackSessionMessages("sess-1");
      assert.deepStrictEqual(result, mockMessages);
    } finally {
      (globalThis as any).window = originalWindow;
    }
  });

  it("extracts messages from window.__DSH_SESSION_MESSAGES__ fallback", () => {
    const originalWindow = (globalThis as any).window;
    try {
      const mockMessages = [{ role: "user", content: "hello from global map" }];
      (globalThis as any).window = {
        __DSH_SESSION_MESSAGES__: {
          "sess-2": mockMessages,
        },
      };
      const result = getFallbackSessionMessages("sess-2");
      assert.deepStrictEqual(result, mockMessages);
    } finally {
      (globalThis as any).window = originalWindow;
    }
  });
});
