import test from "node:test";
import assert from "node:assert/strict";

import { OpenVikingClient } from "../lib/client.js";

/**
 * Чтение сессии: различение причин, по которым счётчики недоступны.
 *
 * Демон запускается с `auth_mode: api_key`, и тогда `/health` остаётся
 * открытым, а `/api/v1/sessions/…` отвечает 401. Раньше клиент сворачивал
 * любой не-404 в `null`, и чип рисовал зелёный индикатор рядом с нулями —
 * состояние «демон жив, но сессия нечитаема» выглядело как «накоплено ноль».
 *
 * Тесты фиксируют наблюдаемое поведение чтения, а не внутренности клиента.
 */

interface FetchCall {
  url: string;
}

/** Подменить глобальный fetch на заданный обработчик и вернуть журнал вызовов. */
function stubFetch(
  handler: (url: string) => { status: number; body?: unknown }
): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    calls.push({ url });
    const { status, body } = handler(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body ?? {},
    } as unknown as Response;
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** Идентификатор сессии в той форме, в какой его отдаёт DSH. */
const DSH_ID = "session-28330b28-2acd-4f34-8e04-9fa4bf08476c";
/** Та же сессия, как её хранит OpenViking. */
const STORED_ID = "dsh-session-28330b28-2acd-4f34-8e04-9fa4bf08476c";

test("401 сообщается как отказ авторизации, а не как отсутствие данных", async () => {
  const stub = stubFetch(() => ({
    status: 401,
    body: { error: { code: "UNAUTHENTICATED" } },
  }));
  try {
    const client = new OpenVikingClient("http://127.0.0.1:1933");
    const result = await client.readSession(DSH_ID);

    assert.equal(result.status, "unauthorized");
    assert.equal(result.session, undefined);
  } finally {
    stub.restore();
  }
});

test("успешное чтение отдаёт счётчики сессии", async () => {
  const stub = stubFetch((url) =>
    url.includes(encodeURIComponent(STORED_ID))
      ? {
          status: 200,
          body: { result: { session_id: STORED_ID, pending_tokens: 4433 } },
        }
      : { status: 404 }
  );
  try {
    const client = new OpenVikingClient("http://127.0.0.1:1933");
    const result = await client.readSession(DSH_ID);

    assert.equal(result.status, "ok");
    assert.equal(result.session?.pending_tokens, 4433);
  } finally {
    stub.restore();
  }
});

test("реальный ноль остаётся нулём, а не превращается в «нет данных»", async () => {
  const stub = stubFetch(() => ({
    status: 200,
    body: { result: { session_id: STORED_ID, pending_tokens: 0 } },
  }));
  try {
    const client = new OpenVikingClient("http://127.0.0.1:1933");
    const result = await client.readSession(DSH_ID);

    assert.equal(result.status, "ok");
    assert.equal(result.session?.pending_tokens, 0);
  } finally {
    stub.restore();
  }
});

test("неизвестная сессия отличается от отказа авторизации", async () => {
  const stub = stubFetch(() => ({ status: 404 }));
  try {
    const client = new OpenVikingClient("http://127.0.0.1:1933");
    const result = await client.readSession(DSH_ID);

    assert.equal(result.status, "missing");
  } finally {
    stub.restore();
  }
});

test("сетевой сбой отличается от отказа авторизации", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  try {
    const client = new OpenVikingClient("http://127.0.0.1:1933");
    const result = await client.readSession(DSH_ID);

    assert.equal(result.status, "unreachable");
  } finally {
    globalThis.fetch = original;
  }
});

test("идентификатор DSH резолвится без лишнего запроса", async () => {
  // `session-<uuid>` от DSH соответствует `dsh-session-<uuid>` в OpenViking.
  // Наивная склейка давала `dsh-session-session-<uuid>` — гарантированный 404
  // на каждом опросе.
  const stub = stubFetch((url) =>
    url.includes(encodeURIComponent(STORED_ID))
      ? {
          status: 200,
          body: { result: { session_id: STORED_ID, pending_tokens: 1 } },
        }
      : { status: 404 }
  );
  try {
    const client = new OpenVikingClient("http://127.0.0.1:1933");
    const result = await client.readSession(DSH_ID);

    assert.equal(result.status, "ok");
    assert.equal(
      stub.calls.length,
      1,
      `ожидался один запрос, было ${stub.calls.length}: ${stub.calls
        .map((c) => decodeURIComponent(c.url.split("/sessions/")[1] ?? c.url))
        .join(", ")}`
    );
  } finally {
    stub.restore();
  }
});

test("fetchSession сохраняет прежний контракт и отдаёт null при отказе", async () => {
  const stub = stubFetch(() => ({ status: 401 }));
  try {
    const client = new OpenVikingClient("http://127.0.0.1:1933");
    assert.equal(await client.fetchSession(DSH_ID), null);
  } finally {
    stub.restore();
  }
});
