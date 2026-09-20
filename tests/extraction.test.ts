import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  OpenVikingClient,
  normalizeExtractionTask,
  normalizeTaskList,
  computeBreakdown,
  normalizeExecutionEvent,
  TASKS_LIMIT_CAP,
  getChipDotState,
  getDotColorForState,
  seedRunningTask,
  formatDuration,
  formatExtractionSummary,
  formatBacklog,
  ExtractionSection,
  OpenVikingStatusPopover,
  OpenVikingStatusChip,
  type ExtractionTask,
  type ExtractionBreakdown,
} from "../lib/client.js";

/**
 * Наблюдаемость Phase 2 (Memory Extraction).
 *
 * Демон отдаёт только дискретный статус задачи (`pending → running →
 * completed|failed`), без дробного прогресса. Тесты проверяют, что клиент
 * честно сводит список задач в разбивку по статусам, что точка чипа мигает
 * *строго* на `running`, и что popover рисует indeterminate/last/backlog/log
 * ровно по приёмке.
 */

// ---------------------------------------------------------------------------
// normalizeExtractionTask / normalizeTaskList
// ---------------------------------------------------------------------------

describe("normalizeExtractionTask", () => {
  it("maps a completed task with nested result.memories_extracted", () => {
    const task = normalizeExtractionTask({
      task_id: "t-1",
      status: "completed",
      resource_id: "dsh-session-abc",
      created_at: "2026-09-19T20:00:00Z",
      updated_at: "2026-09-19T20:00:12Z",
      result: {
        memories_extracted: { memory_write: 3, memory_edit: 2 },
        token_usage: { total_tokens: 5400 },
      },
    });
    assert.ok(task);
    assert.strictEqual(task!.status, "completed");
    assert.strictEqual(task!.memory_write, 3);
    assert.strictEqual(task!.memory_edit, 2);
    assert.strictEqual(task!.token_usage, 5400);
  });

  it("accepts id alias and defaults unknown status to pending", () => {
    const task = normalizeExtractionTask({ id: "t-2", status: "weird" });
    assert.ok(task);
    assert.strictEqual(task!.task_id, "t-2");
    assert.strictEqual(task!.status, "pending");
  });

  it("extracts error message from string or object error", () => {
    const a = normalizeExtractionTask({
      task_id: "t-3",
      status: "failed",
      error: "LLM provider 429",
    });
    assert.strictEqual(a!.error, "LLM provider 429");

    const b = normalizeExtractionTask({
      task_id: "t-4",
      status: "failed",
      error: { message: "upstream 502" },
    });
    assert.strictEqual(b!.error, "upstream 502");
  });

  it("returns null for entries without an id", () => {
    assert.strictEqual(normalizeExtractionTask({ status: "running" }), null);
  });
});

describe("normalizeTaskList", () => {
  it("drops malformed entries and keeps valid ones", () => {
    const tasks = normalizeTaskList([
      { task_id: "a", status: "running" },
      null,
      42,
      { status: "completed" }, // no id
      { task_id: "b", status: "completed" },
    ]);
    assert.strictEqual(tasks.length, 2);
    assert.deepStrictEqual(
      tasks.map((t) => t.task_id),
      ["a", "b"]
    );
  });

  it("returns empty array for non-array input", () => {
    assert.deepStrictEqual(normalizeTaskList(undefined), []);
    assert.deepStrictEqual(normalizeTaskList({}), []);
  });
});

// ---------------------------------------------------------------------------
// computeBreakdown — running and pending are counted separately
// ---------------------------------------------------------------------------

describe("computeBreakdown", () => {
  it("counts running and pending separately and picks newest completed/failed", () => {
    const tasks: ExtractionTask[] = [
      { task_id: "newest-completed", status: "completed", memory_write: 1 },
      { task_id: "r1", status: "running" },
      { task_id: "p1", status: "pending" },
      { task_id: "p2", status: "pending" },
      { task_id: "newest-failed", status: "failed", error: "boom" },
      { task_id: "old-completed", status: "completed" },
    ];
    const b = computeBreakdown(tasks);
    assert.strictEqual(b.running, 1);
    assert.strictEqual(b.pending, 2);
    assert.strictEqual(b.completed, 2);
    assert.strictEqual(b.failed, 1);
    assert.strictEqual(b.total, 6);
    // Список отсортирован по убыванию времени → первая встреченная — самая свежая.
    assert.strictEqual(b.lastCompleted?.task_id, "newest-completed");
    assert.strictEqual(b.lastFailed?.task_id, "newest-failed");
  });

  it("all completed → empty backlog, no lastFailed", () => {
    const b = computeBreakdown([
      { task_id: "a", status: "completed" },
      { task_id: "b", status: "completed" },
    ]);
    assert.strictEqual(b.pending, 0);
    assert.strictEqual(b.failed, 0);
    assert.strictEqual(b.lastFailed, null);
  });
});

// ---------------------------------------------------------------------------
// Chip dot state — pulse strictly on running, warning glyph on failed
// ---------------------------------------------------------------------------

describe("getChipDotState", () => {
  const mk = (over: Partial<ExtractionBreakdown>): ExtractionBreakdown => ({
    running: 0,
    pending: 0,
    completed: 0,
    failed: 0,
    total: 0,
    firstRunning: null,
    lastCompleted: null,
    lastFailed: null,
    ...over,
  });

  it("offline wins over everything", () => {
    assert.strictEqual(
      getChipDotState({
        isOnline: false,
        sessionUnreadable: false,
        breakdown: mk({ running: 2 }),
      }),
      "offline"
    );
  });

  it("busy when running >= 1", () => {
    assert.strictEqual(
      getChipDotState({
        isOnline: true,
        sessionUnreadable: false,
        breakdown: mk({ running: 1, pending: 3 }),
      }),
      "busy"
    );
  });

  it("pending-only does NOT pulse (stays online-idle)", () => {
    assert.strictEqual(
      getChipDotState({
        isOnline: true,
        sessionUnreadable: false,
        breakdown: mk({ running: 0, pending: 4 }),
      }),
      "online-idle"
    );
  });

  it("extraction-failed when a failed task exists and nothing is running", () => {
    assert.strictEqual(
      getChipDotState({
        isOnline: true,
        sessionUnreadable: false,
        breakdown: mk({ failed: 1 }),
      }),
      "extraction-failed"
    );
  });

  it("running outranks failed", () => {
    assert.strictEqual(
      getChipDotState({
        isOnline: true,
        sessionUnreadable: false,
        breakdown: mk({ running: 1, failed: 2 }),
      }),
      "busy"
    );
  });

  it("session-unreadable outranks extraction state", () => {
    assert.strictEqual(
      getChipDotState({
        isOnline: true,
        sessionUnreadable: true,
        breakdown: mk({ failed: 1 }),
      }),
      "session-unreadable"
    );
  });
});

describe("getDotColorForState", () => {
  it("failed and session-unreadable are warning; busy/idle are success; offline is error", () => {
    assert.match(getDotColorForState("extraction-failed"), /state-warn/);
    assert.match(getDotColorForState("session-unreadable"), /state-warn/);
    assert.match(getDotColorForState("busy"), /state-success/);
    assert.match(getDotColorForState("online-idle"), /state-success/);
    assert.match(getDotColorForState("offline"), /state-error/);
  });
});

describe("seedRunningTask", () => {
  it("seeds a running task for instant binding from commit task_id", () => {
    const res = seedRunningTask(null, "task-xyz", "dsh-session-abc");
    assert.strictEqual(res.status, "ok");
    if (res.status === "ok") {
      assert.strictEqual(res.breakdown.running, 1);
      assert.strictEqual(res.tasks[0].task_id, "task-xyz");
    }
  });

  it("does not duplicate a task_id already present", () => {
    const prev = seedRunningTask(null, "dup", "r");
    const again = seedRunningTask(prev, "dup", "r");
    if (again.status === "ok") {
      assert.strictEqual(again.tasks.length, 1);
    }
  });
});

// ---------------------------------------------------------------------------
// Popover formatters
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  it("sub-minute uses one decimal below 10s, whole seconds otherwise", () => {
    assert.strictEqual(
      formatDuration("2026-01-01T00:00:00Z", "2026-01-01T00:00:04.2Z"),
      "4.2s"
    );
    assert.strictEqual(
      formatDuration("2026-01-01T00:00:00Z", "2026-01-01T00:00:42Z"),
      "42s"
    );
  });

  it("minute+ format", () => {
    assert.strictEqual(
      formatDuration("2026-01-01T00:00:00Z", "2026-01-01T00:01:12Z"),
      "1m 12s"
    );
  });

  it("returns undefined for missing or reversed timestamps", () => {
    assert.strictEqual(
      formatDuration(undefined, "2026-01-01T00:00:00Z"),
      undefined
    );
    assert.strictEqual(
      formatDuration("2026-01-01T00:00:10Z", "2026-01-01T00:00:00Z"),
      undefined
    );
  });
});

describe("formatExtractionSummary", () => {
  it("builds '<w> written, <e> edited · <duration> · <relative>'", () => {
    const now = new Date("2026-01-01T00:05:00Z").getTime();
    const summary = formatExtractionSummary(
      {
        task_id: "t",
        status: "completed",
        memory_write: 4,
        memory_edit: 1,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:12Z",
      },
      now
    );
    assert.match(summary, /^4 written, 1 edited · 12s · \d+m ago$/);
  });

  it("omits duration when a timestamp is missing", () => {
    const now = new Date("2026-01-01T00:05:00Z").getTime();
    const summary = formatExtractionSummary(
      {
        task_id: "t",
        status: "completed",
        memory_write: 0,
        memory_edit: 0,
        updated_at: "2026-01-01T00:00:12Z",
      },
      now
    );
    assert.match(summary, /^0 written, 0 edited · \d+m ago$/);
  });
});

describe("formatBacklog", () => {
  it("returns null when the tail is empty (all completed)", () => {
    assert.strictEqual(
      formatBacklog({
        running: 0,
        pending: 0,
        completed: 5,
        failed: 0,
        total: 5,
        firstRunning: null,
        lastCompleted: null,
        lastFailed: null,
      }),
      null
    );
  });

  it("shows 'N pending / M failed' only for non-zero parts", () => {
    assert.strictEqual(
      formatBacklog({
        running: 1,
        pending: 4,
        completed: 0,
        failed: 2,
        total: 7,
        firstRunning: null,
        lastCompleted: null,
        lastFailed: null,
      }),
      "4 pending / 2 failed"
    );
    assert.strictEqual(
      formatBacklog({
        running: 0,
        pending: 3,
        completed: 0,
        failed: 0,
        total: 3,
        firstRunning: null,
        lastCompleted: null,
        lastFailed: null,
      }),
      "3 pending"
    );
  });
});

describe("normalizeExecutionEvent", () => {
  it("preserves seq/status/timestamps and null stage/operation/error", () => {
    const ev = normalizeExecutionEvent({
      seq: 2,
      recorded_at: "2026-01-01T00:00:05Z",
      kind: "lifecycle",
      status: "running",
    });
    assert.strictEqual(ev.seq, 2);
    assert.strictEqual(ev.status, "running");
    assert.strictEqual(ev.stage, null);
    assert.strictEqual(ev.operation, null);
  });
});

// ---------------------------------------------------------------------------
// Popover rendering — indeterminate / last / failed / backlog
// ---------------------------------------------------------------------------

const baseBreakdown = (
  over: Partial<ExtractionBreakdown>
): ExtractionBreakdown => ({
  running: 0,
  pending: 0,
  completed: 0,
  failed: 0,
  total: 0,
  firstRunning: null,
  lastCompleted: null,
  lastFailed: null,
  ...over,
});

describe("ExtractionSection rendering", () => {
  it("renders indeterminate bar + Extracting… when running", () => {
    const html = renderToString(
      React.createElement(ExtractionSection, {
        breakdown: baseBreakdown({ running: 1, pending: 2 }),
      })
    );
    assert.match(html, /Extracting/);
    assert.match(html, /extraction-indeterminate-fill/);
    // Никакого фейкового процента.
    assert.doesNotMatch(html, /width:40%[\s\S]*%<\/span>/);
  });

  it("renders last extraction line when completed", () => {
    const html = renderToString(
      React.createElement(ExtractionSection, {
        breakdown: baseBreakdown({
          completed: 1,
          lastCompleted: {
            task_id: "t",
            status: "completed",
            memory_write: 3,
            memory_edit: 1,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:08Z",
          },
        }),
      })
    );
    assert.match(html, /extraction-last-line/);
    assert.match(html, /3 written, 1 edited/);
  });

  it("renders warning glyph + error text when the last task failed", () => {
    const html = renderToString(
      React.createElement(ExtractionSection, {
        breakdown: baseBreakdown({
          failed: 1,
          lastFailed: {
            task_id: "t",
            status: "failed",
            error: "provider 429",
          },
        }),
      })
    );
    assert.match(html, /extraction-warning-glyph/);
    assert.match(html, /provider 429/);
  });

  it("shows backlog line only when the tail is non-empty", () => {
    const withTail = renderToString(
      React.createElement(ExtractionSection, {
        breakdown: baseBreakdown({ running: 1, pending: 3, failed: 1 }),
      })
    );
    assert.match(withTail, /extraction-backlog-line/);
    assert.match(withTail, /3 pending \/ 1 failed/);

    const allDone = renderToString(
      React.createElement(ExtractionSection, {
        breakdown: baseBreakdown({
          completed: 2,
          lastCompleted: { task_id: "t", status: "completed" },
        }),
      })
    );
    assert.doesNotMatch(allDone, /extraction-backlog-line/);
  });

  it("renders nothing when there is no activity, tail, or completed task", () => {
    const html = renderToString(
      React.createElement(ExtractionSection, {
        breakdown: baseBreakdown({}),
      })
    );
    assert.strictEqual(html, "");
  });

  it("offers Show log bound to the RUNNING task while extracting", () => {
    // Живое извлечение: кнопка «Show log» обязана вести к текущей задаче,
    // а не к прошлому итогу — иначе лента created→running недостижима вживую.
    const client = {
      fetchTaskEvents: async () => ({ status: "ok", task: {}, events: [] }),
    };
    const html = renderToString(
      React.createElement(ExtractionSection, {
        breakdown: baseBreakdown({
          running: 1,
          firstRunning: { task_id: "live-1", status: "running" },
        }),
        client: client as never,
      })
    );
    assert.match(html, /extraction-show-log-btn/);
    assert.match(html, /Show log/);
  });
});

describe("OpenVikingStatusPopover — extraction integration", () => {
  it("embeds the extraction section when a running breakdown is provided", () => {
    const html = renderToString(
      React.createElement(OpenVikingStatusPopover, {
        sessionId: "dsh-session-abc",
        health: { ok: true, version: "v0.4.20" },
        sessionData: {
          session_id: "dsh-session-abc",
          pending_tokens: 1000,
        },
        breakdown: baseBreakdown({ running: 1 }),
      })
    );
    assert.match(html, /extraction-section/);
    assert.match(html, /Extracting/);
  });
});

// ---------------------------------------------------------------------------
// Chip rendering — pulse on running, glyph on failed
// ---------------------------------------------------------------------------

describe("OpenVikingStatusChip — dot reflects extraction state", () => {
  it("pulses (busy) when a running task is present", () => {
    const html = renderToString(
      React.createElement(OpenVikingStatusChip, {
        sessionId: "dsh-session-abc",
        contextText: "",
        initialHealth: { ok: true },
        initialSessionData: {
          session_id: "dsh-session-abc",
          pending_tokens: 500,
        },
        initialTasksRead: {
          status: "ok",
          tasks: [{ task_id: "r", status: "running" }],
          breakdown: baseBreakdown({ running: 1 }),
        },
      })
    );
    assert.match(html, /data-dot-state="busy"/);
    assert.match(html, /ov-pulse/);
  });

  it("shows warning glyph when the last task failed and nothing runs", () => {
    const html = renderToString(
      React.createElement(OpenVikingStatusChip, {
        sessionId: "dsh-session-abc",
        contextText: "",
        initialHealth: { ok: true },
        initialSessionData: {
          session_id: "dsh-session-abc",
          pending_tokens: 500,
        },
        initialTasksRead: {
          status: "ok",
          tasks: [{ task_id: "f", status: "failed", error: "boom" }],
          breakdown: baseBreakdown({
            failed: 1,
            lastFailed: { task_id: "f", status: "failed", error: "boom" },
          }),
        },
      })
    );
    assert.match(html, /chip-warning-glyph/);
    assert.match(html, /data-dot-state="extraction-failed"/);
  });

  it("does NOT pulse when only pending tasks exist", () => {
    const html = renderToString(
      React.createElement(OpenVikingStatusChip, {
        sessionId: "dsh-session-abc",
        contextText: "",
        initialHealth: { ok: true },
        initialSessionData: {
          session_id: "dsh-session-abc",
          pending_tokens: 500,
        },
        initialTasksRead: {
          status: "ok",
          tasks: [{ task_id: "p", status: "pending" }],
          breakdown: baseBreakdown({ pending: 3 }),
        },
      })
    );
    assert.match(html, /data-dot-state="online-idle"/);
    assert.doesNotMatch(html, /ov-pulse[^}]*animation/);
  });
});

// ---------------------------------------------------------------------------
// Client listTasks / fetchTaskEvents (direct + proxy)
// ---------------------------------------------------------------------------

describe("OpenVikingClient.listTasks (direct daemon)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("resolves resource_id then queries tasks with task_type + capped limit", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      urls.push(url);
      // Session probe: dsh-session-abc resolves.
      if (url.includes("/sessions/dsh-session-abc") && !url.includes("tasks")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ session_id: "dsh-session-abc" }),
        } as Response;
      }
      if (url.includes("/api/v1/tasks?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { task_id: "r", status: "running" },
              { task_id: "p", status: "pending" },
              { task_id: "c", status: "completed" },
            ],
          }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient("http://127.0.0.1:1933");
    const res = await client.listTasks("dsh-session-abc");
    assert.strictEqual(res.status, "ok");
    if (res.status === "ok") {
      assert.strictEqual(res.breakdown.running, 1);
      assert.strictEqual(res.breakdown.pending, 1);
      assert.strictEqual(res.breakdown.completed, 1);
    }
    const taskUrl = urls.find((u) => u.includes("/api/v1/tasks?"))!;
    assert.match(taskUrl, /resource_id=dsh-session-abc/);
    assert.match(taskUrl, /task_type=session_commit/);
    assert.match(taskUrl, new RegExp(`limit=${TASKS_LIMIT_CAP}`));
  });

  it("returns missing when no candidate resolves", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 404,
        json: async () => ({}),
      }) as Response) as typeof fetch;
    const client = new OpenVikingClient("http://127.0.0.1:1933");
    const res = await client.listTasks("dsh-session-ghost");
    assert.strictEqual(res.status, "missing");
  });
});

describe("OpenVikingClient.fetchTaskEvents (direct daemon)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("requests include_events and returns normalized events", async () => {
    let captured = "";
    globalThis.fetch = (async (url: string) => {
      captured = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          task_id: "t-1",
          status: "completed",
          execution_events: {
            items: [
              {
                seq: 0,
                kind: "lifecycle",
                status: "created",
                recorded_at: "2026-01-01T00:00:00Z",
              },
              {
                seq: 1,
                kind: "lifecycle",
                status: "running",
                recorded_at: "2026-01-01T00:00:01Z",
              },
              {
                seq: 2,
                kind: "lifecycle",
                status: "completed",
                recorded_at: "2026-01-01T00:00:09Z",
              },
            ],
          },
        }),
      } as Response;
    }) as typeof fetch;

    const client = new OpenVikingClient("http://127.0.0.1:1933");
    const res = await client.fetchTaskEvents("t-1");
    assert.strictEqual(res.status, "ok");
    if (res.status === "ok") {
      assert.strictEqual(res.events.length, 3);
      assert.strictEqual(res.events[2].status, "completed");
    }
    assert.match(captured, /include_events=true/);
  });
});
