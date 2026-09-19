import React, { useState, useEffect, useCallback, useRef } from "react";
import { HealthStatus, SessionStatus, SessionReadResult } from "./api";
import { themeVar } from "./theme";
import { RecalledMemoriesResult, RecalledMemoryItem } from "./recallParser";
import { COMMIT_THRESHOLD } from "./OpenVikingStatusChip";

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
  onCommitNow?: () => Promise<void> | void;
  onClose?: () => void;
  className?: string;
  style?: React.CSSProperties;
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
  if (!endpoint || !endpoint.trim()) {
    return "127.0.0.1:1933";
  }
  return endpoint.trim().replace(/^https?:\/\//, "");
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
    isOnline && sessionRead != null && sessionRead.status !== "ok";
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
      <style>{`@keyframes ov-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

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
            {formatEndpoint(endpoint)}
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
            ? "The daemon requires an API key. Set openviking_api_key in localStorage to read session counters."
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
