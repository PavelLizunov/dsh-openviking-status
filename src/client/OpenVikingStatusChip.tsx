import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import {
  HealthStatus,
  SessionStatus,
  OpenVikingClient,
  defaultOpenVikingClient,
} from "./api";
import { RecalledMemoriesResult, parseRecalledMemories } from "./recallParser";

export const COMMIT_THRESHOLD = 20000;

export interface OpenVikingStatusChipProps {
  sessionId: string;
  messages?: any[];
  contextText?: string;
  client?: OpenVikingClient;
  onCommit?: () => void;
  className?: string;
  initialHealth?: HealthStatus;
  initialSessionData?: SessionStatus;
}

/**
 * Форматирование количества токенов в килотокены (Math.round(tokens / 1000)k pend).
 */
export function formatPendingTokens(pendingTokens: number): string {
  const k = Math.round((pendingTokens || 0) / 1000);
  return `${k}k pend`;
}

/**
 * Формирование текстового ярлыка статусного чипа.
 * В онлайне: "OV: <recalled> rec · <pending>k pend"
 * В офлайне: "OV offline"
 */
export function formatStatusLabel(
  isOnline: boolean,
  recalledCount: number,
  pendingTokens: number
): string {
  if (!isOnline) {
    return "OV offline";
  }
  return `OV: ${recalledCount} rec · ${formatPendingTokens(pendingTokens)}`;
}

/**
 * Формирование доступного заголовка / подсказки (title / aria-label).
 */
export function formatTooltipTitle({
  isOnline,
  isCommitting = false,
  recalledCount,
  pendingTokens,
}: {
  isOnline: boolean;
  isCommitting?: boolean;
  recalledCount: number;
  pendingTokens: number;
}): string {
  if (!isOnline) {
    return "OpenViking: Offline";
  }
  const countLabel = `${recalledCount} recalled`;
  const tokenLabel = `${(pendingTokens || 0).toLocaleString()} pending tokens`;
  if (isCommitting) {
    return `OpenViking: Committing... (${countLabel}, ${tokenLabel})`;
  }
  return `OpenViking: Online (${countLabel}, ${tokenLabel})`;
}

/**
 * Определение цвета индикатора состояния:
 * - Офлайн: красный
 * - Коммит: желтый / янтарный
 * - Онлайн: зеленый
 */
export function getStatusIndicatorColor(
  isOnline: boolean,
  isCommitting: boolean = false
): string {
  if (!isOnline) {
    return "var(--dsw-status-error, #f87171)";
  }
  if (isCommitting) {
    return "var(--dsw-status-warning, #fbbf24)";
  }
  return "var(--dsw-status-success, #34d399)";
}

/**
 * Определение свечения индикатора:
 * Мягкое свечение только при статусе Online.
 */
export function getStatusGlow(
  isOnline: boolean,
  isCommitting: boolean = false
): string {
  if (isOnline && !isCommitting) {
    return "0 0 6px var(--dsw-status-success, #34d399)";
  }
  return "none";
}

/**
 * Status Chip UI-компонент отображения состояния памяти OpenViking.
 * Формат в соответствии с CONTEXT.md:
 * 🟢 OV: <recalled> rec · <pending>k pend (или OV offline при недоступности сервиса).
 */
export function OpenVikingStatusChip({
  sessionId,
  messages,
  contextText,
  client,
  onCommit,
  className,
  initialHealth,
  initialSessionData,
}: OpenVikingStatusChipProps) {
  const [health, setHealth] = useState<HealthStatus | null>(
    initialHealth ?? null
  );
  const [sessionData, setSessionData] = useState<SessionStatus | null>(
    initialSessionData ?? null
  );
  const [isOpen, setIsOpen] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const apiClient = client ?? defaultOpenVikingClient;

  // Извлечение сообщений из глобального хранилища DSH, если они не были переданы напрямую в props
  const fallbackMessages = useMemo(() => {
    if (messages || contextText) return undefined;
    if (typeof window !== "undefined") {
      const win = window as any;
      if (win.__DSH_STORE__?.getState) {
        const state = win.__DSH_STORE__.getState();
        return (
          state?.conversations?.[sessionId]?.messages ||
          state?.sessions?.[sessionId]?.messages
        );
      }
      if (win.__DSH_SESSION_MESSAGES__?.[sessionId]) {
        return win.__DSH_SESSION_MESSAGES__[sessionId];
      }
    }
    return undefined;
  }, [sessionId, messages, contextText]);

  // Объединение доступного контекста для парсинга воспоминаний
  const inputForParser = useMemo(() => {
    if (contextText && messages) {
      return [contextText, ...messages];
    }
    return contextText ?? messages ?? fallbackMessages;
  }, [contextText, messages, fallbackMessages]);

  // Парсинг воспоминаний OpenViking
  const recalledResult: RecalledMemoriesResult = useMemo(
    () => parseRecalledMemories(inputForParser),
    [inputForParser]
  );

  const fetchStatus = useCallback(async () => {
    try {
      const healthRes = await apiClient.checkHealth();
      setHealth(healthRes);

      if (!healthRes.ok) {
        return;
      }

      const session = await apiClient.fetchSession(sessionId);
      setSessionData(session);
    } catch {
      setHealth({ ok: false });
    }
  }, [sessionId, apiClient]);

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, 15000);
    return () => clearInterval(timer);
  }, [fetchStatus]);

  // Закрытие всплывающего окна при клике вне области виджета
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleCommitNow = async () => {
    if (isCommitting) return;
    setIsCommitting(true);
    try {
      const res = await apiClient.commitSession(sessionId, {
        keep_recent_count: 10,
      });
      if (res.ok) {
        await fetchStatus();
        onCommit?.();
      }
    } catch (e) {
      console.error("[dsh-openviking-status] Failed to commit session:", e);
    } finally {
      setIsCommitting(false);
    }
  };

  const isOnline = health?.ok === true;
  const pendingTokens = sessionData?.pending_tokens ?? 0;
  const pendingTokensK = Math.round(pendingTokens / 1000);
  const recalledCount = recalledResult.recalledCount;

  const progressPercent = Math.min(
    100,
    Math.round((pendingTokens / COMMIT_THRESHOLD) * 100)
  );

  const statusColor = getStatusIndicatorColor(isOnline, isCommitting);
  const statusGlow = getStatusGlow(isOnline, isCommitting);
  const tooltipTitle = formatTooltipTitle({
    isOnline,
    isCommitting,
    recalledCount,
    pendingTokens,
  });

  const displaySessionId = sessionData?.session_id || sessionId;

  return (
    <div
      className={className}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
      }}
      ref={popoverRef}
    >
      {/* Compact Status Chip */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          height: "26px",
          padding: "0 8px",
          fontSize: "12px",
          fontFamily: "var(--dsw-font-mono, monospace)",
          borderRadius: "6px",
          background: "var(--dsw-surface-base, rgba(255, 255, 255, 0.05))",
          border:
            "1px solid var(--dsw-border-subtle, rgba(255, 255, 255, 0.1))",
          color: "var(--dsw-text-muted, #94a3b8)",
          cursor: "pointer",
          transition: "all 0.15s ease",
          userSelect: "none",
        }}
        title={tooltipTitle}
        aria-label={tooltipTitle}
      >
        <span
          data-testid="status-dot"
          style={{
            width: "7px",
            height: "7px",
            borderRadius: "50%",
            backgroundColor: statusColor,
            boxShadow: statusGlow,
            flexShrink: 0,
          }}
        />
        <span
          style={{ fontWeight: 600, color: "var(--dsw-text-default, #e2e8f0)" }}
        >
          {isOnline ? "OV:" : "OV"}
        </span>{" "}
        <span>
          {isOnline
            ? `${recalledCount} rec · ${pendingTokensK}k pend`
            : "offline"}
        </span>
      </button>

      {/* Popover Details */}
      {isOpen && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            right: 0,
            width: "280px",
            backgroundColor: "var(--dsw-surface-overlay, #1e293b)",
            border: "1px solid var(--dsw-border-default, #334155)",
            borderRadius: "8px",
            padding: "12px",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
            zIndex: 1000,
            fontSize: "12px",
            color: "var(--dsw-text-default, #f1f5f9)",
            fontFamily: "var(--dsw-font-sans, system-ui, sans-serif)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "8px",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: "13px" }}>
              OpenViking Memory
            </span>
            <span
              style={{
                fontSize: "10px",
                padding: "2px 6px",
                borderRadius: "4px",
                backgroundColor: isOnline
                  ? "rgba(52, 211, 153, 0.15)"
                  : "rgba(248, 113, 113, 0.15)",
                color: statusColor,
                fontWeight: 600,
              }}
            >
              {isOnline ? "ONLINE" : "OFFLINE"}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              marginBottom: "12px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--dsw-text-muted, #94a3b8)" }}>
                Session:
              </span>
              <span style={{ fontFamily: "monospace" }}>
                {displaySessionId.slice(0, 16)}...
              </span>
            </div>

            {sessionData?.peer_id && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--dsw-text-muted, #94a3b8)" }}>
                  Peer:
                </span>
                <span
                  style={{
                    maxWidth: "160px",
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

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--dsw-text-muted, #94a3b8)" }}>
                Recalled:
              </span>
              <span>
                {recalledCount} {recalledCount === 1 ? "memory" : "memories"}
              </span>
            </div>

            <div>
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
                <span>
                  {pendingTokens.toLocaleString()} /{" "}
                  {COMMIT_THRESHOLD.toLocaleString()}
                </span>
              </div>
              <div
                style={{
                  width: "100%",
                  height: "4px",
                  borderRadius: "2px",
                  backgroundColor: "rgba(255, 255, 255, 0.1)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${progressPercent}%`,
                    height: "100%",
                    backgroundColor:
                      progressPercent > 80
                        ? "var(--dsw-status-warning, #fbbf24)"
                        : "var(--dsw-status-success, #34d399)",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCommitNow}
            disabled={isCommitting || !isOnline || pendingTokens === 0}
            style={{
              width: "100%",
              padding: "6px 0",
              borderRadius: "6px",
              border: "1px solid var(--dsw-border-default, #475569)",
              backgroundColor: isCommitting
                ? "var(--dsw-surface-active, #334155)"
                : "var(--dsw-surface-base, #1e293b)",
              color:
                pendingTokens === 0
                  ? "var(--dsw-text-muted, #64748b)"
                  : "var(--dsw-text-default, #f8fafc)",
              cursor:
                pendingTokens === 0 || !isOnline ? "not-allowed" : "pointer",
              fontWeight: 500,
              transition: "background 0.15s ease",
            }}
          >
            {isCommitting ? "Committing..." : "Commit To Memory Now"}
          </button>
        </div>
      )}
    </div>
  );
}
