import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveHostCredentials } from "../lib/index.js";

test("resolveHostCredentials - defaults when no env or files exist", () => {
  const emptyEnv: Record<string, string> = {};
  const creds = resolveHostCredentials(emptyEnv, {
    cliConfigPath: "/nonexistent/ovcli.conf",
    ovConfigPath: "/nonexistent/ov.conf",
  });

  assert.equal(creds.endpoint, "http://127.0.0.1:1933");
  assert.equal(creds.apiKey, undefined);
  assert.equal(creds.source, "default");
});

test("resolveHostCredentials - resolves from environment variables", () => {
  const env: Record<string, string> = {
    OPENVIKING_URL: "http://custom-daemon:1944/",
    OPENVIKING_API_KEY: "env-secret-token",
  };
  const creds = resolveHostCredentials(env, {
    cliConfigPath: "/nonexistent/ovcli.conf",
    ovConfigPath: "/nonexistent/ov.conf",
  });

  assert.equal(creds.endpoint, "http://custom-daemon:1944");
  assert.equal(creds.apiKey, "env-secret-token");
  assert.equal(creds.source, "env");
});

test("resolveHostCredentials - resolves from ~/.openviking/ovcli.conf", () => {
  const tempDir = join(tmpdir(), `ov-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  const confPath = join(tempDir, "ovcli.conf");

  writeFileSync(
    confPath,
    JSON.stringify({
      url: "http://127.0.0.1:1935",
      api_key: "ovcli-file-token",
    }),
    "utf-8"
  );

  try {
    const creds = resolveHostCredentials({}, { cliConfigPath: confPath });
    assert.equal(creds.endpoint, "http://127.0.0.1:1935");
    assert.equal(creds.apiKey, "ovcli-file-token");
    assert.equal(creds.source, "ovcli");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resolveHostCredentials - resolves from ov.conf server block", () => {
  const tempDir = join(tmpdir(), `ov-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  const confPath = join(tempDir, "ov.conf");

  writeFileSync(
    confPath,
    JSON.stringify({
      server: {
        host: "127.0.0.1",
        port: 1955,
        root_api_key: "ov-root-token",
      },
    }),
    "utf-8"
  );

  try {
    const creds = resolveHostCredentials(
      {},
      { cliConfigPath: "/nonexistent", ovConfigPath: confPath }
    );
    assert.equal(creds.endpoint, "http://127.0.0.1:1955");
    assert.equal(creds.apiKey, "ov-root-token");
    assert.equal(creds.source, "ov");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
