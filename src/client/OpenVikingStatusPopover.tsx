import React, { useState, useEffect, useCallback, useRef } from "react";
import { HealthStatus, SessionStatus } from "./api";
import { RecalledMemoriesResult, RecalledMemoryItem } from "./recallParser";
import { COMMIT_THRESHOLD } from "./OpenVikingStatusChip";

export interface OpenVikingStatusPopoverProps {
  sessionId: string;
  health: HealthStatus | null;
  sessionData: SessionStatus | null;
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
 * Цветовой сдвиг шкалы токенов:
 * - зеленый (< 80%)
 * - желтый / янтарный (>= 80%)
 */
export function getProgressBarColor(percent: number): string {
  if (percent >= 80) {
    return "var(--dsw-status-warning, #fbbf24)";
  }
  return "var(--dsw-status-success, #34d399)";
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
 * Например:
 * viking://user/dsh/memories/preferences/user/code_style.md -> user/code_style.md
 * viking://user/dsh/memories/entities/project/wrench_board.md -> project/wrench_board.md
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
 * Форматирование адреса эндпоинта для отображения (удаляет протокол http:// / https://).
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
 * Получение стилей бейджа категории воспоминания.
 */
export function getCategoryBadgeStyle(category?: string): React.CSSProperties {
  switch (category?.toLowerCase()) {
    case "preferences":
      return {
        backgroundColor: "rgba(168, 85, 247, 0.15)",
        color: "var(--dsw-status-purple, #c084fc)",
      };
    case "entities":
      return {
        backgroundColor: "rgba(59, 130, 246, 0.15)",
        color: "var(--dsw-status-info, #60a5fa)",
      };
    case "skills":
      return {
        backgroundColor: "rgba(236, 72, 153, 0.15)",
        color: "var(--dsw-status-pink, #f472b6)",
      };
    case "events":
      return {
        backgroundColor: "rgba(245, 158, 11, 0.15)",
        color: "var(--dsw-status-warning, #fbbf24)",
      };
    case "resources":
      return {
        backgroundColor: "rgba(20, 184, 166, 0.15)",
        color: "var(--dsw-status-teal, #2dd4bf)",
      };
    default:
      return {
        backgroundColor: "rgba(148, 163, 184, 0.15)",
        color: "var(--dsw-text-muted, #94a3b8)",
      };
  }
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
 */
export function OpenVikingStatusPopover({
  sessionId,
  health,
  sessionData,
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
  const statusColor = isOnline
    ? "var(--dsw-status-success, #34d399)"
    : "var(--dsw-status-error, #f87171)";

  const displaySessionId = sessionData?.session_id || sessionId || "";
  const pendingTokens = sessionData?.pending_tokens ?? 0;
  const progressPercent = getProgressBarPercent(pendingTokens);
  const progressBarColor = getProgressBarColor(progressPercent);

  const memoryItems: RecalledMemoryItem[] = recalledResult?.items || [];
  const recalledCount = recalledResult?.recalledCount ?? memoryItems.length;

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

  const isCommitDisabled = isCommitting || !isOnline || pendingTokens === 0;

  return (
    <div
      role="dialog"
      aria-label="OpenViking Memory Details"
      className={className}
      style={{
        position: "absolute",
        bottom: "calc(100% + 8px)",
        right: 0,
        width: "320px",
        backgroundColor: "var(--dsw-surface-overlay, #1e293b)",
        border: "1px solid var(--dsw-border-default, #334155)",
        borderRadius: "8px",
        padding: "12px",
        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
        zIndex: 1000,
        fontSize: "12px",
        color: "var(--dsw-text-default, #f1f5f9)",
        fontFamily: "var(--dsw-font-sans, system-ui, sans-serif)",
        boxSizing: "border-box",
        ...style,
      }}
    >
      <style>{`@keyframes ov-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      {/* Header: Title, Endpoint, Status Badge */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "10px",
          paddingBottom: "8px",
          borderBottom:
            "1px solid var(--dsw-border-subtle, rgba(255, 255, 255, 0.08))",
        }}
      >
        <div>
          <div
            style={{
              fontWeight: 600,
              fontSize: "13px",
              color: "var(--dsw-text-default, #f1f5f9)",
            }}
          >
            OpenViking Memory
          </div>
          <div
            data-testid="endpoint-label"
            style={{
              fontSize: "10px",
              color: "var(--dsw-text-muted, #94a3b8)",
              fontFamily: "var(--dsw-font-mono, monospace)",
              marginTop: "1px",
            }}
          >
            {formatEndpoint(endpoint)}
          </div>
        </div>

        <div
          data-testid="status-badge"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            fontSize: "10px",
            padding: "2px 7px",
            borderRadius: "4px",
            backgroundColor: isOnline
              ? "rgba(52, 211, 153, 0.15)"
              : "rgba(248, 113, 113, 0.15)",
            color: statusColor,
            fontWeight: 600,
          }}
        >
          <span
            data-testid="status-badge-dot"
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
              ? health?.version
                ? `ONLINE v${health.version}`
                : "ONLINE"
              : "OFFLINE"}
          </span>
        </div>
      </div>

      {/* Session Details: Session ID, Peer ID, Last Commit */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          marginBottom: "10px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ color: "var(--dsw-text-muted, #94a3b8)" }}>
            Session ID:
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
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
              style={{
                fontFamily: "var(--dsw-font-mono, monospace)",
                cursor: "pointer",
              }}
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
                padding: "2px 4px",
                fontSize: "10px",
                color: copied
                  ? "var(--dsw-status-success, #34d399)"
                  : "var(--dsw-text-muted, #94a3b8)",
                borderRadius: "3px",
              }}
            >
              {copied ? "✓" : "📋"}
            </button>
          </div>
        </div>

        {sessionData?.peer_id && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ color: "var(--dsw-text-muted, #94a3b8)" }}>
              Peer ID:
            </span>
            <span
              data-testid="peer-id-value"
              style={{
                maxWidth: "180px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: "var(--dsw-font-mono, monospace)",
              }}
              title={sessionData.peer_id}
            >
              {sessionData.peer_id}
            </span>
          </div>
        )}

        {sessionData?.last_commit_at && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ color: "var(--dsw-text-muted, #94a3b8)" }}>
              Last Commit:
            </span>
            <span
              data-testid="last-commit-value"
              title={sessionData.last_commit_at}
              style={{ color: "var(--dsw-text-default, #e2e8f0)" }}
            >
              {formatRelativeTime(sessionData.last_commit_at) ||
                sessionData.last_commit_at}
            </span>
          </div>
        )}
      </div>

      {/* Pending Tokens & Progress Bar */}
      <div style={{ marginBottom: "12px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "4px",
          }}
        >
          <span style={{ color: "var(--dsw-text-muted, #94a3b8)" }}>
            Pending Tokens:
          </span>
          <span data-testid="pending-tokens-label" style={{ fontWeight: 500 }}>
            {`${pendingTokens.toLocaleString()} / ${COMMIT_THRESHOLD.toLocaleString()}`}
          </span>
        </div>
        <div
          data-testid="progress-bar-track"
          style={{
            width: "100%",
            height: "6px",
            borderRadius: "3px",
            backgroundColor: "rgba(255, 255, 255, 0.1)",
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
      </div>

      {/* Recalled Memories Section */}
      <div style={{ marginBottom: "12px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "4px",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: "11px" }}>
            {`Recalled Memories (${recalledCount})`}
          </span>
        </div>

        {memoryItems.length === 0 ? (
          <div
            data-testid="empty-memories-message"
            style={{
              padding: "8px 0",
              color: "var(--dsw-text-muted, #94a3b8)",
              fontStyle: "italic",
              fontSize: "11px",
              textAlign: "center",
            }}
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
                  padding: "4px 6px",
                  borderRadius: "4px",
                  backgroundColor: "rgba(255, 255, 255, 0.04)",
                  border:
                    "1px solid var(--dsw-border-subtle, rgba(255, 255, 255, 0.05))",
                  fontSize: "11px",
                }}
              >
                {/* Category Badge */}
                <span
                  data-testid="memory-category-badge"
                  style={{
                    fontSize: "9px",
                    fontWeight: 600,
                    padding: "1px 4px",
                    borderRadius: "3px",
                    textTransform: "uppercase",
                    flexShrink: 0,
                    ...getCategoryBadgeStyle(item.category),
                  }}
                >
                  {item.category || "memory"}
                </span>

                {/* Source Badge */}
                <span
                  data-testid="memory-source-badge"
                  style={{
                    fontSize: "9px",
                    fontWeight: 600,
                    padding: "1px 4px",
                    borderRadius: "3px",
                    textTransform: "uppercase",
                    flexShrink: 0,
                    ...(item.source === "profile"
                      ? {
                          backgroundColor: "rgba(99, 102, 241, 0.15)",
                          color: "#818cf8",
                        }
                      : {
                          backgroundColor: "rgba(16, 185, 129, 0.15)",
                          color: "var(--dsw-status-success, #34d399)",
                        }),
                  }}
                >
                  {item.source}
                </span>

                {/* Leaf Filename or Relative Path */}
                <span
                  data-testid="memory-leaf-name"
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontFamily: "var(--dsw-font-mono, monospace)",
                    color: "var(--dsw-text-default, #f1f5f9)",
                  }}
                >
                  {formatMemoryLeafName(item.uri)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Commit Error Message (if any) */}
      {commitError && (
        <div
          data-testid="commit-error-message"
          style={{
            marginBottom: "8px",
            padding: "6px 8px",
            borderRadius: "4px",
            backgroundColor: "rgba(248, 113, 113, 0.1)",
            border: "1px solid var(--dsw-status-error, #f87171)",
            color: "var(--dsw-status-error, #f87171)",
            fontSize: "11px",
            wordBreak: "break-word",
          }}
        >
          {commitError}
        </div>
      )}

      {/* Actions: Commit To Memory Now Button */}
      <button
        type="button"
        data-testid="commit-now-btn"
        onClick={() => onCommitNow?.()}
        disabled={isCommitDisabled}
        style={{
          width: "100%",
          padding: "7px 0",
          borderRadius: "6px",
          border: "1px solid var(--dsw-border-default, #475569)",
          backgroundColor: isCommitting
            ? "var(--dsw-surface-active, #334155)"
            : isCommitDisabled
              ? "rgba(255, 255, 255, 0.03)"
              : "var(--dsw-surface-base, #1e293b)",
          color: isCommitDisabled
            ? "var(--dsw-text-muted, #64748b)"
            : "var(--dsw-text-default, #f8fafc)",
          cursor: isCommitDisabled ? "not-allowed" : "pointer",
          fontWeight: 600,
          fontSize: "12px",
          transition: "all 0.15s ease",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
        }}
      >
        {isCommitting ? (
          <>
            <span
              style={{
                display: "inline-block",
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                border: "2px solid var(--dsw-status-warning, #fbbf24)",
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
