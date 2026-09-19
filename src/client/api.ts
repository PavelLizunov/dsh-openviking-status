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
 * Результат операции коммита сессии
 */
export interface CommitResult {
  ok: boolean;
  error?: string;
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
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    return { ok: false, error: lastError };
  }
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
