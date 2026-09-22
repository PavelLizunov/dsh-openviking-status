import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  HealthStatus,
  SessionStatus,
  SessionReadResult,
  ExtractionBreakdown,
  ExtractionTask,
  ExecutionEvent,
  OpenVikingClient,
} from "./api";
import { themeVar } from "./theme";
import { RecalledMemoriesResult, RecalledMemoryItem } from "./recallParser";
import { COMMIT_THRESHOLD, WarningGlyph } from "./OpenVikingStatusChip";

/**
 * `require`, который модульная система DSH передаёт фабрике бандла. Объявлен
 * здесь, потому что пакет собирается для браузера и типов Node не подключает.
 */
declare const require: ((specifier: string) => any) | undefined;

/**
 * Иконки DSH, доступные клиентскому плагину.
 *
 * Зависимости приходят через `require` внутри фабрики бандла — тем же путём,
 * что и react. Если пакет почему-то недоступен, иконка молча опускается:
 * отсутствие декоративного глифа лучше сломанной панели.
 */
function dshIcon(name: string): React.ComponentType<{ size?: number }> | null {
  try {
    const primitives =
      typeof require === "function"
        ? require("@deepseek-ai/dsh-client-ui-primitives")
        : null;
    const icon = primitives?.[name];
    return typeof icon === "function" ? icon : null;
  } catch {
    return null;
  }
}

export interface OpenVikingStatusPopoverProps {
  sessionId: string;
  health: HealthStatus | null;
  sessionData: SessionStatus | null;
  /** Исход чтения сессии: отличает «нет доступа» от «накоплено ноль». */
  sessionRead?: SessionReadResult | null;
  recalledResult?: RecalledMemoriesResult;
  endpoint?: string;
  isCommitting?: boolean;
  commitError?: string | null;
  /** Разбивка задач Phase 2 (Memory Extraction) текущей сессии. */
  breakdown?: ExtractionBreakdown | null;
  /** Клиент для ленивой загрузки `execution_events` в «Show log». */
  client?: OpenVikingClient;
  onCommitNow?: () => Promise<void> | void;
  onClose?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Длительность задачи между двумя таймстампами, человекочитаемо (`4.2s`, `1m 12s`).
 */
export function formatDuration(
  startIso?: string,
  endIso?: string
): string | undefined {
  if (!startIso || !endIso) return undefined;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (isNaN(start) || isNaN(end) || end < start) return undefined;
  const ms = end - start;
  const sec = ms / 1000;
  if (sec < 60) {
    return `${sec < 10 ? sec.toFixed(1) : Math.round(sec)}s`;
  }
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}

/**
 * Строка last extraction для завершённой задачи:
 * `<write> written, <edit> edited · <duration> · <relative-time>`.
 *
 * Части опускаются, если данных нет: длительность требует обоих таймстампов,
 * относительное время — `updated_at`.
 */
export function formatExtractionSummary(
  task: ExtractionTask,
  now: number = Date.now()
): string {
  const write = task.memory_write ?? 0;
  const edit = task.memory_edit ?? 0;
  const parts: string[] = [`${write} written, ${edit} edited`];
  const duration = formatDuration(task.created_at, task.updated_at);
  if (duration) parts.push(duration);
  const rel = formatRelativeTime(task.updated_at, now);
  if (rel) parts.push(rel);
  return parts.join(" · ");
}

/**
 * Строка backlog `N pending / M failed`, только когда хвост непуст.
 * Возвращает `null`, когда всё завершено (строку рисовать не нужно).
 */
export function formatBacklog(
  breakdown?: ExtractionBreakdown | null
): string | null {
  if (!breakdown) return null;
  const { pending, failed } = breakdown;
  if (pending <= 0 && failed <= 0) return null;
  const parts: string[] = [];
  if (pending > 0) parts.push(`${pending} pending`);
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(" / ");
}

/**
 * Сводка по выполняемой задаче: количество активных/в очереди, короткий ID и таймер.
 */
export function formatExtractionRunningInfo(
  breakdown: ExtractionBreakdown,
  elapsedSec: number
): {
  taskLabel: string;
  timerLabel: string;
} {
  const active = breakdown.running;
  const pending = breakdown.pending;
  const shortId = breakdown.firstRunning?.task_id
    ? `#${breakdown.firstRunning.task_id.replace(/^task-/, "").slice(0, 8)}`
    : null;

  const queuePart = `${active} active${pending > 0 ? `, ${pending} queued` : ""}`;
  const taskLabel = shortId ? `${queuePart} (${shortId})` : queuePart;

  const lastDuration = breakdown.lastCompleted
    ? formatDuration(
        breakdown.lastCompleted.created_at,
        breakdown.lastCompleted.updated_at
      )
    : undefined;

  const timerLabel = `${elapsedSec}s${lastDuration ? ` (last ~${lastDuration})` : ""}`;

  return { taskLabel, timerLabel };
}

/**
 * Расчет процента заполнения пула накопленных токенов (0% - 100%).
 */
export function getProgressBarPercent(
  pendingTokens: number,
  threshold: number = COMMIT_THRESHOLD
): number {
  if (!threshold || threshold <= 0) return 0;
  const ratio = (pendingTokens || 0) / threshold;
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}

/**
 * Цветовой сдвиг шкалы токенов: предупреждение при приближении к порогу.
 */
export function getProgressBarColor(percent: number): string {
  if (percent >= 80) {
    return themeVar("stateWarning");
  }
  return themeVar("stateSuccess");
}

/**
 * Версия демона для показа в бейдже.
 *
 * OpenViking отдаёт `version` уже с префиксом (`v0.4.20`), а собственный `v`
 * сверху давал `vv0.4.20`. Нормализуем, а не срезаем: префикс добавляется
 * только если его нет, поэтому оба соглашения демона выглядят одинаково.
 */
export function formatDaemonVersion(version?: string): string | undefined {
  const value = version?.trim();
  if (!value) return undefined;
  return /^v/i.test(value) ? value : `v${value}`;
}

/**
 * Форматирование относительного времени для метки последнего коммита (например, "2m ago").
 */
export function formatRelativeTime(
  isoOrTimestamp?: string | number | null,
  now: number = Date.now()
): string | undefined {
  if (!isoOrTimestamp) return undefined;
  const date = new Date(isoOrTimestamp);
  const time = date.getTime();
  if (isNaN(time)) return String(isoOrTimestamp);

  const diffMs = now - time;
  if (diffMs < 0) return "just now";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;

  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

/**
 * Извлечение имени конечного файла или относительного пути из viking:// URI.
 */
export function formatMemoryLeafName(uri: string): string {
  if (!uri) return "";
  const clean = uri.replace(/^viking:\/\/?/i, "");
  const memMatch = clean.match(/memories\/[^/]+\/(.+)$/i);
  if (memMatch && memMatch[1]) {
    return memMatch[1];
  }
  const segments = clean.split("/").filter(Boolean);
  if (segments.length >= 2) {
    return segments.slice(-2).join("/");
  }
  return segments[0] || clean;
}

/**
 * Форматирование адреса эндпоинта для отображения (удаляет протокол).
 */
export function formatEndpoint(endpoint?: string): string {
  if (!endpoint || !endpoint.trim() || endpoint.startsWith("/")) {
    return "127.0.0.1:1933";
  }
  return endpoint
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

/**
 * Усечение идентификатора сессии для компактного отображения.
 */
export function truncateSessionId(id: string, maxLen: number = 16): string {
  if (!id) return "";
  if (id.length <= maxLen) return id;
  return `${id.slice(0, maxLen)}...`;
}

/**
 * Стиль бейджа категории.
 *
 * Эталонная панель DSH не кодирует категории цветом, а подходящих цветовых
 * свойств тема не объявляет — поэтому все бейджи одинаковые и приглушённые.
 */
export function getCategoryBadgeStyle(_category?: string): React.CSSProperties {
  return { color: themeVar("labelTertiary") };
}

/**
 * Обработка нажатия клавиши Escape для закрытия панели.
 */
export function handleEscapeKey(
  event: { key: string },
  onClose?: () => void
): boolean {
  if (event.key === "Escape") {
    onClose?.();
    return true;
  }
  return false;
}

/**
 * Блок Phase 2 (Memory Extraction) рядом с `Commit Now`.
 *
 * - `running` → indeterminate-бар + `Extracting…` (без фейкового процента).
 * - `completed` → строка last extraction + ровная зелёная точка.
 * - backlog `N pending / M failed` — только когда хвост непуст.
 * - `failed` → warning-глиф + текст ошибки.
 * - «Show log» лениво тянет `execution_events` и рендерит ленту переходов.
 *
 * Глобальную очередь демона (Requeued и т.п.) блок не показывает намеренно.
 */
export function ExtractionSection({
  breakdown,
  client,
}: {
  breakdown?: ExtractionBreakdown | null;
  client?: OpenVikingClient;
}) {
  const [showLog, setShowLog] = useState(false);
  const [events, setEvents] = useState<ExecutionEvent[] | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [loadingLog, setLoadingLog] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const isRunning = (breakdown?.running ?? 0) >= 1;

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isRunning]);

  if (!breakdown) return null;

  const lastCompleted = breakdown.lastCompleted;
  const lastFailed = breakdown.lastFailed;
  const backlog = formatBacklog(breakdown);
  const failedActive = !isRunning && breakdown.failed >= 1;

  const startedMs = breakdown.firstRunning?.created_at
    ? new Date(breakdown.firstRunning.created_at).getTime()
    : null;
  const elapsedSec =
    startedMs && !Number.isNaN(startedMs)
      ? Math.max(0, Math.floor((now - startedMs) / 1000))
      : 0;
  const runningInfo = formatExtractionRunningInfo(breakdown, elapsedSec);

  // Задача для «Show log»: то, что показано в блоке — живое извлечение важнее
  // прошлых итогов, поэтому running-задача имеет приоритет. Так лента
  // `created → running → …` доступна прямо во время извлечения.
  const logTaskId =
    (isRunning ? breakdown.firstRunning?.task_id : null) ??
    (failedActive ? lastFailed?.task_id : null) ??
    lastCompleted?.task_id ??
    lastFailed?.task_id ??
    null;

  const mutedStyle: React.CSSProperties = { color: themeVar("labelTertiary") };

  const toggleLog = useCallback(async () => {
    const next = !showLog;
    setShowLog(next);
    if (next && events === null && logTaskId && client) {
      setLoadingLog(true);
      setLogError(null);
      const res = await client.fetchTaskEvents(logTaskId);
      setLoadingLog(false);
      if (res.status === "ok") {
        setEvents(res.events);
      } else {
        setLogError(
          res.status === "unauthorized"
            ? "No access to task log"
            : "Could not load log"
        );
      }
    }
  }, [showLog, events, logTaskId, client]);

  // Ничего показывать не нужно: нет активной задачи, хвоста и завершённых.
  if (!isRunning && !failedActive && !lastCompleted && !backlog) {
    return null;
  }

  return (
    <div data-testid="extraction-section" style={{ marginBottom: "12px" }}>
      <div
        style={{
          marginBottom: "4px",
          color: themeVar("labelPrimary"),
          fontWeight: 500,
        }}
      >
        Memory Extraction
      </div>

      {isRunning ? (
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "4px",
              gap: "8px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                minWidth: 0,
              }}
            >
              <span
                data-testid="extraction-status-dot"
                aria-hidden="true"
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: themeVar("stateSuccess"),
                  animation: "ov-pulse 1.2s ease-in-out infinite",
                  flexShrink: 0,
                }}
              />
              <span data-testid="extraction-running-label">Extracting…</span>
              <span
                data-testid="extraction-task-count"
                style={{
                  ...mutedStyle,
                  fontSize: "11px",
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {runningInfo.taskLabel}
              </span>
            </div>

            <div
              data-testid="extraction-elapsed-timer"
              style={{
                ...mutedStyle,
                fontSize: "11px",
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {runningInfo.timerLabel}
            </div>
          </div>
          <div
            data-testid="extraction-indeterminate-track"
            style={{
              width: "100%",
              height: "6px",
              borderRadius: "3px",
              backgroundColor: themeVar("insetSurface"),
              overflow: "hidden",
              position: "relative",
            }}
          >
            <div
              data-testid="extraction-indeterminate-fill"
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                height: "100%",
                width: "40%",
                borderRadius: "3px",
                backgroundColor: themeVar("stateSuccess"),
                animation: "ov-indeterminate 1.2s ease-in-out infinite",
              }}
            />
          </div>
        </div>
      ) : failedActive && lastFailed ? (
        <div
          data-testid="extraction-failed-line"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            color: themeVar("stateWarning"),
          }}
        >
          <span
            aria-hidden="true"
            style={{ display: "inline-flex", flexShrink: 0 }}
          >
            <WarningGlyph size={12} testId="extraction-warning-glyph" />
          </span>
          <span data-testid="extraction-failed-text">
            {lastFailed.error || "extraction failed"}
          </span>
        </div>
      ) : lastCompleted ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span
            data-testid="extraction-status-dot"
            aria-hidden="true"
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: themeVar("stateSuccess"),
              flexShrink: 0,
            }}
          />
          <span data-testid="extraction-last-line">
            {formatExtractionSummary(lastCompleted)}
          </span>
        </div>
      ) : null}

      {backlog && (
        <div
          data-testid="extraction-backlog-line"
          style={{ ...mutedStyle, marginTop: "4px" }}
        >
          {backlog}
        </div>
      )}

      {logTaskId && client && (
        <div style={{ marginTop: "6px" }}>
          <button
            type="button"
            data-testid="extraction-show-log-btn"
            onClick={() => void toggleLog()}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              font: "inherit",
              color: themeVar("labelTertiary"),
              textDecoration: "underline",
            }}
            aria-expanded={showLog}
          >
            {showLog
              ? "Hide log"
              : events && events.length > 0
                ? `Show log (${events.length})`
                : "Show log"}
          </button>

          {showLog && (
            <div
              data-testid="extraction-log"
              style={{
                marginTop: "6px",
                display: "flex",
                flexDirection: "column",
                gap: "2px",
                maxHeight: "120px",
                overflowY: "auto",
              }}
            >
              {loadingLog && (
                <div data-testid="extraction-log-loading" style={mutedStyle}>
                  Loading…
                </div>
              )}
              {logError && (
                <div data-testid="extraction-log-error" style={mutedStyle}>
                  {logError}
                </div>
              )}
              {events && events.length === 0 && !loadingLog && !logError && (
                <div data-testid="extraction-log-empty" style={mutedStyle}>
                  No events
                </div>
              )}
              {events?.map((ev, idx) => (
                <div
                  key={`${ev.seq ?? idx}-${ev.recorded_at ?? idx}`}
                  data-testid="extraction-log-event"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "8px",
                  }}
                >
                  <span>{ev.status || ev.kind || "event"}</span>
                  <span style={mutedStyle}>
                    {formatRelativeTime(ev.recorded_at) || ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Панель детального состояния контекстной памяти OpenViking (Status Popover).
 *
 * Оформление повторяет диалог статистики сессии DSH: та же поверхность, тень,
 * радиус, отступы и кегль.
 */
export function OpenVikingStatusPopover({
  sessionId,
  health,
  sessionData,
  sessionRead,
  recalledResult,
  endpoint,
  isCommitting = false,
  commitError = null,
  breakdown = null,
  client,
  onCommitNow,
  onClose,
  className,
  style,
}: OpenVikingStatusPopoverProps) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Очистка таймера сброса статуса копирования при размонтировании
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const isOnline = health?.ok === true;
  const sessionUnreadable =
    isOnline &&
    sessionRead != null &&
    (sessionRead.status === "unauthorized" ||
      sessionRead.status === "unreachable" ||
      sessionRead.status === "error");
  const unauthorized = sessionRead?.status === "unauthorized";

  const statusColor = isOnline
    ? sessionUnreadable
      ? themeVar("stateWarning")
      : themeVar("stateSuccess")
    : themeVar("stateError");

  const displaySessionId = sessionData?.session_id || sessionId || "";
  const pendingTokens = sessionData?.pending_tokens ?? 0;
  const progressPercent = getProgressBarPercent(pendingTokens);
  const progressBarColor = getProgressBarColor(progressPercent);

  const memoryItems: RecalledMemoryItem[] = recalledResult?.items || [];
  const recalledCount = recalledResult?.recalledCount ?? memoryItems.length;

  const CopyIcon = dshIcon("IconCopyOutline16");
  const CheckIcon = dshIcon("IconCheckOutline16");

  const handleCopySessionId = useCallback(() => {
    if (!displaySessionId) return;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(displaySessionId).catch(() => {});
      setCopied(true);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 1500);
    }
  }, [displaySessionId]);

  const isCommitDisabled =
    isCommitting || !isOnline || sessionUnreadable || pendingTokens === 0;

  /** Подпись в строке «Pending Tokens». */
  const pendingLabel = sessionUnreadable
    ? "unavailable"
    : `${pendingTokens.toLocaleString()} / ${COMMIT_THRESHOLD.toLocaleString()}`;

  const rowStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  };
  const mutedStyle: React.CSSProperties = { color: themeVar("labelTertiary") };
  const monoStyle: React.CSSProperties = { fontFamily: themeVar("fontMono") };

  return (
    <div
      role="dialog"
      aria-label="OpenViking Memory Details"
      className={className}
      style={{
        position: "absolute",
        bottom: "calc(100% + 8px)",
        right: 0,
        zIndex: 1100,
        boxSizing: "border-box",
        width: "max-content",
        minWidth: "min(300px, 100vw - 24px)",
        maxWidth: "min(440px, 100vw - 24px)",
        background: themeVar("panelSurface"),
        boxShadow: themeVar("panelElevation"),
        color: themeVar("labelSecondary"),
        cursor: "default",
        border: 0,
        borderRadius: "12px",
        padding: "16px",
        fontSize: "12px",
        lineHeight: "18px",
        ...({
          "--dsw-elevation-stroke-color": themeVar("panelStroke"),
        } as React.CSSProperties),
        ...style,
      }}
    >
      <style>{`@keyframes ov-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } @keyframes ov-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.72); } } @keyframes ov-indeterminate { 0% { left: -40%; } 100% { left: 100%; } }`}</style>

      {/* Заголовок: название, эндпоинт, бейдж состояния */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "16px",
          marginBottom: "8px",
          color: themeVar("labelPrimary"),
          fontWeight: 500,
        }}
      >
        <span style={{ minWidth: 0 }}>
          OpenViking Memory{" "}
          <span
            data-testid="endpoint-label"
            style={{ ...mutedStyle, ...monoStyle, fontWeight: 400 }}
          >
            {formatEndpoint(health?.endpoint || endpoint)}
          </span>
        </span>

        <span
          data-testid="status-badge"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            color: statusColor,
            flexShrink: 0,
          }}
        >
          <span
            data-testid="status-badge-dot"
            aria-hidden="true"
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              backgroundColor: statusColor,
              flexShrink: 0,
            }}
          />
          <span>
            {isOnline
              ? [
                  "ONLINE",
                  formatDaemonVersion(health?.version),
                  sessionUnreadable ? "· no session access" : null,
                ]
                  .filter(Boolean)
                  .join(" ")
              : "OFFLINE"}
          </span>
        </span>
      </div>

      <div
        style={{
          borderTop: `.5px solid ${themeVar("hairline")}`,
          marginBottom: "10px",
        }}
        aria-hidden="true"
      />

      {/* Метаданные сессии */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          marginBottom: "10px",
        }}
      >
        <div style={rowStyle}>
          <span style={mutedStyle}>Session ID:</span>
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span
              data-testid="session-id-value"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCopySessionId();
                }
              }}
              aria-label="Click to copy Session ID"
              style={{ ...monoStyle, cursor: "pointer" }}
              title={displaySessionId}
              onClick={handleCopySessionId}
            >
              {truncateSessionId(displaySessionId)}
            </span>
            <button
              type="button"
              data-testid="copy-session-btn"
              onClick={handleCopySessionId}
              title={copied ? "Copied!" : "Copy Session ID"}
              aria-label={copied ? "Copied!" : "Copy Session ID"}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "2px",
                display: "inline-flex",
                alignItems: "center",
                color: copied
                  ? themeVar("stateSuccess")
                  : themeVar("labelTertiary"),
              }}
            >
              {copied
                ? CheckIcon && <CheckIcon size={14} />
                : CopyIcon && <CopyIcon size={14} />}
            </button>
          </span>
        </div>

        {sessionData?.peer_id && (
          <div style={rowStyle}>
            <span style={mutedStyle}>Peer ID:</span>
            <span
              data-testid="peer-id-value"
              style={{
                ...monoStyle,
                maxWidth: "180px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={sessionData.peer_id}
            >
              {sessionData.peer_id}
            </span>
          </div>
        )}

        {sessionData?.last_commit_at && (
          <div style={rowStyle}>
            <span style={mutedStyle}>Last Commit:</span>
            <span
              data-testid="last-commit-value"
              title={sessionData.last_commit_at}
            >
              {formatRelativeTime(sessionData.last_commit_at) ||
                sessionData.last_commit_at}
            </span>
          </div>
        )}
      </div>

      {/* Накопленные токены */}
      <div style={{ marginBottom: "12px" }}>
        <div style={{ ...rowStyle, marginBottom: "4px" }}>
          <span style={mutedStyle}>Pending Tokens:</span>
          <span data-testid="pending-tokens-label">{pendingLabel}</span>
        </div>
        {!sessionUnreadable && (
          <div
            data-testid="progress-bar-track"
            style={{
              width: "100%",
              height: "6px",
              borderRadius: "3px",
              backgroundColor: themeVar("insetSurface"),
              overflow: "hidden",
            }}
          >
            <div
              data-testid="progress-bar-fill"
              style={{
                width: `${progressPercent}%`,
                height: "100%",
                backgroundColor: progressBarColor,
                transition: "width 0.3s ease, background-color 0.3s ease",
              }}
            />
          </div>
        )}
      </div>

      {/* Причина недоступности счётчиков */}
      {sessionUnreadable && (
        <div
          data-testid="session-unreadable-notice"
          style={{
            marginBottom: "12px",
            color: themeVar("labelTertiary"),
          }}
        >
          {unauthorized
            ? "The daemon requires an API key. Configure it in DSH Settings → OpenViking."
            : "Session counters are unavailable right now."}
        </div>
      )}

      {/* Подмешанные воспоминания */}
      <div style={{ marginBottom: "12px" }}>
        <div
          style={{
            marginBottom: "4px",
            color: themeVar("labelPrimary"),
            fontWeight: 500,
          }}
        >
          {`Recalled Memories (${recalledCount})`}
        </div>

        {memoryItems.length === 0 ? (
          <div
            data-testid="empty-memories-message"
            style={{ ...mutedStyle, padding: "4px 0" }}
          >
            No memories recalled in this session
          </div>
        ) : (
          <div
            data-testid="recalled-memories-list"
            style={{
              maxHeight: "140px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              paddingRight: "2px",
            }}
          >
            {memoryItems.map((item, idx) => (
              <div
                key={`${item.uri}-${idx}`}
                data-testid="recalled-memory-item"
                title={item.uri}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  minWidth: 0,
                }}
              >
                <span
                  data-testid="memory-category-badge"
                  style={{
                    textTransform: "uppercase",
                    flexShrink: 0,
                    ...getCategoryBadgeStyle(item.category),
                  }}
                >
                  {item.category || "memory"}
                </span>

                <span
                  data-testid="memory-source-badge"
                  style={{ ...mutedStyle, flexShrink: 0 }}
                >
                  {item.source}
                </span>

                <span
                  data-testid="memory-leaf-name"
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                >
                  {formatMemoryLeafName(item.uri)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Phase 2: Memory Extraction */}
      <ExtractionSection breakdown={breakdown} client={client} />

      {commitError && (
        <div
          data-testid="commit-error-message"
          style={{ marginBottom: "8px", color: themeVar("stateError") }}
        >
          {commitError}
        </div>
      )}

      <button
        type="button"
        data-testid="commit-now-btn"
        onClick={() => void onCommitNow?.()}
        disabled={isCommitDisabled}
        style={{
          width: "100%",
          padding: "6px 10px",
          borderRadius: "8px",
          border: `.5px solid ${themeVar("hairline")}`,
          background: isCommitDisabled
            ? "transparent"
            : themeVar("hoverBackground"),
          color: isCommitDisabled
            ? themeVar("labelTertiary")
            : themeVar("labelPrimary"),
          cursor: isCommitDisabled ? "default" : "pointer",
          font: "inherit",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
        }}
      >
        {isCommitting ? (
          <>
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                border: `2px solid ${themeVar("stateWarning")}`,
                borderTopColor: "transparent",
                animation: "ov-spin 1s linear infinite",
              }}
            />
            <span>Committing...</span>
          </>
        ) : (
          <span>Commit To Memory Now</span>
        )}
      </button>
    </div>
  );
}
