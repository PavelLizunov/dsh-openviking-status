import test from "node:test";
import assert from "node:assert/strict";
import {
  isLoopbackHost,
  validateEndpointUrl,
  enforceTrustFence,
  redactConfigDto,
  classifyAuthProbe,
} from "../lib/index.js";

test("Security V1: Config DTO Redaction", () => {
  const secret = "SECRET_TOKEN_DO_NOT_LEAK_12345678";
  const dto = redactConfigDto({
    endpoint: "http://127.0.0.1:1933",
    apiKey: secret,
    source: "settings",
  });

  assert.strictEqual(dto.endpoint, "http://127.0.0.1:1933");
  assert.strictEqual(dto.hasApiKey, true);
  assert.strictEqual(dto.apiKeyPresent, true);
  assert.strictEqual(
    (dto as any).apiKey,
    undefined,
    "Raw apiKey must NOT be in DTO"
  );
  assert.ok(
    dto.maskedApiKey?.includes("••••"),
    "Masked apiKey must be present"
  );
  assert.ok(
    !JSON.stringify(dto).includes(secret),
    "Serialized DTO must never contain raw secret"
  );
});

test("Security V2: Endpoint & SSRF Validation", () => {
  // Valid URLs
  assert.strictEqual(
    validateEndpointUrl("http://127.0.0.1:1933/"),
    "http://127.0.0.1:1933"
  );
  assert.strictEqual(
    validateEndpointUrl("https://openviking.tail9fd337.ts.net:1933"),
    "https://openviking.tail9fd337.ts.net:1933"
  );

  // Rejects SSRF / Link-local metadata IPs
  assert.throws(
    () => validateEndpointUrl("http://169.254.169.254/latest/meta-data"),
    /prohibited \(SSRF prevention\)/
  );
  assert.throws(
    () => validateEndpointUrl("http://169.254.170.2/"),
    /prohibited \(SSRF prevention\)/
  );

  // Rejects invalid schemes and credentials in authority
  assert.throws(
    () => validateEndpointUrl("file:///etc/passwd"),
    /protocol must be http: or https:/
  );
  assert.throws(
    () => validateEndpointUrl("ftp://127.0.0.1/"),
    /protocol must be http: or https:/
  );
  assert.throws(
    () => validateEndpointUrl("http://user:pass@127.0.0.1/"),
    /credentials in URL authority/
  );
});

test("Security V3: Multi-State Auth Probe Classification", () => {
  assert.strictEqual(classifyAuthProbe(200).authState, "authenticated");
  assert.strictEqual(classifyAuthProbe(204).authState, "authenticated");
  assert.strictEqual(classifyAuthProbe(401).authState, "unauthorized");
  assert.strictEqual(classifyAuthProbe(403).authState, "forbidden");
  assert.strictEqual(classifyAuthProbe(404).authState, "not_found");
  assert.strictEqual(classifyAuthProbe(500).authState, "server_error");
  assert.strictEqual(classifyAuthProbe(502).authState, "server_error");
  assert.strictEqual(classifyAuthProbe(null).authState, "unreachable");
  assert.strictEqual(classifyAuthProbe(0).authState, "unreachable");
});

test("Security V4: Trust Fence - Host, Origin & CSRF Protection", () => {
  // 1. Loopback checks
  assert.strictEqual(isLoopbackHost("localhost:3080"), true);
  assert.strictEqual(isLoopbackHost("127.0.0.1:3080"), true);
  assert.strictEqual(isLoopbackHost("[::1]:3080"), true);
  assert.strictEqual(isLoopbackHost("[::1]"), true);
  assert.strictEqual(isLoopbackHost("127.255.0.1:80"), true);

  // Attack bypasses rejected
  assert.strictEqual(isLoopbackHost("127.attacker.invalid:3080"), false);
  assert.strictEqual(isLoopbackHost("attacker.com:3080"), false);
  assert.strictEqual(isLoopbackHost(""), false);
  assert.strictEqual(isLoopbackHost(null as any), false);

  // 2. enforceTrustFence HTTP tests
  function createMockRes() {
    let statusCode = 200;
    let headers: Record<string, string> = {};
    let data = "";
    return {
      writeHead(code: number, h: Record<string, string> = {}) {
        statusCode = code;
        headers = { ...headers, ...h };
      },
      end(chunk = "") {
        data += chunk;
      },
      get status() {
        return statusCode;
      },
      get body() {
        return data ? JSON.parse(data) : {};
      },
    };
  }

  // 2a. Rejects forbidden method with 405
  const res405 = createMockRes();
  const ok405 = enforceTrustFence(
    { method: "TRACE", headers: { host: "localhost:3080" } },
    res405
  );
  assert.strictEqual(ok405, false);
  assert.strictEqual(res405.status, 405);

  // 2b. Rejects untrusted Host header with 403
  const resHost = createMockRes();
  const okHost = enforceTrustFence(
    { method: "GET", headers: { host: "evil-host.com:3080" } },
    resHost
  );
  assert.strictEqual(okHost, false);
  assert.strictEqual(resHost.status, 403);

  // 2c. Rejects non-JSON mutating requests with 415
  const res415 = createMockRes();
  const ok415 = enforceTrustFence(
    {
      method: "POST",
      headers: {
        host: "localhost:3080",
        "content-type": "application/x-www-form-urlencoded",
      },
    },
    res415
  );
  assert.strictEqual(ok415, false);
  assert.strictEqual(res415.status, 415);

  // 2d. Rejects Origin: 'null' on mutating requests with 403
  const resNullOrigin = createMockRes();
  const okNullOrigin = enforceTrustFence(
    {
      method: "POST",
      headers: {
        host: "localhost:3080",
        "content-type": "application/json",
        origin: "null",
      },
    },
    resNullOrigin
  );
  assert.strictEqual(okNullOrigin, false);
  assert.strictEqual(resNullOrigin.status, 403);

  // 2e. Allows legitimate loopback JSON POST
  const resOk = createMockRes();
  const okPass = enforceTrustFence(
    {
      method: "POST",
      headers: {
        host: "localhost:3080",
        "content-type": "application/json",
        origin: "http://localhost:3080",
      },
    },
    resOk
  );
  assert.strictEqual(okPass, true);
  assert.strictEqual(resOk.status, 200);
});
