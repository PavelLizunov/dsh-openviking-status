/**
 * Клиент OpenViking Session REST API и доменные типы.
 * Поддерживает проверку здоровья сервиса, получение состояния сессии
 * с разрешением префиксов идентификаторов (dsh-session-* / dsh-*) и выполнение коммита.
 */

/**
 * Статус подключения и здоровья сервиса OpenViking
 */
export interface HealthStatus {
  ok: boolean;
  version?: string;
  storage?: string;
  endpoint?: string;
  error?: string;
}

/**
 * Состояние активной сессии OpenViking в соответствии с CONTEXT.md
 */
export interface SessionStatus {
  session_id: string;
  peer_id?: string;
  pending_tokens: number;
  message_count?: number;
  commit_count?: number;
  last_commit_at?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Параметры операции коммита сессии
 */
export interface CommitOptions {
  keep_recent_count?: number;
}

/**
 * Результат операции коммита сессии.
 *
 * Коммит двухфазный: `task_id` — идентификатор фоновой задачи Phase 2
 * (Memory Extraction). Пробрасывается из ответа демона как оптимизация —
 * позволяет чипу мгновенно привязаться к задаче, не дожидаясь опроса списка.
 */
export interface CommitResult {
  ok: boolean;
  error?: string;
  /** Идентификатор фоновой задачи извлечения (Phase 2), если демон его вернул. */
  task_id?: string;
  /** Разрешённый `resource_id` формы `dsh-session-<uuid>`. */
  resource_id?: string;
}

/**
 * Статус жизненного цикла фоновой задачи извлечения (Phase 2).
 * Дробного прогресса *внутри* задачи демон не отдаёт — только эти состояния.
 */
export type ExtractionTaskStatus =
  "pending" | "running" | "completed" | "failed";

/**
 * Одна фоновая задача Phase 2 (`task_type: session_commit`).
 *
 * Промежуточные `stage`/`operation`/`meta` демон держит пустыми (`null`/`{}`);
 * `result`/`token_usage` заполняются только по завершении.
 */
export interface ExtractionTask {
  task_id: string;
  status: ExtractionTaskStatus;
  resource_id?: string;
  created_at?: string;
  updated_at?: string;
  /** Итог завершённой задачи: сколько воспоминаний записано/отредактировано. */
  memory_write?: number;
  memory_edit?: number;
  /** Расход токенов завершённой задачи. */
  token_usage?: number;
  /** Текст ошибки для `failed`. */
  error?: string;
}

/**
 * Разбивка задач сессии по статусам. Считается на клиенте из одного списка —
 * `running` и `pending` учитываются раздельно (демон их не схлопывает).
 */
export interface ExtractionBreakdown {
  running: number;
  pending: number;
  completed: number;
  failed: number;
  total: number;
  /** Первая *выполняющаяся* задача (для «Show log» живого извлечения). */
  firstRunning: ExtractionTask | null;
  /** Последняя *завершённая* задача (для строки last extraction). */
  lastCompleted: ExtractionTask | null;
  /** Последняя *провалившаяся* задача (для warning-глифа и текста ошибки). */
  lastFailed: ExtractionTask | null;
}

/** Одно событие ленты `execution_events` задачи (для «Show log»). */
export interface ExecutionEvent {
  seq?: number;
  recorded_at?: string;
  kind?: string;
  status?: string;
  stage?: string | null;
  operation?: string | null;
  error?: string | null;
}

/** Исход чтения списка задач сессии. */
export type TasksReadResult =
  | { status: "ok"; breakdown: ExtractionBreakdown; tasks: ExtractionTask[] }
  | { status: "unauthorized" }
  | { status: "missing" }
  | { status: "unreachable"; detail?: string }
  | { status: "error"; detail?: string };

/** Исход чтения одной задачи с лентой событий. */
export type TaskEventsResult =
  | { status: "ok"; task: ExtractionTask; events: ExecutionEvent[] }
  | { status: "unauthorized" }
  | { status: "missing" }
  | { status: "unreachable"; detail?: string }
  | { status: "error"; detail?: string };

/** Верхняя граница `limit` списка задач у демона. */
export const TASKS_LIMIT_CAP = 200;

/**
 * Нормализовать временную метку в ISO-строку.
 *
 * Демон OpenViking отдаёт `created_at` / `updated_at` как числом секунд
 * (Unix timestamp), так и ISO-строками в `created_at_iso` / `updated_at_iso`.
 */
export function normalizeTimestamp(
  ts: unknown,
  isoFallback?: unknown
): string | undefined {
  if (typeof isoFallback === "string" && isoFallback.trim()) {
    return isoFallback.trim();
  }
  if (typeof ts === "string" && ts.trim()) {
    return ts.trim();
  }
  if (typeof ts === "number" && Number.isFinite(ts) && ts > 0) {
    const ms = ts < 1e11 ? ts * 1000 : ts;
    return new Date(ms).toISOString();
  }
  return undefined;
}

/**
 * Извлечь массив сырых задач из ответа демона OpenViking.
 *
 * OpenViking GET /api/v1/tasks возвращает `{ status: "ok", result: [ ... ] }`,
 * где `result` — сам массив задач. Также поддерживаются варианты с `items`,
 * `tasks`, вложенным `result.items` или плоским массивом в корне.
 */
export function extractTaskList(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data)) return data;
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.result)) return obj.result;
  if (Array.isArray(obj.items)) return obj.items;
  if (Array.isArray(obj.tasks)) return obj.tasks;
  if (obj.result && typeof obj.result === "object") {
    const res = obj.result as Record<string, unknown>;
    if (Array.isArray(res.items)) return res.items;
    if (Array.isArray(res.tasks)) return res.tasks;
  }
  return [];
}

/**
 * Привести сырую задачу демона к {@link ExtractionTask}.
 *
 * `result` завершённой задачи несёт `memories_extracted{memory_write,memory_edit}`
 * и `token_usage`; форма может лежать как в корне, так и во вложенном `result`.
 */
export function normalizeExtractionTask(
  raw: Record<string, unknown>
): ExtractionTask | null {
  if (!raw || typeof raw !== "object") return null;
  const taskId =
    (typeof raw.task_id === "string" && raw.task_id) ||
    (typeof raw.id === "string" && raw.id) ||
    "";
  if (!taskId) return null;

  const statusRaw = typeof raw.status === "string" ? raw.status : "";
  const status: ExtractionTaskStatus =
    statusRaw === "running" ||
    statusRaw === "pending" ||
    statusRaw === "completed" ||
    statusRaw === "failed"
      ? statusRaw
      : "pending";

  const result = (raw.result ?? {}) as Record<string, unknown>;
  const extracted = (result.memories_extracted ?? {}) as Record<
    string,
    unknown
  >;
  const numberOf = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;

  const tokenUsageRaw = (result.token_usage ?? raw.token_usage) as
    Record<string, unknown> | number | undefined;
  const tokenUsage =
    typeof tokenUsageRaw === "number"
      ? tokenUsageRaw
      : numberOf(
          (tokenUsageRaw as Record<string, unknown> | undefined)?.total_tokens
        );

  const errorRaw = raw.error;
  const errorMsg =
    typeof errorRaw === "string"
      ? errorRaw
      : typeof (errorRaw as Record<string, unknown>)?.message === "string"
        ? ((errorRaw as Record<string, unknown>).message as string)
        : undefined;

  return {
    task_id: taskId,
    status,
    resource_id:
      typeof raw.resource_id === "string" ? raw.resource_id : undefined,
    created_at: normalizeTimestamp(raw.created_at, raw.created_at_iso),
    updated_at: normalizeTimestamp(raw.updated_at, raw.updated_at_iso),
    memory_write: numberOf(extracted.memory_write ?? extracted.written),
    memory_edit: numberOf(extracted.memory_edit ?? extracted.edited),
    token_usage: tokenUsage,
    error: errorMsg,
  };
}

/**
 * Свести список задач в разбивку по статусам.
 *
 * Список приходит отсортированным по убыванию времени, поэтому первая
 * `completed`/`failed` — самая свежая. `running` и `pending` считаются
 * раздельно: мигание чипа завязано строго на `running`, backlog — на
 * `pending`/`failed`.
 */
export function computeBreakdown(tasks: ExtractionTask[]): ExtractionBreakdown {
  const b: ExtractionBreakdown = {
    running: 0,
    pending: 0,
    completed: 0,
    failed: 0,
    total: tasks.length,
    firstRunning: null,
    lastCompleted: null,
    lastFailed: null,
  };
  for (const t of tasks) {
    if (t.status === "running") {
      b.running += 1;
      if (!b.firstRunning) b.firstRunning = t;
    } else if (t.status === "pending") b.pending += 1;
    else if (t.status === "completed") {
      b.completed += 1;
      if (!b.lastCompleted) b.lastCompleted = t;
    } else if (t.status === "failed") {
      b.failed += 1;
      if (!b.lastFailed) b.lastFailed = t;
    }
  }
  return b;
}

/** Нормализовать одно сырое событие ленты `execution_events`. */
export function normalizeExecutionEvent(
  raw: Record<string, unknown>
): ExecutionEvent {
  return {
    seq: typeof raw.seq === "number" ? raw.seq : undefined,
    recorded_at: normalizeTimestamp(raw.recorded_at, raw.recorded_at_iso),
    kind: typeof raw.kind === "string" ? raw.kind : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
    stage: typeof raw.stage === "string" ? raw.stage : null,
    operation: typeof raw.operation === "string" ? raw.operation : null,
    error: typeof raw.error === "string" ? raw.error : null,
  };
}

/**
 * Исход попытки прочитать сессию.
 *
 * Причина неудачи важна: при `auth_mode: api_key` демон отвечает на `/health`
 * и отказывает на сессии, и «нечитаемо» нельзя показывать как «накоплено ноль».
 */
export type SessionReadResult =
  /** Сессия прочитана. */
  | { status: "ok"; session: SessionStatus }
  /** Демон требует ключ, которого у клиента нет. */
  | { status: "unauthorized" }
  /** Демон не знает такой сессии. */
  | { status: "missing" }
  /** До демона не удалось достучаться. */
  | { status: "unreachable"; detail?: string }
  /** Демон ответил ошибкой или неожиданным телом. */
  | { status: "error"; detail?: string };

/**
 * Синонимы доменных понятий из CONTEXT.md
 */
export type PendingTokens = number;
export type PeerId = string;

/**
 * Базовый URL по умолчанию для локального демона OpenViking
 */
export const DEFAULT_OPENVIKING_ENDPOINT = "http://127.0.0.1:1933";

/**
 * Относительный маршрут хостового прокси на DSH Web Server
 */
export const PROXY_OPENVIKING_ENDPOINT = "/openviking-status/api";

/**
 * Определение эндпоинта OpenViking из параметров, глобального контекста или localStorage
 */
export function resolveEndpoint(endpoint?: string): string {
  if (endpoint && endpoint.trim().length > 0) {
    return endpoint.trim().replace(/\/+$/, "");
  }

  if (typeof window !== "undefined") {
    const win = window as unknown as Record<string, unknown>;
    if (
      typeof win.__OPENVIKING_ENDPOINT__ === "string" &&
      win.__OPENVIKING_ENDPOINT__.trim()
    ) {
      return win.__OPENVIKING_ENDPOINT__.trim().replace(/\/+$/, "");
    }
    // В браузере внутри DSH запросы по умолчанию всегда идут через хостовый прокси
    return PROXY_OPENVIKING_ENDPOINT;
  }

  if (typeof localStorage !== "undefined") {
    try {
      const stored =
        localStorage.getItem("openviking_endpoint") ||
        localStorage.getItem("OPENVIKING_ENDPOINT");
      if (stored && stored.trim()) {
        return stored.trim().replace(/\/+$/, "");
      }
    } catch {
      // Игнорируем ошибки доступа к хранилищу (security sandbox, incognito)
    }
  }

  return DEFAULT_OPENVIKING_ENDPOINT;
}

/**
 * Определение API-ключа из параметров, глобального контекста или localStorage
 */
export function resolveApiKey(apiKey?: string): string | undefined {
  if (apiKey && apiKey.trim().length > 0) {
    return apiKey.trim();
  }

  if (typeof window !== "undefined") {
    const win = window as unknown as Record<string, unknown>;
    if (
      typeof win.__OPENVIKING_API_KEY__ === "string" &&
      win.__OPENVIKING_API_KEY__.trim()
    ) {
      return win.__OPENVIKING_API_KEY__.trim();
    }
  }

  if (typeof localStorage !== "undefined") {
    try {
      const stored =
        localStorage.getItem("openviking_api_key") ||
        localStorage.getItem("OPENVIKING_API_KEY");
      if (stored && stored.trim()) {
        return stored.trim();
      }
    } catch {
      // Игнорируем ошибки доступа к хранилищу
    }
  }

  return undefined;
}

/**
 * Клиент REST API для взаимодействия с сессиями демона OpenViking
 */
export class OpenVikingClient {
  endpoint: string;
  apiKey?: string;
  private resolvedSessionIds = new Map<string, string>();

  constructor(endpoint?: string, apiKey?: string) {
    this.endpoint = resolveEndpoint(endpoint);
    this.apiKey = resolveApiKey(apiKey);
  }

  /**
   * Обновление конфигурации клиента на лету (например, после сохранения настроек в UI).
   */
  updateConfig(config: { endpoint?: string; apiKey?: string }): void {
    if (config.endpoint && config.endpoint.trim()) {
      this.endpoint = resolveEndpoint(config.endpoint);
    }
    if (config.apiKey !== undefined) {
      this.apiKey = resolveApiKey(config.apiKey);
    }
    this.resolvedSessionIds.clear();
  }

  /**
   * Очистить кэш разрешенных идентификаторов сессий.
   */
  clearResolvedSessions(): void {
    this.resolvedSessionIds.clear();
  }

  /**
   * Проверка, работает ли клиент через DSH Web Server proxy.
   */
  private isProxy(): boolean {
    return (
      this.endpoint.startsWith("/") ||
      this.endpoint.includes("/openviking-status/api")
    );
  }

  /**
   * Формирование заголовков запроса, включая опциональный заголовок авторизации
   */
  private getHeaders(
    customHeaders?: Record<string, string>
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...customHeaders,
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /**
   * Генерация кандидатов ID сессии для fallback-разрешения:
   * dsh-session-${id} <-> dsh-${id}
   */
  private getCandidateSessionIds(sessionId: string): string[] {
    const raw = sessionId.trim();
    const candidates: string[] = [];

    const cached = this.resolvedSessionIds.get(raw);
    if (cached) {
      candidates.push(cached);
    }

    if (raw.startsWith("dsh-session-")) {
      const suffix = raw.slice("dsh-session-".length);
      candidates.push(raw, `dsh-${suffix}`);
    } else if (raw.startsWith("dsh-")) {
      const suffix = raw.slice("dsh-".length);
      candidates.push(raw, `dsh-session-${suffix}`);
    } else if (raw.startsWith("session-")) {
      // DSH отдаёт `session-<uuid>`, OpenViking хранит `dsh-session-<uuid>`:
      // достаточно приписать `dsh-`. Общая ветка ниже добавила бы ещё один
      // `session-`, и первый запрос на каждом опросе гарантированно давал 404.
      candidates.push(`dsh-${raw}`, raw);
    } else {
      // Если префикс dsh- отсутствует, сначала пробуем dsh-session-, затем dsh-, затем исходный raw
      candidates.push(`dsh-session-${raw}`, `dsh-${raw}`, raw);
    }

    // Удаление дубликатов с сохранением порядка следования
    return Array.from(new Set(candidates));
  }

  /**
   * Проверка доступности и состояния сервиса OpenViking
   */
  async checkHealth(): Promise<HealthStatus> {
    if (this.isProxy()) {
      try {
        const res = await fetch(`${this.endpoint}/health`, {
          method: "GET",
          headers: this.getHeaders(),
        });

        if (!res.ok) {
          return {
            ok: false,
            error: `HTTP ${res.status}: ${res.statusText}`,
          };
        }

        const body = (await res.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        const isOk =
          body.ok !== false &&
          body.status !== "error" &&
          (body.ok === true ||
            body.status === "ok" ||
            body.status === "healthy" ||
            res.ok);

        return {
          ok: isOk,
          version: typeof body.version === "string" ? body.version : undefined,
          storage: typeof body.storage === "string" ? body.storage : undefined,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    try {
      const res = await fetch(`${this.endpoint}/health`, {
        method: "GET",
        headers: this.getHeaders(),
      });

      if (!res.ok) {
        return {
          ok: false,
          error: `HTTP ${res.status}: ${res.statusText}`,
        };
      }

      const body = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      const isOk =
        body.ok !== false &&
        body.status !== "error" &&
        (body.ok === true ||
          body.status === "ok" ||
          body.status === "healthy" ||
          res.ok);

      return {
        ok: isOk,
        version: typeof body.version === "string" ? body.version : undefined,
        storage: typeof body.storage === "string" ? body.storage : undefined,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Чтение метаданных сессии с явной причиной неудачи.
   *
   * Демон может работать с `auth_mode: api_key`: тогда `/health` остаётся
   * открытым, а сессия отвечает 401. Схлопывать это в «нет данных» нельзя —
   * иначе интерфейс покажет живой индикатор рядом с нулями и умолчит о том,
   * что счётчики просто недоступны.
   */
  async readSession(sessionId: string): Promise<SessionReadResult> {
    if (!sessionId || !sessionId.trim()) {
      return { status: "missing" };
    }

    if (this.isProxy()) {
      try {
        const res = await fetch(
          `${this.endpoint}/session?id=${encodeURIComponent(sessionId.trim())}`,
          {
            method: "GET",
            headers: this.getHeaders(),
          }
        );

        if (res.status === 401 || res.status === 403) {
          return { status: "unauthorized" };
        }

        if (!res.ok) {
          return { status: "error", detail: `HTTP ${res.status}` };
        }

        const data = (await res.json()) as Record<string, unknown>;
        if (data.status === "unauthorized") return { status: "unauthorized" };
        if (data.status === "missing") return { status: "missing" };
        if (data.status === "unreachable")
          return {
            status: "unreachable",
            detail: typeof data.detail === "string" ? data.detail : undefined,
          };
        if (data.status === "error")
          return {
            status: "error",
            detail: typeof data.detail === "string" ? data.detail : undefined,
          };
        if (data.status === "ok" && data.session) {
          return {
            status: "ok",
            session: data.session as SessionStatus,
          };
        }
        return { status: "error", detail: "malformed response from proxy" };
      } catch (err) {
        return {
          status: "unreachable",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }

    const candidates = this.getCandidateSessionIds(sessionId);

    for (const candidateId of candidates) {
      try {
        const res = await fetch(
          `${this.endpoint}/api/v1/sessions/${encodeURIComponent(candidateId)}`,
          {
            method: "GET",
            headers: this.getHeaders(),
          }
        );

        if (res.status === 404) {
          // Пробуем альтернативный формат идентификатора сессии
          continue;
        }

        if (res.status === 401 || res.status === 403) {
          return { status: "unauthorized" };
        }

        if (!res.ok) {
          return { status: "error", detail: `HTTP ${res.status}` };
        }

        const data = (await res.json()) as Record<string, unknown>;
        const raw = (data?.result ?? data?.data ?? data) as Record<
          string,
          unknown
        >;

        if (!raw || typeof raw !== "object") {
          return { status: "error", detail: "malformed response body" };
        }

        // Запоминаем успешно разрешенный идентификатор
        this.resolvedSessionIds.set(sessionId.trim(), candidateId);

        return {
          status: "ok",
          session: {
            session_id:
              typeof raw.session_id === "string" ? raw.session_id : candidateId,
            peer_id: typeof raw.peer_id === "string" ? raw.peer_id : undefined,
            pending_tokens:
              typeof raw.pending_tokens === "number" ? raw.pending_tokens : 0,
            message_count:
              typeof raw.message_count === "number"
                ? raw.message_count
                : undefined,
            commit_count:
              typeof raw.commit_count === "number"
                ? raw.commit_count
                : undefined,
            last_commit_at:
              typeof raw.last_commit_at === "string"
                ? raw.last_commit_at
                : typeof raw.last_commit === "string"
                  ? raw.last_commit
                  : undefined,
            created_at:
              typeof raw.created_at === "string" ? raw.created_at : undefined,
            updated_at:
              typeof raw.updated_at === "string" ? raw.updated_at : undefined,
          },
        };
      } catch (err) {
        return {
          status: "unreachable",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }

    return { status: "missing" };
  }

  /**
   * Получение метаданных сессии по идентификатору.
   * Обёртка над {@link readSession} для вызывающих, которым причина неудачи
   * не нужна: любая неудача сводится к null.
   */
  async fetchSession(sessionId: string): Promise<SessionStatus | null> {
    const result = await this.readSession(sessionId);
    return result.status === "ok" ? result.session : null;
  }

  /**
   * Алиас для fetchSession
   */
  async getSession(sessionId: string): Promise<SessionStatus | null> {
    return this.fetchSession(sessionId);
  }

  /**
   * Инициация фиксации (коммита) накопленных токенов сессии в долговременную память
   */
  async commitSession(
    sessionId: string,
    options?: CommitOptions
  ): Promise<CommitResult> {
    if (!sessionId || !sessionId.trim()) {
      return { ok: false, error: "Missing sessionId" };
    }

    if (this.isProxy()) {
      try {
        const res = await fetch(`${this.endpoint}/session/commit`, {
          method: "POST",
          headers: this.getHeaders(),
          body: JSON.stringify({
            sessionId: sessionId.trim(),
            ...(options ?? { keep_recent_count: 10 }),
          }),
        });

        if (!res.ok) {
          return { ok: false, error: `HTTP ${res.status}` };
        }

        const data = (await res.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        return {
          ok: data.ok === true,
          error: typeof data.error === "string" ? data.error : undefined,
          task_id: typeof data.task_id === "string" ? data.task_id : undefined,
          resource_id:
            typeof data.resource_id === "string" ? data.resource_id : undefined,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    const candidates = this.getCandidateSessionIds(sessionId);
    const bodyPayload = JSON.stringify(options ?? { keep_recent_count: 10 });
    let lastError = "Session commit failed";

    for (const candidateId of candidates) {
      try {
        const res = await fetch(
          `${this.endpoint}/api/v1/sessions/${encodeURIComponent(candidateId)}/commit`,
          {
            method: "POST",
            headers: this.getHeaders(),
            body: bodyPayload,
          }
        );

        if (res.status === 404) {
          lastError = `Session not found: ${candidateId}`;
          continue;
        }

        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as Record<
            string,
            unknown
          > | null;
          const errorMsg =
            (errBody?.error as Record<string, unknown>)?.message ||
            errBody?.message ||
            errBody?.error ||
            `HTTP ${res.status}: ${res.statusText}`;
          return { ok: false, error: String(errorMsg) };
        }

        this.resolvedSessionIds.set(sessionId.trim(), candidateId);
        const okBody = (await res.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        const container = (okBody.result ?? okBody.data ?? okBody) as Record<
          string,
          unknown
        >;
        const taskId = container.task_id ?? container.id;
        return {
          ok: true,
          task_id:
            typeof taskId === "string" && taskId.trim()
              ? taskId.trim()
              : undefined,
          resource_id: candidateId,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    return { ok: false, error: lastError };
  }

  /**
   * Список задач Phase 2 (Memory Extraction) текущей сессии со сводной
   * разбивкой по статусам.
   *
   * Через прокси: один запрос `GET /tasks?session=<id>`, разбивка считается
   * здесь. Напрямую: разрешаем `resource_id` через кандидатов и запрашиваем
   * `GET /api/v1/tasks?resource_id=<id>&task_type=session_commit&limit=200`.
   */
  async listTasks(sessionId: string): Promise<TasksReadResult> {
    if (!sessionId || !sessionId.trim()) {
      return { status: "missing" };
    }

    if (this.isProxy()) {
      try {
        const res = await fetch(
          `${this.endpoint}/tasks?session=${encodeURIComponent(
            sessionId.trim()
          )}&limit=${TASKS_LIMIT_CAP}`,
          { method: "GET", headers: this.getHeaders() }
        );
        if (res.status === 401 || res.status === 403) {
          return { status: "unauthorized" };
        }
        if (!res.ok) {
          return { status: "error", detail: `HTTP ${res.status}` };
        }
        const data = (await res.json()) as Record<string, unknown>;
        if (data.status === "unauthorized") return { status: "unauthorized" };
        if (data.status === "missing") return { status: "missing" };
        if (data.status === "unreachable")
          return {
            status: "unreachable",
            detail: typeof data.detail === "string" ? data.detail : undefined,
          };
        if (data.status === "error")
          return {
            status: "error",
            detail: typeof data.detail === "string" ? data.detail : undefined,
          };
        const tasks = normalizeTaskList(extractTaskList(data.tasks ?? data));
        return { status: "ok", breakdown: computeBreakdown(tasks), tasks };
      } catch (err) {
        return {
          status: "unreachable",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // Прямой доступ: сперва разрешаем resource_id через кандидатов.
    // getCandidateSessionIds уже ставит ранее разрешённый id первым, поэтому
    // повторный опрос обычно попадает с первой попытки.
    const candidates = this.getCandidateSessionIds(sessionId);
    let resourceId: string | null = null;
    for (const candidateId of candidates) {
      try {
        const probe = await fetch(
          `${this.endpoint}/api/v1/sessions/${encodeURIComponent(candidateId)}`,
          { method: "GET", headers: this.getHeaders() }
        );
        if (probe.status === 404) continue;
        if (probe.status === 401 || probe.status === 403) {
          return { status: "unauthorized" };
        }
        if (probe.ok) {
          resourceId = candidateId;
          this.resolvedSessionIds.set(sessionId.trim(), candidateId);
          break;
        }
      } catch (err) {
        return {
          status: "unreachable",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }

    if (!resourceId) return { status: "missing" };

    try {
      const query = new URLSearchParams({
        resource_id: resourceId,
        task_type: "session_commit",
        limit: String(TASKS_LIMIT_CAP),
      });
      const res = await fetch(
        `${this.endpoint}/api/v1/tasks?${query.toString()}`,
        { method: "GET", headers: this.getHeaders() }
      );
      if (res.status === 401 || res.status === 403) {
        return { status: "unauthorized" };
      }
      if (!res.ok) {
        return { status: "error", detail: `HTTP ${res.status}` };
      }
      const data = (await res.json()) as Record<string, unknown>;
      const tasks = normalizeTaskList(extractTaskList(data));
      return { status: "ok", breakdown: computeBreakdown(tasks), tasks };
    } catch (err) {
      return {
        status: "unreachable",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Лениво загрузить одну задачу с лентой `execution_events` для «Show log».
   */
  async fetchTaskEvents(taskId: string): Promise<TaskEventsResult> {
    if (!taskId || !taskId.trim()) {
      return { status: "missing" };
    }

    const buildOk = (taskRaw: Record<string, unknown>): TaskEventsResult => {
      const task = normalizeExtractionTask(taskRaw);
      const eventsContainer = (taskRaw.execution_events ?? {}) as Record<
        string,
        unknown
      >;
      const rawEvents =
        (eventsContainer.items as unknown[]) ??
        (Array.isArray(taskRaw.execution_events)
          ? (taskRaw.execution_events as unknown[])
          : []);
      const events = (Array.isArray(rawEvents) ? rawEvents : [])
        .filter(
          (e): e is Record<string, unknown> => !!e && typeof e === "object"
        )
        .map(normalizeExecutionEvent);
      if (!task) return { status: "error", detail: "malformed task" };
      return { status: "ok", task, events };
    };

    if (this.isProxy()) {
      try {
        const res = await fetch(
          `${this.endpoint}/task?id=${encodeURIComponent(
            taskId.trim()
          )}&events=1`,
          { method: "GET", headers: this.getHeaders() }
        );
        if (res.status === 401 || res.status === 403) {
          return { status: "unauthorized" };
        }
        if (!res.ok) {
          return { status: "error", detail: `HTTP ${res.status}` };
        }
        const data = (await res.json()) as Record<string, unknown>;
        if (data.status === "unauthorized") return { status: "unauthorized" };
        if (data.status === "missing") return { status: "missing" };
        if (data.status === "unreachable")
          return {
            status: "unreachable",
            detail: typeof data.detail === "string" ? data.detail : undefined,
          };
        if (data.status === "error")
          return {
            status: "error",
            detail: typeof data.detail === "string" ? data.detail : undefined,
          };
        return buildOk((data.task ?? {}) as Record<string, unknown>);
      } catch (err) {
        return {
          status: "unreachable",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }

    try {
      const res = await fetch(
        `${this.endpoint}/api/v1/tasks/${encodeURIComponent(
          taskId.trim()
        )}?include_events=true`,
        { method: "GET", headers: this.getHeaders() }
      );
      if (res.status === 404) return { status: "missing" };
      if (res.status === 401 || res.status === 403) {
        return { status: "unauthorized" };
      }
      if (!res.ok) {
        return { status: "error", detail: `HTTP ${res.status}` };
      }
      const data = (await res.json()) as Record<string, unknown>;
      const taskRaw = (data?.result ?? data?.data ?? data) as Record<
        string,
        unknown
      >;
      return buildOk(taskRaw);
    } catch (err) {
      return {
        status: "unreachable",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * Нормализовать массив сырых задач, отбросив нераспознанные записи.
 */
export function normalizeTaskList(raw: unknown): ExtractionTask[] {
  if (!Array.isArray(raw)) return [];
  const tasks: ExtractionTask[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const task = normalizeExtractionTask(entry as Record<string, unknown>);
    if (task) tasks.push(task);
  }
  return tasks;
}

/**
 * Экземпляр клиента по умолчанию с автоматическим определением конфигурации
 */
export const defaultOpenVikingClient = new OpenVikingClient();

/**
 * Вспомогательная функция проверки доступности OpenViking
 */
export function checkHealth(
  endpoint?: string,
  apiKey?: string
): Promise<HealthStatus> {
  const client =
    endpoint || apiKey
      ? new OpenVikingClient(endpoint, apiKey)
      : defaultOpenVikingClient;
  return client.checkHealth();
}

/**
 * Вспомогательная функция получения состояния сессии
 */
export function fetchSession(
  sessionId: string,
  endpoint?: string,
  apiKey?: string
): Promise<SessionStatus | null> {
  const client =
    endpoint || apiKey
      ? new OpenVikingClient(endpoint, apiKey)
      : defaultOpenVikingClient;
  return client.fetchSession(sessionId);
}

/**
 * Синоним для fetchSession
 */
export function getSession(
  sessionId: string,
  endpoint?: string,
  apiKey?: string
): Promise<SessionStatus | null> {
  return fetchSession(sessionId, endpoint, apiKey);
}

/**
 * Вспомогательная функция выполнения коммита сессии
 */
export function commitSession(
  sessionId: string,
  options?: CommitOptions,
  endpoint?: string,
  apiKey?: string
): Promise<CommitResult> {
  const client =
    endpoint || apiKey
      ? new OpenVikingClient(endpoint, apiKey)
      : defaultOpenVikingClient;
  return client.commitSession(sessionId, options);
}
