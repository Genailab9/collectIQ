#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";

async function waitForHttpReady(url, timeoutMs = 90_000) {
  const startedAt = Date.now();
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status > 0) return;
    } catch {
      // retry
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for HTTP readiness at ${url}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function findFreePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const addr = probe.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function main() {
  const observedTenants = [];
  const backendServer = createServer((req, res) => {
    observedTenants.push(String(req.headers["x-collectiq-tenant-id"] ?? ""));
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  await new Promise((resolve) => backendServer.listen(0, "127.0.0.1", resolve));
  const backendAddress = backendServer.address();
  assert.ok(backendAddress && typeof backendAddress === "object");
  const backendPort = backendAddress.port;

  const appPort = await findFreePort();
  const appUrl = `http://127.0.0.1:${appPort}`;
  const backendUrl = `http://127.0.0.1:${backendPort}`;

  const env = {
    ...process.env,
    NEXT_PUBLIC_APP_URL: appUrl,
    COLLECTIQ_API_BASE_URL: backendUrl,
    COLLECTIQ_API_KEY: "test-api-key",
  };

  const build = spawnSync("npm", ["run", "build"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const nextProc = spawn("npm", ["run", "start", "--", "--port", String(appPort)], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForHttpReady(`${appUrl}/login`, 90_000);
    const authCookies = "collectiq_session=test-session; collectiq_onboarded=done";

    const setTenantResA = await fetch(`${appUrl}/api/collectiq/tenant/context`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: {
        "content-type": "application/json",
        origin: appUrl,
        cookie: authCookies,
      },
      body: JSON.stringify({ tenantId: "tenant-e2e-a" }),
    });
    assert.equal(setTenantResA.status, 200);
    const setCookieA = setTenantResA.headers.get("set-cookie");
    assert.ok(setCookieA && setCookieA.includes("collectiq_tenant_id="));

    const proxyResA = await fetch(`${appUrl}/api/collectiq/observability/summary`, {
      signal: AbortSignal.timeout(5000),
      headers: {
        cookie: `${authCookies}; ${setCookieA}`,
        origin: appUrl,
      },
    });
    assert.equal(proxyResA.status, 200);
    assert.equal(observedTenants.at(-1), "tenant-e2e-a");

    const setTenantResB = await fetch(`${appUrl}/api/collectiq/tenant/context`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: {
        "content-type": "application/json",
        origin: appUrl,
        cookie: `${authCookies}; ${setCookieA}`,
      },
      body: JSON.stringify({ tenantId: "tenant-e2e-b" }),
    });
    assert.equal(setTenantResB.status, 200);
    const setCookieB = setTenantResB.headers.get("set-cookie");
    assert.ok(setCookieB && setCookieB.includes("collectiq_tenant_id="));

    const proxyResB = await fetch(`${appUrl}/api/collectiq/observability/summary`, {
      signal: AbortSignal.timeout(5000),
      headers: {
        cookie: `${authCookies}; ${setCookieB}`,
        origin: appUrl,
      },
    });
    assert.equal(proxyResB.status, 200);
    assert.equal(observedTenants.at(-1), "tenant-e2e-b");

    const spoofRes = await fetch(`${appUrl}/api/collectiq/observability/summary`, {
      signal: AbortSignal.timeout(5000),
      headers: {
        cookie: `${authCookies}; ${setCookieB}`,
        origin: appUrl,
        "x-collectiq-tenant-id": "tenant-spoof",
      },
    });
    assert.equal(spoofRes.status, 200);
    assert.equal(observedTenants.at(-1), "tenant-e2e-b");

    const repeatRes = await fetch(`${appUrl}/api/collectiq/observability/summary`, {
      signal: AbortSignal.timeout(5000),
      headers: {
        cookie: `${authCookies}; ${setCookieB}`,
        origin: appUrl,
      },
    });
    assert.equal(repeatRes.status, 200);
    assert.equal(observedTenants.at(-1), "tenant-e2e-b");

    console.log("tenant-context-e2e: OK");
  } finally {
    if (!nextProc.killed) nextProc.kill("SIGTERM");
    await new Promise((resolve) => backendServer.close(resolve));
  }
}

main().catch((error) => {
  console.error("tenant-context-e2e: FAILED");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
