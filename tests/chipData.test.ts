import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";

import {
  OpenVikingStatusChip,
  chatNodesToText,
  OpenVikingClient,
} from "../lib/client.js";

/**
 * Откуда чип берёт данные.
 *
 * Обе цифры на чипе однажды застряли на нуле в живой сессии, и по разным
 * причинам. Воспоминания читались из `window.__DSH_STORE__` — глобала, которого
 * в DSH нет вовсе, так что счётчик был нулевым всегда. Токены пропадали из-за
 * того, что отказ авторизации сворачивался в «нет данных».
 *
 * Тесты проверяют наблюдаемое: что отрисовано при заданном ответе демона и
 * заданном содержимом диалога.
 */

/** Диалог с подмешанным контекстом OpenViking — как его видит клиент DSH. */
const NODES_WITH_RECALL = [
  {
    role: "user",
    content: [
      "<openviking-context>",
      '<memory uri="viking://user/dsh/memories/preferences/user/code_style.md" score="0.8">',
      "стиль кода",
      "</memory>",
      '<memory uri="viking://user/dsh/memories/entities/project/wrench_board.md" score="0.7">',
      "проект",
      "</memory>",
      "</openviking-context>",
    ].join("\n"),
  },
];

/** Заглушка стандартного пропа `useChat`: селектор поверх снимка диалога. */
function stubUseChat(nodes: unknown) {
  return (selector: (snapshot: unknown) => unknown) =>
    selector({ legacy: { nodes }, nodes });
}

/** Клиент, всегда отвечающий заданным исходом чтения сессии. */
function clientAnswering(
  health: { ok: boolean; version?: string },
  read: unknown
): OpenVikingClient {
  const client = new OpenVikingClient("http://127.0.0.1:1933");
  (client as unknown as Record<string, unknown>).checkHealth = async () =>
    health;
  (client as unknown as Record<string, unknown>).readSession = async () => read;
  (client as unknown as Record<string, unknown>).fetchSession = async () =>
    (read as { session?: unknown }).session ?? null;
  return client;
}

test("chatNodesToText вытаскивает текст из снимка диалога", () => {
  const text = chatNodesToText(NODES_WITH_RECALL);
  assert.ok(text.includes("viking://user/dsh/memories/preferences"));
  assert.ok(text.includes("wrench_board.md"));
});

test("chatNodesToText не падает на пустом и неожиданном вводе", () => {
  assert.equal(chatNodesToText(undefined), "");
  assert.equal(chatNodesToText(null), "");
  assert.equal(chatNodesToText([]), "");
  assert.equal(typeof chatNodesToText([{ nothing: true }]), "string");
});

test("счётчик воспоминаний берётся из useChat", () => {
  const html = renderToString(
    React.createElement(OpenVikingStatusChip, {
      sessionId: "session-abc",
      useChat: stubUseChat(NODES_WITH_RECALL),
      client: clientAnswering(
        { ok: true },
        { status: "ok", session: { session_id: "x", pending_tokens: 4433 } }
      ),
      initialHealth: { ok: true },
      initialSessionData: { session_id: "x", pending_tokens: 4433 },
    })
  );

  // Два разных viking:// URI в диалоге — ноль здесь означал бы, что чип снова
  // читает данные откуда-то ещё.
  assert.ok(
    html.includes("2 rec"),
    `ожидалось «2 rec» в разметке, получено: ${html}`
  );
});

test("отказ авторизации не отображается как нулевое накопление", () => {
  const html = renderToString(
    React.createElement(OpenVikingStatusChip, {
      sessionId: "session-abc",
      useChat: stubUseChat([]),
      client: clientAnswering({ ok: true }, { status: "unauthorized" }),
      initialHealth: { ok: true },
      initialSessionRead: { status: "unauthorized" },
    })
  );

  assert.ok(
    !html.includes("0k pend"),
    `нечитаемая сессия не должна выглядеть как «0k pend»: ${html}`
  );
});

test("настоящий ноль по-прежнему показывается как ноль", () => {
  const html = renderToString(
    React.createElement(OpenVikingStatusChip, {
      sessionId: "session-abc",
      useChat: stubUseChat([]),
      client: clientAnswering(
        { ok: true },
        { status: "ok", session: { session_id: "x", pending_tokens: 0 } }
      ),
      initialHealth: { ok: true },
      initialSessionData: { session_id: "x", pending_tokens: 0 },
    })
  );

  assert.ok(html.includes("0k pend"), `ожидалось «0k pend»: ${html}`);
});

test("в разметке чипа нет эмодзи", () => {
  const html = renderToString(
    React.createElement(OpenVikingStatusChip, {
      sessionId: "session-abc",
      useChat: stubUseChat(NODES_WITH_RECALL),
      client: clientAnswering(
        { ok: true },
        { status: "ok", session: { session_id: "x", pending_tokens: 100 } }
      ),
      initialHealth: { ok: true },
      initialSessionData: { session_id: "x", pending_tokens: 100 },
    })
  );

  assert.equal(
    html.match(/\p{Extended_Pictographic}/gu),
    null,
    `эмодзи зависят от платформенного шрифта и не место им в интерфейсе DSH: ${html}`
  );
});
