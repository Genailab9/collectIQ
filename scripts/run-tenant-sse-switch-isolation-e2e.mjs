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
  return parseTenantCookie(res.headers.get("set-cookie"));
}

function createSseClient(url, headers) {
  const events = [];
  const ac = new AbortController();
  let closed = false;
  const ready = (async () => {
    const res = await fetch(url, {
      signal: ac.signal,
      headers,
    });
    if (!res.ok || !res.body) {
      throw new Error(`SSE open failed: ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const chunks = buf.split("\n\n");
      buf = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const dataLine = chunk
          .split("\n")
          .find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        const raw = dataLine.replace(/^data:\s?/, "").trim();
        if (!raw) continue;
        try {
          events.push(JSON.parse(raw));
        } catch {
          // ignore malformed
        }
      }
    }
  })();
  return {
    events,
    close: () => {
      if (closed) return;
      closed = true;
      ac.abort();
      void ready.catch(() => undefined);
    },
    wait: () => ready.catch(() => undefined),
  };
}

async function waitForEventCount(client, count, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (client.events.length < count) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${count} events; got ${client.events.length}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function main() {
  const listenersByTenant = new Map(); // tenant -> Set(res)
  const backendServer = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const tenant = String(req.headers["x-collectiq-tenant-id"] ?? "").trim();

    if (path === "/api/v1/events/stream" && req.method === "GET") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      const bucket = listenersByTenant.get(tenant) ?? new Set();
      bucket.add(res);
      listenersByTenant.set(tenant, bucket);
      req.on("close", () => {
        const b = listenersByTenant.get(tenant);
        b?.delete(res);
        if (b && b.size === 0) listenersByTenant.delete(tenant);
      });
      return;
    }

    if (path === "/observability/emit-test" && req.method === "POST") {
      const envelope = {
        envelope: "STATE_TRANSITION",
        tenantId: tenant,
        correlationId: String(url.searchParams.get("cid") ?? "cid-default"),
        machine: "PAYMENT",
        from: "INITIATED",
        to: "PROCESSING",
      };
      const bucket = listenersByTenant.get(tenant);
      for (const streamRes of bucket ?? []) {
        streamRes.write(`event: message\n`);
        streamRes.write(`data: ${JSON.stringify(envelope)}\n\n`);
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, tenant, delivered: bucket?.size ?? 0 }));
      return;
    }

    if (path === "/observability/summary") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, tenant }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "not found", path }));
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

  let streamA;
  let streamB;
  try {
    await waitForHttpReady(`${appUrl}/login`, 90_000);

    // Scenario 1: active stream isolation under switch
    let cookieA = await postTenantContext(appUrl, authCookies, "tenant-sse-a", "");
    streamA = createSseClient(`${appUrl}/api/collectiq/api/v1/events/stream`, {
      cookie: `${authCookies}; ${cookieA}`,
      origin: appUrl,
    });
    await fetch(`${appUrl}/api/collectiq/observability/emit-test?cid=s1-a`, {
      method: "POST",
      headers: { cookie: `${authCookies}; ${cookieA}`, origin: appUrl },
      signal: AbortSignal.timeout(5000),
    });
    await waitForEventCount(streamA, 1);
    assert.equal(streamA.events[0]?.tenantId, "tenant-sse-a");

    const cookieB = await postTenantContext(appUrl, authCookies, "tenant-sse-b", cookieA);
    await fetch(`${appUrl}/api/collectiq/observability/emit-test?cid=s1-b`, {
      method: "POST",
      headers: { cookie: `${authCookies}; ${cookieB}`, origin: appUrl },
      signal: AbortSignal.timeout(5000),
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.ok(
      streamA.events.every((e) => e.tenantId === "tenant-sse-a" || e.envelope === "HEARTBEAT"),
      "Active stream A received cross-tenant events after switch",
    );

    // Scenario 2: reconnect correctness
    streamA.close();
    await streamA.wait();
    streamB = createSseClient(`${appUrl}/api/collectiq/api/v1/events/stream`, {
      cookie: `${authCookies}; ${cookieB}`,
      origin: appUrl,
    });
    await fetch(`${appUrl}/api/collectiq/observability/emit-test?cid=s2-b`, {
      method: "POST",
      headers: { cookie: `${authCookies}; ${cookieB}`, origin: appUrl },
      signal: AbortSignal.timeout(5000),
    });
    await waitForEventCount(streamB, 1);
    assert.ok(streamB.events.every((e) => e.tenantId === "tenant-sse-b" || e.envelope === "HEARTBEAT"));

    // Scenario 3: dual stream validation
    const cookieA2 = await postTenantContext(appUrl, authCookies, "tenant-sse-a", cookieB);
    const dualA = createSseClient(`${appUrl}/api/collectiq/api/v1/events/stream`, {
      cookie: `${authCookies}; ${cookieA2}`,
      origin: appUrl,
    });
    const dualB = createSseClient(`${appUrl}/api/collectiq/api/v1/events/stream`, {
      cookie: `${authCookies}; ${cookieB}`,
      origin: appUrl,
    });
    await fetch(`${appUrl}/api/collectiq/observability/emit-test?cid=s3-a`, {
      method: "POST",
      headers: { cookie: `${authCookies}; ${cookieA2}`, origin: appUrl },
      signal: AbortSignal.timeout(5000),
    });
    await fetch(`${appUrl}/api/collectiq/observability/emit-test?cid=s3-b`, {
      method: "POST",
      headers: { cookie: `${authCookies}; ${cookieB}`, origin: appUrl },
      signal: AbortSignal.timeout(5000),
    });
    await waitForEventCount(dualA, 1);
    await waitForEventCount(dualB, 1);
    assert.ok(dualA.events.every((e) => e.tenantId === "tenant-sse-a" || e.envelope === "HEARTBEAT"));
    assert.ok(dualB.events.every((e) => e.tenantId === "tenant-sse-b" || e.envelope === "HEARTBEAT"));
    dualA.close();
    dualB.close();
    await Promise.all([dualA.wait(), dualB.wait()]);

    // Scenario 4: switch race window
    const raceA = createSseClient(`${appUrl}/api/collectiq/api/v1/events/stream`, {
      cookie: `${authCookies}; ${cookieA2}`,
      origin: appUrl,
    });
    const raceB = await postTenantContext(appUrl, authCookies, "tenant-sse-b", cookieA2);
    await Promise.all([
      fetch(`${appUrl}/api/collectiq/observability/emit-test?cid=s4-a`, {
        method: "POST",
        headers: { cookie: `${authCookies}; ${cookieA2}`, origin: appUrl },
      }),
      fetch(`${appUrl}/api/collectiq/observability/emit-test?cid=s4-b`, {
        method: "POST",
        headers: { cookie: `${authCookies}; ${raceB}`, origin: appUrl },
      }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.ok(raceA.events.every((e) => e.tenantId === "tenant-sse-a" || e.envelope === "HEARTBEAT"));
    raceA.close();
    await raceA.wait();

    console.log("tenant-sse-switch-isolation-e2e: OK");
  } finally {
    streamA?.close?.();
    streamB?.close?.();
    if (!nextProc.killed) nextProc.kill("SIGTERM");
    await new Promise((resolve) => backendServer.close(resolve));
  }
}

main().catch((error) => {
  console.error("tenant-sse-switch-isolation-e2e: FAILED");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
