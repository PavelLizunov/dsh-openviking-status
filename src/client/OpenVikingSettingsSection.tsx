import React, { useState, useEffect } from "react";
import { themeVar } from "./theme";
import { defaultOpenVikingClient } from "./api";

export interface OpenVikingConfigData {
  endpoint: string;
  hasApiKey: boolean;
  source: "env" | "ovcli" | "ov" | "settings" | "default";
}

export interface OpenVikingSettingsSectionProps {
  initialConfig?: OpenVikingConfigData;
  onConfigSaved?: (config: OpenVikingConfigData) => void;
  className?: string;
  style?: React.CSSProperties;
}

const API_CONFIG = "/openviking-status/api/config";
const API_TEST = "/openviking-status/api/test-connection";

const SOURCE_LABELS: Record<string, string> = {
  ovcli: "Auto-detected from ~/.openviking/ovcli.conf",
  env: "Auto-detected from environment variables",
  ov: "Auto-detected from ~/.openviking/ov.conf",
  settings: "Custom override in DSH settings.yaml",
  default: "Default local configuration",
};

export function OpenVikingSettingsSection({
  initialConfig,
  onConfigSaved,
  className,
  style,
}: OpenVikingSettingsSectionProps) {
  const [endpoint, setEndpoint] = useState(
    initialConfig?.endpoint || "http://127.0.0.1:1933"
  );
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [source, setSource] = useState<string>(
    initialConfig?.source || "default"
  );
  const [hasStoredKey, setHasStoredKey] = useState(
    initialConfig?.hasApiKey || false
  );
  const [loading, setLoading] = useState(!initialConfig);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    version?: string;
    storage?: string;
    authenticated?: boolean;
    error?: string;
  } | null>(null);
  const [flash, setFlash] = useState<{
    kind: "ok" | "err";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (initialConfig) return;
    let active = true;

    async function fetchConfig() {
      try {
        setLoading(true);
        const res = await fetch(API_CONFIG, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as OpenVikingConfigData;
        if (!active) return;
        const newEp = data.endpoint || "http://127.0.0.1:1933";
        setEndpoint(newEp);
        setSource(data.source || "default");
        setHasStoredKey(data.hasApiKey);
        defaultOpenVikingClient.clearResolvedSessions();
      } catch {
        // Fallback to local default if endpoint unreachable
      } finally {
        if (active) setLoading(false);
      }
    }

    void fetchConfig();
    return () => {
      active = false;
    };
  }, [initialConfig]);

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    setFlash(null);
    try {
      const res = await fetch(API_TEST, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: endpoint.trim(),
          apiKey: apiKey.trim() || undefined,
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err) {
      setTestResult({
        ok: false,
        authenticated: false,
        error: String(err instanceof Error ? err.message : err),
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setFlash(null);
    try {
      const res = await fetch(API_CONFIG, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: endpoint.trim(),
          apiKey: apiKey.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setFlash({ kind: "ok", message: "Settings saved successfully" });
      setSource("settings");
      defaultOpenVikingClient.clearResolvedSessions();
      if (apiKey.trim()) {
        setHasStoredKey(true);
        setApiKey("");
      }
      onConfigSaved?.(
        data.config || {
          endpoint,
          hasApiKey: hasStoredKey || Boolean(apiKey.trim()),
          source: "settings",
        }
      );
    } catch (err) {
      setFlash({
        kind: "err",
        message: `Failed to save: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    setFlash(null);
    setTestResult(null);
    try {
      const res = await fetch(API_CONFIG, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Re-fetch auto-detected configuration
      const cfgRes = await fetch(API_CONFIG, { cache: "no-store" });
      if (cfgRes.ok) {
        const data = (await cfgRes.json()) as OpenVikingConfigData;
        const newEp = data.endpoint || "http://127.0.0.1:1933";
        setEndpoint(newEp);
        setSource(data.source || "default");
        setHasStoredKey(data.hasApiKey);
        setApiKey("");
        defaultOpenVikingClient.clearResolvedSessions();
        setFlash({
          kind: "ok",
          message: "Reset to auto-detected local settings",
        });
        onConfigSaved?.(data);
      }
    } catch (err) {
      setFlash({
        kind: "err",
        message: `Failed to reset: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSaving(false);
    }
  }

  const sourceBadgeText = SOURCE_LABELS[source] || SOURCE_LABELS["default"]!;

  return (
    <div
      className={`ov-settings-root ${className || ""}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        maxWidth: 720,
        padding: "24px 28px",
        color: themeVar("labelPrimary"),
        fontSize: 14,
        lineHeight: 1.6,
        ...style,
      }}
    >
      {/* Header */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            marginBottom: 6,
          }}
        >
          <h2
            style={{
              fontSize: 20,
              fontWeight: 600,
              margin: 0,
              color: themeVar("labelPrimary"),
            }}
          >
            OpenViking Status
          </h2>
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              padding: "2px 8px",
              borderRadius: 6,
              background: themeVar("insetSurface"),
              border: `1px solid ${themeVar("hairline")}`,
              color: themeVar("labelSecondary"),
            }}
          >
            {sourceBadgeText}
          </span>
        </div>
        <p
          style={{ margin: 0, color: themeVar("labelSecondary"), fontSize: 13 }}
        >
          Configure connection credentials for monitoring OpenViking persistent
          memory and session status.
        </p>
      </div>

      {/* Main Settings Card */}
      <div
        style={{
          border: `1px solid ${themeVar("hairline")}`,
          borderRadius: 12,
          padding: 20,
          background: themeVar("insetSurface"),
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Endpoint Input */}
        <div>
          <label
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 6,
              color: themeVar("labelPrimary"),
            }}
          >
            Daemon Endpoint
          </label>
          <input
            type="text"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="http://127.0.0.1:1933"
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "9px 12px",
              fontSize: 14,
              fontFamily: themeVar("fontMono"),
              borderRadius: 8,
              border: `1px solid ${themeVar("hairline")}`,
              background: themeVar("panelSurface"),
              color: themeVar("labelPrimary"),
              outline: "none",
            }}
          />
          <span
            style={{
              fontSize: 12,
              color: themeVar("labelTertiary"),
              marginTop: 4,
              display: "block",
            }}
          >
            The URL of the local or remote OpenViking HTTP server. Resolved from
            the DSH host.
          </span>
        </div>

        {/* API Key Input */}
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <label
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: themeVar("labelPrimary"),
              }}
            >
              API Token (Authentication)
            </label>
            {hasStoredKey && !apiKey && (
              <span
                style={{
                  fontSize: 12,
                  color: themeVar("stateSuccess"),
                  fontWeight: 500,
                }}
              >
                ● Active token configured
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                hasStoredKey
                  ? "(Token stored — leave blank to keep unchanged)"
                  : "Optional or required if daemon uses auth_mode: api_key"
              }
              style={{
                flex: 1,
                padding: "9px 12px",
                fontSize: 14,
                fontFamily: themeVar("fontMono"),
                borderRadius: 8,
                border: `1px solid ${themeVar("hairline")}`,
                background: themeVar("panelSurface"),
                color: themeVar("labelPrimary"),
                outline: "none",
              }}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              style={{
                padding: "0 14px",
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 8,
                border: `1px solid ${themeVar("hairline")}`,
                background: themeVar("panelSurface"),
                color: themeVar("labelSecondary"),
                cursor: "pointer",
              }}
            >
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
          <span
            style={{
              fontSize: 12,
              color: themeVar("labelTertiary"),
              marginTop: 4,
              display: "block",
            }}
          >
            Required when the daemon runs with auth_mode: api_key. Local tokens
            are typically found in ~/.openviking/ovcli.conf.
          </span>
        </div>

        {/* Test Connection Banner */}
        {testResult && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 8,
              border: `1px solid ${testResult.ok && testResult.authenticated ? themeVar("stateSuccess") : themeVar("stateError")}`,
              background: themeVar("panelSurface"),
              color:
                testResult.ok && testResult.authenticated
                  ? themeVar("stateSuccess")
                  : themeVar("stateError"),
            }}
          >
            <span>{testResult.ok && testResult.authenticated ? "●" : "✕"}</span>
            <div style={{ flex: 1 }}>
              {testResult.ok && testResult.authenticated ? (
                <div>
                  <strong>Connected successfully</strong>
                  {testResult.version && <span> · {testResult.version}</span>}
                  {testResult.storage && (
                    <span> (storage: {testResult.storage})</span>
                  )}
                </div>
              ) : (
                <div>
                  <strong>Connection failed: </strong>
                  <span>
                    {testResult.error ||
                      "Unable to reach daemon or token unauthorized"}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
            paddingTop: 4,
          }}
        >
          <button
            type="button"
            disabled={testing || loading}
            onClick={() => void handleTestConnection()}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 8,
              border: `1px solid ${themeVar("hairline")}`,
              background: themeVar("panelSurface"),
              color: themeVar("labelPrimary"),
              cursor: testing ? "not-allowed" : "pointer",
              opacity: testing ? 0.6 : 1,
            }}
          >
            {testing ? "Testing..." : "Test Connection"}
          </button>

          <button
            type="button"
            disabled={saving || loading}
            onClick={() => void handleSave()}
            style={{
              padding: "8px 18px",
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 8,
              border: "none",
              background: themeVar("buttonPrimaryFill"),
              color: themeVar("buttonPrimaryText"),
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>

          {source === "settings" && (
            <button
              type="button"
              disabled={saving || loading}
              onClick={() => void handleReset()}
              style={{
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 8,
                border: `1px solid ${themeVar("hairline")}`,
                background: "transparent",
                color: themeVar("labelSecondary"),
                cursor: "pointer",
                marginLeft: "auto",
              }}
            >
              Reset to Auto-detected
            </button>
          )}

          {flash && (
            <span
              style={{
                fontSize: 13,
                color:
                  flash.kind === "ok"
                    ? themeVar("stateSuccess")
                    : themeVar("stateError"),
                fontWeight: 500,
              }}
            >
              {flash.message}
            </span>
          )}
        </div>
      </div>

      {/* Info Notice */}
      <div
        style={{
          border: `1px solid ${themeVar("hairline")}`,
          borderRadius: 10,
          padding: "14px 18px",
          background: themeVar("panelSurface"),
          fontSize: 13,
          color: themeVar("labelSecondary"),
          lineHeight: 1.5,
        }}
      >
        <p
          style={{
            margin: "0 0 6px 0",
            fontWeight: 600,
            color: themeVar("labelPrimary"),
          }}
        >
          How OpenViking connection works:
        </p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li style={{ marginBottom: 4 }}>
            All requests to OpenViking proxy through the DSH Desktop host,
            making it work seamlessly even when managing DSH remotely over
            Tailscale, mobile, or LAN.
          </li>
          <li style={{ marginBottom: 4 }}>
            If OpenViking runs locally on the standard port (1933), the plugin
            auto-detects credentials from <code>~/.openviking/ovcli.conf</code>.
          </li>
          <li>
            Custom values saved here are persisted in{" "}
            <code>~/.dsh/settings.yaml</code> under the{" "}
            <code>openviking-status</code> namespace.
          </li>
        </ul>
      </div>
    </div>
  );
}
