import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import ReactDOM from "react-dom";
import {
  HealthStatus,
  SessionStatus,
  SessionReadResult,
  OpenVikingClient,
  defaultOpenVikingClient,
  ExtractionBreakdown,
  ExtractionTask,
  TasksReadResult,
  computeBreakdown,
} from "./api";
import { themeVar } from "./theme";
import { RecalledMemoriesResult, parseRecalledMemories } from "./recallParser";
import { OpenVikingStatusPopover } from "./OpenVikingStatusPopover";

export const COMMIT_THRESHOLD = 20000;

/** Интервалы адаптивного поллинга: покой vs активная фаза извлечения. */
export const POLL_INTERVAL_IDLE_MS = 15000;
export const POLL_INTERVAL_ACTIVE_MS = 2500;

/**
 * Состояние точки статуса (StateDot).
 *
 * - `offline` — демон недоступен (красный).
 * - `session-unreadable` — сессия за ключом, счётчики недоступны (жёлтый статичный).
 * - `busy` — идёт извлечение памяти (`running >= 1`): акцентный пульс.
 * - `extraction-failed` — последняя задача провалилась: жёлтый + warning-глиф.
 * - `online-idle` — норма (зелёный).
 *
 * Мигание завязано *строго* на `running`: `pending`-only не пульсирует.
 */
export type ChipDotState =
  | "offline"
  | "session-unreadable"
  | "busy"
  | "extraction-failed"
  | "online-idle";

/**
 * Свести состояние демона, сессии и разбивку задач Phase 2 к состоянию точки.
 *
 * Приоритет: недоступность демона → нечитаемая сессия → активное извлечение →
 * провал последней задачи → норма. Провал показываем только когда *хвост*
 * непуст (есть свежий `failed`) и при этом ничего не выполняется.
 */
export function getChipDotState({
  isOnline,
  sessionUnreadable,
  breakdown,
}: {
  isOnline: boolean;
  sessionUnreadable: boolean;
  breakdown?: ExtractionBreakdown | null;
}): ChipDotState {
  if (!isOnline) return "offline";
  if (sessionUnreadable) return "session-unreadable";
  if (breakdown && breakdown.running >= 1) return "busy";
  if (breakdown && breakdown.failed >= 1) return "extraction-failed";
  return "online-idle";
}

/**
 * Warning-глиф (circle-alert) для состояния `extraction-failed`.
 *
 * Инлайновый SVG, а не иконка из примитивов DSH: набор экспортируемых имён у
 * примитивов не гарантирован, а отсутствующий глиф молча стал бы невидимым —
 * ровно тот отказ, который прячется под работающим кодом. `currentColor`
 * наследует цвет предупреждения от родителя.
 */
export function WarningGlyph({
  size = 11,
  testId = "extraction-warning-glyph",
}: {
  size?: number;
  testId?: string;
}) {
  return (
    <svg
      data-testid={testId}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, display: "block" }}
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 5v3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11" r="0.9" fill="currentColor" />
    </svg>
  );
}

/**
 * Оптимистично добавить `running`-задачу в разбивку после коммита.
 *
 * Точка пульсирует мгновенно по `task_id` из ответа коммита; следующий опрос
 * списка заменит эту заглушку реальной задачей. Если такой `task_id` уже есть в
 * списке (гонка с опросом) — оставляем как есть.
 */
export function seedRunningTask(
  prev: TasksReadResult | null,
  taskId: string,
  resourceId?: string
): TasksReadResult {
  const existing =
    prev && prev.status === "ok" ? prev.tasks : ([] as ExtractionTask[]);
  if (existing.some((t) => t.task_id === taskId)) {
    return prev as TasksReadResult;
  }
  const seeded: ExtractionTask = {
    task_id: taskId,
    status: "running",
    resource_id: resourceId,
    updated_at: new Date().toISOString(),
  };
  const tasks = [seeded, ...existing];
  return { status: "ok", breakdown: computeBreakdown(tasks), tasks };
}

/** Цвет точки для состояния StateDot. */
export function getDotColorForState(state: ChipDotState): string {
  switch (state) {
    case "offline":
      return themeVar("stateError");
    case "session-unreadable":
    case "extraction-failed":
      return themeVar("stateWarning");
    case "busy":
      return themeVar("stateSuccess");
    case "online-idle":
    default:
      return themeVar("stateSuccess");
  }
}

/**
 * Селектор поверх снимка диалога — стандартный проп слотов со скоупом сессии.
 * Штатные чипы статистики DSH читают узлы ровно так же.
 */
export type UseChat = (selector: (snapshot: any) => any) => any;

export interface OpenVikingStatusChipProps {
  sessionId: string;
  /** Стандартный проп слота: доступ к снимку текущего диалога. */
  useChat?: UseChat;
  /** Узлы диалога напрямую — для вызова вне слота и для тестов. */
  messages?: unknown;
  /** Готовый текст диалога; приоритетнее остальных источников. */
  contextText?: string;
  client?: OpenVikingClient;
  onCommit?: () => void;
  className?: string;
  initialHealth?: HealthStatus;
  initialSessionData?: SessionStatus;
  initialSessionRead?: SessionReadResult;
  /** Стартовая разбивка задач Phase 2 — для рендера вне слота и тестов. */
  initialTasksRead?: TasksReadResult;
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
  sessionUnreadable = false,
}: {
  isOnline: boolean;
  isCommitting?: boolean;
  recalledCount: number;
  pendingTokens: number;
  sessionUnreadable?: boolean;
}): string {
  if (!isOnline) {
    return "OpenViking: Offline";
  }
  if (sessionUnreadable) {
    return "OpenViking: session unreadable — the daemon requires an API key";
  }
  const countLabel = `${recalledCount} recalled`;
  const tokenLabel = `${(pendingTokens || 0).toLocaleString()} pending tokens`;
  if (isCommitting) {
    return `OpenViking: Committing... (${countLabel}, ${tokenLabel})`;
  }
  return `OpenViking: Online (${countLabel}, ${tokenLabel})`;
}

/**
 * Состояние индикатора: офлайн, нечитаемая сессия, коммит или норма.
 */
export function getStatusIndicatorColor(
  isOnline: boolean,
  isCommitting: boolean = false,
  sessionUnreadable: boolean = false
): string {
  if (!isOnline) {
    return themeVar("stateError");
  }
  if (isCommitting || sessionUnreadable) {
    return themeVar("stateWarning");
  }
  return themeVar("stateSuccess");
}

/**
 * Извлечение текста из снимка диалога DSH.
 *
 * Узлы разнородны: текст лежит то в `content` строкой, то массивом блоков, то
 * в `text`. Парсер воспоминаний работает по тексту, поэтому снимок сводится к
 * одной строке, а неизвестные формы просто пропускаются.
 */
export function chatNodesToText(nodes: unknown): string {
  if (!nodes) return "";

  const source = Array.isArray(nodes)
    ? nodes
    : typeof nodes === "object"
      ? Object.values(nodes as Record<string, unknown>)
      : [];

  const parts: string[] = [];

  const visit = (value: unknown, depth = 0): void => {
    if (depth > 4 || value === null || value === undefined) return;
    if (typeof value === "string") {
      parts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      for (const key of ["content", "text", "data", "body"]) {
        if (key in record) visit(record[key], depth + 1);
      }
    }
  };

  for (const node of source) visit(node);

  return parts.join("\n");
}

/**
 * Status Chip: состояние памяти OpenViking в строке статистики под композером.
 *
 * Внешняя обёртка над {@link StatusChipView}: выбирает источник диалога.
 * `useChat` — стандартный проп слота и сам по себе хук, поэтому вызывать его
 * условно нельзя; развилка сделана выбором компонента, а не условием внутри
 * одного.
 */
export function OpenVikingStatusChip(props: OpenVikingStatusChipProps) {
  const { useChat, ...rest } = props;
  if (
    useChat &&
    rest.contextText === undefined &&
    rest.messages === undefined
  ) {
    // Плагин делит строку статистики с чужими ячейками, поэтому сбой чтения
    // диалога не должен уронить её целиком: граница оставляет чип живым, но
    // без счётчика воспоминаний.
    return (
      <ChatReadBoundary fallback={<StatusChipView {...rest} />}>
        <ChatBackedStatusChip useChat={useChat} {...rest} />
      </ChatReadBoundary>
    );
  }
  return <StatusChipView {...rest} />;
}

/** Граница ошибок вокруг чтения снимка диалога. */
class ChatReadBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Вариант чипа, читающий диалог из снимка слота.
 *
 * `useChat` вызывается на верхнем уровне — так же, как в штатных чипах
 * статистики DSH.
 */
function ChatBackedStatusChip({
  useChat,
  ...rest
}: OpenVikingStatusChipProps & { useChat: UseChat }) {
  // Селектор защищён от неожиданной формы снимка: сбой при чтении диалога
  // стоит счётчика воспоминаний, но не должен ронять чужую строку статистики.
  const nodes = useChat((snapshot: any) => {
    try {
      return snapshot?.legacy?.nodes !== undefined
        ? snapshot.legacy.nodes
        : snapshot?.nodes;
    } catch {
      return undefined;
    }
  });
  return <StatusChipView {...rest} messages={nodes} />;
}

/** Собственно чип: отрисовка и опрос демона. */
function StatusChipView({
  sessionId,
  messages,
  contextText,
  client,
  onCommit,
  className,
  initialHealth,
  initialSessionData,
  initialSessionRead,
  initialTasksRead,
  initialOpen = false,
}: OpenVikingStatusChipProps) {
  const [health, setHealth] = useState<HealthStatus | null>(
    initialHealth ?? null
  );
  const [sessionRead, setSessionRead] = useState<SessionReadResult | null>(
    initialSessionRead ??
      (initialSessionData
        ? { status: "ok", session: initialSessionData }
        : null)
  );
  const [tasksRead, setTasksRead] = useState<TasksReadResult | null>(
    initialTasksRead ?? null
  );
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [statsHost, setStatsHost] = useState<Element | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const apiClient = client ?? defaultOpenVikingClient;

  useEffect(() => {
    if (typeof document === "undefined") return;

    function findHost() {
      const el = document.querySelector("[data-composer-stats]");
      setStatsHost((prev) => (prev !== el ? el : prev));
    }

    findHost();

    const observer = new MutationObserver(() => {
      findHost();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Источник текста диалога: готовая строка либо переданные узлы. Вариант с
  // `useChat` живёт в отдельном компоненте: этот проп сам является хуком, и
  // вызывать его условно нельзя.
  const conversationText = useMemo(() => {
    if (typeof contextText === "string") return contextText;
    return chatNodesToText(messages);
  }, [contextText, messages]);

  const recalledResult: RecalledMemoriesResult = useMemo(
    () => parseRecalledMemories(conversationText),
    [conversationText]
  );

  const fetchStatus = useCallback(async () => {
    try {
      const healthRes = await apiClient.checkHealth();
      setHealth(healthRes);

      if (!healthRes.ok) {
        return;
      }

      const [session, tasks] = await Promise.all([
        apiClient.readSession(sessionId),
        apiClient.listTasks(sessionId),
      ]);
      setSessionRead(session);
      setTasksRead(tasks);
    } catch {
      setHealth({ ok: false });
    }
  }, [sessionId, apiClient]);

  const breakdown = tasksRead?.status === "ok" ? tasksRead.breakdown : null;
  const hasRunning = (breakdown?.running ?? 0) >= 1;

  // Адаптивный поллинг: покой 15с, активная фаза (running) ~2.5с. Терминальный
  // статус возвращает опрос к покою автоматически, потому что интервал
  // пересобирается при каждой смене `hasRunning`.
  useEffect(() => {
    fetchStatus();
    const interval = hasRunning
      ? POLL_INTERVAL_ACTIVE_MS
      : POLL_INTERVAL_IDLE_MS;
    const timer = setInterval(fetchStatus, interval);
    return () => clearInterval(timer);
  }, [fetchStatus, hasRunning]);

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
        // Мгновенная привязка: `task_id` из ответа коммита позволяет показать
        // «извлекается» сразу, не дожидаясь, пока опрос списка увидит задачу.
        if (res.task_id) {
          setTasksRead((prev) =>
            seedRunningTask(prev, res.task_id!, res.resource_id)
          );
        }
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
  const sessionData = sessionRead?.status === "ok" ? sessionRead.session : null;
  // Отказ авторизации или недоступность — это «неизвестно», а не «ноль».
  const sessionUnreadable =
    isOnline && sessionRead !== null && sessionRead.status !== "ok";
  const pendingTokens = sessionData?.pending_tokens ?? 0;
  const recalledCount = recalledResult.recalledCount;

  const rawDotState = getChipDotState({
    isOnline,
    sessionUnreadable,
    breakdown,
  });
  // Коммит в полёте — тоже активная фаза: точка должна пульсировать сразу, не
  // дожидаясь, пока следующий опрос увидит `running`-задачу. Сворачиваем это в
  // само состояние, чтобы цвет считался одной картой (getDotColorForState).
  const dotState: ChipDotState =
    isCommitting && (rawDotState === "online-idle" || rawDotState === "busy")
      ? "busy"
      : rawDotState;
  const dotBusy = dotState === "busy";
  const dotFailed = dotState === "extraction-failed";
  const statusColor = getDotColorForState(dotState);
  const tooltipTitle = formatTooltipTitle({
    isOnline,
    isCommitting,
    recalledCount,
    pendingTokens,
    sessionUnreadable,
  });

  /** Текст справа от индикатора. */
  const label = !isOnline
    ? "OV offline"
    : sessionUnreadable
      ? `OV: ${recalledCount} rec · no access`
      : `OV: ${recalledCount} rec · ${Math.round(pendingTokens / 1000)}k pend`;

  const chipElement = (
    <span
      className={className}
      data-openviking-status="true"
      style={{ minWidth: 0, display: "inline-flex", position: "relative" }}
      ref={popoverRef}
    >
      <style>{`@keyframes ov-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.72); } }`}</style>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        style={{
          boxSizing: "border-box",
          maxWidth: "100%",
          color: isHovered
            ? themeVar("labelSecondary")
            : themeVar("labelTertiary"),
          fontFamily: "var(--dsw-font-family, system-ui)",
          fontSize: "var(--dsh-content-font-size-secondary, 13px)",
          lineHeight:
            "calc(20px + var(--dsh-content-font-delta-secondary, 0px))",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          background: isHovered ? themeVar("hoverBackground") : "transparent",
          border: "none",
          borderRadius: "24px",
          alignItems: "center",
          gap: "6px",
          padding: "1px 8px",
          display: "inline-flex",
          cursor: "pointer",
        }}
        title={tooltipTitle}
        aria-label={tooltipTitle}
      >
        {dotFailed ? (
          <span
            data-testid="status-dot"
            data-dot-state={dotState}
            aria-hidden="true"
            style={{
              display: "inline-flex",
              color: statusColor,
              flexShrink: 0,
            }}
          >
            <WarningGlyph size={11} testId="chip-warning-glyph" />
          </span>
        ) : (
          <span
            data-testid="status-dot"
            data-dot-state={dotBusy ? "busy" : dotState}
            aria-hidden="true"
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: statusColor,
              flexShrink: 0,
              ...(dotBusy
                ? { animation: "ov-pulse 1.2s ease-in-out infinite" }
                : {}),
            }}
          />
        )}
        <span style={{ textOverflow: "ellipsis", minWidth: 0 }}>{label}</span>
      </button>

      {isOpen && (
        <OpenVikingStatusPopover
          sessionId={sessionId}
          health={health}
          sessionData={sessionData}
          sessionRead={sessionRead}
          recalledResult={recalledResult}
          endpoint={apiClient.endpoint}
          isCommitting={isCommitting}
          commitError={commitError}
          breakdown={breakdown}
          client={apiClient}
          onCommitNow={handleCommitNow}
          onClose={() => setIsOpen(false)}
        />
      )}
    </span>
  );

  if (statsHost && typeof document !== "undefined") {
    return ReactDOM.createPortal(chipElement, statsHost);
  }

  return (
    <div
      style={{
        maxWidth: "var(--dsh-chat-content-width, 748px)",
        boxSizing: "border-box",
        width: "100%",
        padding: "4px calc(var(--dsh-composer-side-clearance, 0px) + 16px) 0px",
        fontSize: "var(--dsh-content-font-size-secondary, 13px)",
        lineHeight: "calc(20px + var(--dsh-content-font-delta-secondary, 0px))",
        justifyContent: "center",
        gap: "12px",
        margin: "0 auto",
        display: "flex",
      }}
    >
      {chipElement}
    </div>
  );
}
