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
  themeVar,
  apply,
} from "../lib/client.js";

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

describe("getStatusIndicatorColor", () => {
  // Цвета берутся из карты темы: имена свойств проверяет tests/theme.test.ts,
  // здесь фиксируется только выбор состояния.
  it("returns the error colour when offline", () => {
    assert.strictEqual(getStatusIndicatorColor(false), themeVar("stateError"));
  });

  it("returns the warning colour while committing", () => {
    assert.strictEqual(
      getStatusIndicatorColor(true, true),
      themeVar("stateWarning")
    );
  });

  it("returns the warning colour when the session cannot be read", () => {
    assert.strictEqual(
      getStatusIndicatorColor(true, false, true),
      themeVar("stateWarning")
    );
  });

  it("returns the success colour when online and idle", () => {
    assert.strictEqual(
      getStatusIndicatorColor(true, false),
      themeVar("stateSuccess")
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
    // Индикатор здоровья берёт цвет из темы. Свечения больше нет: штатные
    // чипы DSH его не рисуют.
    assert.ok(html.includes(themeVar("stateSuccess")));
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
    assert.ok(html.includes(themeVar("stateError")));
    assert.ok(html.includes("OpenViking: Offline"));
  });

  it("не рисует собственный фон и рамку, как штатные чипы DSH", () => {
    const html = renderToString(
      React.createElement(OpenVikingStatusChip, {
        sessionId: "test-session-chrome",
        initialHealth: { ok: true },
        initialSessionData: { session_id: "x", pending_tokens: 1000 },
      })
    );

    assert.ok(
      html.includes("border:none"),
      `чип обязан быть без рамки: ${html}`
    );
    assert.ok(
      html.includes("background:transparent"),
      `чип обязан быть без фона в покое: ${html}`
    );
    assert.ok(
      html.includes("border-radius:24px"),
      `радиус обязан совпадать с чипами статистики: ${html}`
    );
    assert.ok(
      html.includes("font-size:var(--dsh-content-font-size-secondary, 13px)"),
      `размер шрифта обязан совпадать со вторичным шрифтом статистики: ${html}`
    );
    assert.ok(
      html.includes('data-openviking-status="true"'),
      `чип обязан иметь атрибут data-openviking-status: ${html}`
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
  // `conversation.composer.dock` — списочный слот строки статистики под
  // композером, со скоупом сессии: `sessionId` и `useChat` приходят
  // стандартными пропами. Ячейка адресуется парой `name` + собственный `id`;
  // чужой `id` занял бы и заменил ячейку соседнего плагина.
  it("занимает собственную ячейку в conversation.composer.dock", () => {
    const injectedSlots: string[] = [];
    const registered: Array<{ options: any; component: any }> = [];
    const effectLabels: string[] = [];
    let disposedCount = 0;

    const mockCtx = {
      effect: (factory: () => () => void, label: string) => {
        effectLabels.push(label);
        const dispose = factory();
        assert.strictEqual(typeof dispose, "function");
        disposedCount++;
        dispose();
      },
      slots: {
        inject: (slotName: string, callback: () => () => void) => {
          injectedSlots.push(slotName);
          return callback();
        },
        register: (options: any, component: any) => {
          registered.push({ options, component });
          return () => {};
        },
      },
    };

    apply(mockCtx);

    assert.ok(injectedSlots.includes("conversation.composer.dock"));
    const dock = registered.find(
      (r) => r.options.name === "conversation.composer.dock"
    );
    assert.ok(dock);
    assert.strictEqual(dock!.options.id, "openviking-status");
    assert.strictEqual(typeof dock!.options.order, "number");
    assert.strictEqual(dock!.component, OpenVikingStatusChip);

    const settings = registered.find(
      (r) => r.options.name === "settings.section"
    );
    assert.ok(settings);
    assert.strictEqual(settings!.options.id, "openviking-status");

    assert.strictEqual(disposedCount, 2);
  });
});

// Тесты `getFallbackSessionMessages` удалены вместе с самой функцией: она
// читала `window.__DSH_STORE__` / `window.__DSH_SESSION_MESSAGES__` — глобалы,
// которых в DSH нет, поэтому счётчик воспоминаний всегда был нулевым. Теперь
// диалог приходит стандартным пропом `useChat`; покрытие — в
// tests/chipData.test.ts.
