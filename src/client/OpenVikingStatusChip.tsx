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
import { OpenVikingStatusPopover } from "./OpenVikingStatusPopover";

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
  initialOpen?: boolean;
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
  initialOpen = false,
}: OpenVikingStatusChipProps) {
  const [health, setHealth] = useState<HealthStatus | null>(
    initialHealth ?? null
  );
  const [sessionData, setSessionData] = useState<SessionStatus | null>(
    initialSessionData ?? null
  );
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
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
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleCommitNow = async () => {
    if (isCommitting) return;
    setIsCommitting(true);
    setCommitError(null);
    try {
      const res = await apiClient.commitSession(sessionId, {
        keep_recent_count: 10,
      });
      if (res.ok) {
        await fetchStatus();
        onCommit?.();
      } else {
        setCommitError(res.error || "Commit failed");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCommitError(msg || "Failed to commit session");
      console.error("[dsh-openviking-status] Failed to commit session:", e);
    } finally {
      setIsCommitting(false);
    }
  };

  const isOnline = health?.ok === true;
  const pendingTokens = sessionData?.pending_tokens ?? 0;
  const pendingTokensK = Math.round(pendingTokens / 1000);
  const recalledCount = recalledResult.recalledCount;

  const statusColor = getStatusIndicatorColor(isOnline, isCommitting);
  const statusGlow = getStatusGlow(isOnline, isCommitting);
  const tooltipTitle = formatTooltipTitle({
    isOnline,
    isCommitting,
    recalledCount,
    pendingTokens,
  });

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
        aria-expanded={isOpen}
        aria-haspopup="dialog"
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
        <OpenVikingStatusPopover
          sessionId={sessionId}
          health={health}
          sessionData={sessionData}
          recalledResult={recalledResult}
          endpoint={apiClient.endpoint}
          isCommitting={isCommitting}
          commitError={commitError}
          onCommitNow={handleCommitNow}
          onClose={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}
