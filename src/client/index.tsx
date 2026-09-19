import React, { useState, useEffect, useCallback, useRef } from "react";
import { parseRecalledMemories, inferCategory } from "./recallParser";
export * from "./recallParser";

export interface OpenVikingSessionData {
  session_id: string;
  peer_id?: string;
  pending_tokens?: number;
  message_count?: number;
  last_commit?: string;
}

export interface OpenVikingHealth {
  ok: boolean;
  storage?: string;
}

const DEFAULT_OV_ENDPOINT = "http://127.0.0.1:1933";
const COMMIT_THRESHOLD = 20000;

export function OpenVikingStatusChip({ sessionId }: { sessionId: string }) {
  const [health, setHealth] = useState<OpenVikingHealth | null>(null);
  const [sessionData, setSessionData] = useState<OpenVikingSessionData | null>(
    null
  );
  const [isOpen, setIsOpen] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const ovSessionId = `dsh-${sessionId}`;

  const fetchStatus = useCallback(async () => {
    try {
      // 1. Health check
      const healthRes = await fetch(`${DEFAULT_OV_ENDPOINT}/health`, {
        headers: { "Content-Type": "application/json" },
      }).catch(() => null);

      if (!healthRes || !healthRes.ok) {
        setHealth({ ok: false });
        return;
      }
      setHealth({ ok: true });

      // 2. Session info
      const sessionRes = await fetch(
        `${DEFAULT_OV_ENDPOINT}/api/v1/sessions/${encodeURIComponent(ovSessionId)}`,
        {
          headers: { "Content-Type": "application/json" },
        }
      ).catch(() => null);

      if (sessionRes && sessionRes.ok) {
        const body = await sessionRes.json();
        setSessionData(body.result || body);
      } else {
        setSessionData(null);
      }
    } catch {
      setHealth({ ok: false });
    }
  }, [ovSessionId]);

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, 15000);
    return () => clearInterval(timer);
  }, [fetchStatus]);

  // Click outside to close popover
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
      const res = await fetch(
        `${DEFAULT_OV_ENDPOINT}/api/v1/sessions/${encodeURIComponent(ovSessionId)}/commit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keep_recent_count: 10 }),
        }
      );
      if (res.ok) {
        await fetchStatus();
      }
    } catch (e) {
      console.error("[dsh-openviking-status] Failed to commit session:", e);
    } finally {
      setIsCommitting(false);
    }
  };

  const pendingTokens = sessionData?.pending_tokens ?? 0;
  const progressPercent = Math.min(
    100,
    Math.round((pendingTokens / COMMIT_THRESHOLD) * 100)
  );

  const statusColor = !health?.ok
    ? "var(--dsw-status-error, #f87171)"
    : isCommitting
      ? "var(--dsw-status-warning, #fbbf24)"
      : "var(--dsw-status-success, #34d399)";

  return (
    <div
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
        title="OpenViking Context Status"
      >
        <span
          style={{
            width: "7px",
            height: "7px",
            borderRadius: "50%",
            backgroundColor: statusColor,
            boxShadow: health?.ok ? `0 0 6px ${statusColor}` : "none",
          }}
        />
        <span
          style={{ fontWeight: 600, color: "var(--dsw-text-default, #e2e8f0)" }}
        >
          OV
        </span>
        <span>
          {health?.ok ? `${Math.round(pendingTokens / 1000)}k pend` : "offline"}
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
                backgroundColor: health?.ok
                  ? "rgba(52, 211, 153, 0.15)"
                  : "rgba(248, 113, 113, 0.15)",
                color: statusColor,
                fontWeight: 600,
              }}
            >
              {health?.ok ? "ONLINE" : "OFFLINE"}
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
                {ovSessionId.slice(0, 16)}...
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
            disabled={isCommitting || !health?.ok || pendingTokens === 0}
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
                pendingTokens === 0 || !health?.ok ? "not-allowed" : "pointer",
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

// Module registration for DSH Web/Desktop runtime
export function apply(ctx: any) {
  ctx.inject(["slots"], (scope: any) => {
    // Inject into conversation composer bar (right side slot)
    scope.slots.inject("conversation.input.right", () =>
      scope.slots.register(
        {
          name: "conversation.input.openviking-status",
          inject: (sessionId: string) => ({ sessionId }),
        },
        OpenVikingStatusChip
      )
    );
  });
}

// DSH client module loader export
if (typeof window !== "undefined" && (window as any).__ModuleLoader__) {
  (window as any).__ModuleLoader__.load({
    id: "@openviking-community/dsh-openviking-status",
    factory: (require: any) => {
      const module: any = { exports: {} };
      module.exports.apply = apply;
      module.exports.OpenVikingStatusChip = OpenVikingStatusChip;
      module.exports.parseRecalledMemories = parseRecalledMemories;
      module.exports.inferCategory = inferCategory;
      return module.exports;
    },
  });
}
