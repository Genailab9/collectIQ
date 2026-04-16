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
    await new Promise((resolve) => setTimeout(resolve, 200));
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

function parseTenantCookie(setCookie) {
  const m = /collectiq_tenant_id=[^;]+/i.exec(setCookie ?? "");
  assert.ok(m, "Missing collectiq_tenant_id cookie");
  return m[0];
}

async function postTenantContext(appUrl, authCookies, tenantId, priorTenantCookie) {
  const cookieHeader = priorTenantCookie ? `${authCookies}; ${priorTenantCookie}` : authCookies;
  const res = await fetch(`${appUrl}/api/collectiq/tenant/context`, {
    method: "POST",
    signal: AbortSignal.timeout(5000),
    headers: {
      "content-type": "application/json",
      origin: appUrl,
      cookie: cookieHeader,
    },
    body: JSON.stringify({ tenantId }),
  });
  assert.equal(res.status, 200, `tenant/context POST failed for ${tenantId}`);
  const setCookie = res.headers.get("set-cookie");
  return parseTenantCookie(setCookie);
}

function buildRequest(appUrl, authCookies, tenantCookie, id, spoofTenant) {
  const headers = {
    cookie: `${authCookies}; ${tenantCookie}`,
    origin: appUrl,
  };
  if (spoofTenant) headers["x-collectiq-tenant-id"] = spoofTenant;
  return fetch(`${appUrl}/api/collectiq/observability/summary?rid=${encodeURIComponent(String(id))}`, {
    signal: AbortSignal.timeout(5000),
    headers,
  });
}

function assertAllTenant(observations, expectedTenant, requestIds) {
  for (const id of requestIds) {
    const got = observations.get(String(id));
    assert.equal(
      got,
      expectedTenant,
      `Request ${id} expected tenant=${expectedTenant}, got tenant=${String(got)}`,
    );
  }
}

async function main() {
  const observations = new Map(); // requestId -> tenant
  const backendServer = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const id = String(requestUrl.searchParams.get("rid") ?? "");
    if (id) {
      observations.set(id, String(req.headers["x-collectiq-tenant-id"] ?? ""));
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => backendServer.listen(0, "127.0.0.1", resolve));
  const backendAddress = backendServer.address();
  assert.ok(backendAddress && typeof backendAddress === "object");
  const backendPort = backendAddress.port;

  const appPort = await findFreePort();
  const appUrl = `http://127.0.0.1:${appPort}`;
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const authCookies = "collectiq_session=test-session; collectiq_onboarded=done";

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

    // Scenario 1: parallel read during switch
    let tenantCookie = await postTenantContext(appUrl, authCookies, "tenant-race-a", "");
    const aIds = ["s1-a-1", "s1-a-2", "s1-a-3", "s1-a-4", "s1-a-5"];
    await Promise.all(aIds.map((id) => buildRequest(appUrl, authCookies, tenantCookie, id)));
    assertAllTenant(observations, "tenant-race-a", aIds);

    tenantCookie = await postTenantContext(appUrl, authCookies, "tenant-race-b", tenantCookie);
    const bIds = Array.from({ length: 10 }, (_, i) => `s1-b-${i + 1}`);
    await Promise.all(bIds.map((id) => buildRequest(appUrl, authCookies, tenantCookie, id)));
    assertAllTenant(observations, "tenant-race-b", bIds);

    // Scenario 2: interleaved switch + requests
    const iA = "s2-pre-a";
    await buildRequest(appUrl, authCookies, tenantCookie, iA);
    assertAllTenant(observations, "tenant-race-b", [iA]);
    tenantCookie = await postTenantContext(appUrl, authCookies, "tenant-race-c", tenantCookie);
    const iPost = ["s2-post-1", "s2-post-2", "s2-post-3"];
    await Promise.all(iPost.map((id) => buildRequest(appUrl, authCookies, tenantCookie, id)));
    assertAllTenant(observations, "tenant-race-c", iPost);

    // Scenario 3: rapid flip stress + spoof resistance
    const flips = ["tenant-race-a", "tenant-race-b", "tenant-race-a", "tenant-race-b"];
    for (let i = 0; i < flips.length; i += 1) {
      tenantCookie = await postTenantContext(appUrl, authCookies, flips[i], tenantCookie);
      const reqId = `s3-${i + 1}`;
      const spoof = i % 2 === 0 ? "tenant-spoof-x" : "tenant-spoof-y";
      const r = await buildRequest(appUrl, authCookies, tenantCookie, reqId, spoof);
      assert.equal(r.status, 200);
      assertAllTenant(observations, flips[i], [reqId]);
    }

    console.log("tenant-context-race-e2e: OK");
  } finally {
    if (!nextProc.killed) nextProc.kill("SIGTERM");
    await new Promise((resolve) => backendServer.close(resolve));
  }
}

main().catch((error) => {
  console.error("tenant-context-race-e2e: FAILED");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
