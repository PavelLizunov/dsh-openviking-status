import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";
import { OpenVikingSettingsSection } from "../lib/client.js";

test("OpenVikingSettingsSection - renders settings panel with form controls", () => {
  const html = renderToString(
    React.createElement(OpenVikingSettingsSection, {
      initialConfig: {
        endpoint: "http://127.0.0.1:1933",
        hasApiKey: true,
        source: "ovcli",
      },
    })
  );

  assert.ok(html.includes("OpenViking"), "should render OpenViking heading");
  assert.ok(
    html.includes("http://127.0.0.1:1933"),
    "should render endpoint in input"
  );
  assert.ok(
    html.includes("Test Connection"),
    "should render Test Connection button"
  );
  assert.ok(
    html.includes("Save Settings"),
    "should render Save Settings button"
  );
  assert.ok(html.includes("ovcli"), "should indicate source badge");
});

test("OpenVikingSettingsSection - renders custom override badge when source is settings", () => {
  const html = renderToString(
    React.createElement(OpenVikingSettingsSection, {
      initialConfig: {
        endpoint: "http://remote-host:1933",
        hasApiKey: true,
        source: "settings",
      },
    })
  );

  assert.ok(
    html.includes("http://remote-host:1933"),
    "should render custom endpoint"
  );
  assert.ok(
    html.includes("Custom override"),
    "should indicate custom override badge"
  );
  assert.ok(
    html.includes("Reset to Auto-detected"),
    "should offer reset button"
  );
});
