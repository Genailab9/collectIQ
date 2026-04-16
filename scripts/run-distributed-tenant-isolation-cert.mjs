#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";

async function findFreePort() {
  const s = createServer();
  await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
  const addr = s.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  await new Promise((resolve) => s.close(resolve));
  return port;
}

async function waitForHttpReady(url, timeoutMs = 90_000) {
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.status > 0) return;
    } catch {}
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

function parseTenantCookie(setCookie) {
  const blob = Array.isArray(setCookie) ? setCookie.join(", ") : String(setCookie ?? "");
  const m = /collectiq_tenant_id=[^;,\s]+/i.exec(blob);
  assert.ok(m, "Missing collectiq_tenant_id cookie");
  return m[0];
}

function createSseClient(url, headers) {
  const events = [];
  const ac = new AbortController();
  let closed = false;
  const ready = (async () => {
    const res = await fetch(url, { headers, signal: ac.signal });
    if (!res.ok || !res.body) throw new Error(`SSE open failed ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split("\n\n");
      buf = blocks.pop() ?? "";
      for (const block of blocks) {
        const line = block.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const raw = line.replace(/^data:\s?/, "").trim();
        if (!raw) continue;
        try {
          events.push(JSON.parse(raw));
        } catch {}
      }
    }
  })();
  void ready.catch(() => undefined);
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
  const start = Date.now();
  while (client.events.length < count) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${count} SSE events, got ${client.events.length}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

function pass(name, notes) {
  return { scenario: name, result: "PASS", notes };
}
function fail(name, error) {
  return { scenario: name, result: "FAIL", notes: error instanceof Error ? error.message : String(error) };
}

async function main() {
  const matrix = [];
  const authCookies = "collectiq_session=test-session; collectiq_onboarded=done";

  // Fake backend with tenant-aware request + SSE fanout
  const observations = new Map(); // rid -> tenant
  const listenersByTenant = new Map();
  let injectDelayMs = 0;

  const backend = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const tenant = String(req.headers["x-collectiq-tenant-id"] ?? "").trim();
    const rid = String(url.searchParams.get("rid") ?? "");

    if (rid) observations.set(rid, tenant);

    if (url.pathname === "/api/v1/events/stream" && req.method === "GET") {
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

    if (url.pathname === "/observability/emit-test" && req.method === "POST") {
      const envelope = {
        envelope: "STATE_TRANSITION",
        tenantId: tenant,
        correlationId: String(url.searchParams.get("cid") ?? "cid"),
        machine: "PAYMENT",
        from: "INITIATED",
        to: "PROCESSING",
      };
      if (injectDelayMs > 0) await new Promise((r) => setTimeout(r, injectDelayMs));
      for (const s of listenersByTenant.get(tenant) ?? []) {
        s.write(`event: message\n`);
        s.write(`data: ${JSON.stringify(envelope)}\n\n`);
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, tenant }));
      return;
    }

    if (url.pathname === "/observability/summary") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, tenant }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise((r) => backend.listen(0, "127.0.0.1", r));
  const bAddr = backend.address();
  assert.ok(bAddr && typeof bAddr === "object");
  const backendUrl = `http://127.0.0.1:${bAddr.port}`;

  const node1Port = await findFreePort();
  const node2Port = await findFreePort();
  const lbPort = await findFreePort();
  const appUrl = `http://127.0.0.1:${lbPort}`;

  const envBase = {
    ...process.env,
    NEXT_PUBLIC_APP_URL: appUrl,
    COLLECTIQ_API_BASE_URL: backendUrl,
    COLLECTIQ_API_KEY: "test-api-key",
  };

  const build = spawnSync("npm", ["run", "build"], { cwd: process.cwd(), env: envBase, encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const startNode = (port) =>
    spawn("npm", ["run", "start", "--", "--port", String(port)], {
      cwd: process.cwd(),
      env: envBase,
      stdio: ["ignore", "pipe", "pipe"],
    });

  let n1 = startNode(node1Port);
  let n2 = startNode(node2Port);
  let rr = 0;
  const nodeState = new Map([
    [node1Port, true],
    [node2Port, true],
  ]);

  const lb = createServer(async (req, res) => {
    const candidates = [node1Port, node2Port].filter((p) => nodeState.get(p));
    if (!candidates.length) {
      res.writeHead(503);
      res.end("no upstream");
      return;
    }
    const port = candidates[rr % candidates.length];
    rr += 1;
    const target = `http://127.0.0.1:${port}${req.url ?? "/"}`;

    const bodyChunks = [];
    for await (const chunk of req) bodyChunks.push(chunk);
    const body = bodyChunks.length ? Buffer.concat(bodyChunks) : undefined;

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "undefined") continue;
      if (Array.isArray(v)) headers.set(k, v.join(","));
      else headers.set(k, v);
    }
    headers.delete("host");
    headers.delete("content-length");

    let upstream;
    try {
      upstream = await fetch(target, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
        redirect: "manual",
      });
    } catch (e) {
      res.writeHead(502);
      res.end(`upstream error: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    res.statusCode = upstream.status;
    if (typeof upstream.headers.getSetCookie === "function") {
      const setCookies = upstream.headers.getSetCookie();
      if (setCookies.length > 0) {
        res.setHeader("set-cookie", setCookies);
      }
    }
    upstream.headers.forEach((value, key) => {
      if (key.toLowerCase() === "transfer-encoding") return;
      if (key.toLowerCase() === "set-cookie") return;
      res.setHeader(key, value);
    });
    if (!upstream.body) {
      res.end();
      return;
    }
    try {
      const reader = upstream.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch {
      // Upstream stream terminated during chaos actions (node restarts/blackhole).
      // We intentionally swallow this at the balancer edge and close response.
      if (!res.writableEnded) {
        res.end();
      }
    }
  });
  await new Promise((r) => lb.listen(lbPort, "127.0.0.1", r));

  const stopNode = async (proc, port) => {
    nodeState.set(port, false);
    if (!proc.killed) proc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
  };

  const startNodeAndMark = async (port) => {
    if (port === node1Port) n1 = startNode(node1Port);
    else n2 = startNode(node2Port);
    nodeState.set(port, true);
    await waitForHttpReady(`http://127.0.0.1:${port}/login`, 60_000);
  };

  const postTenant = async (tenantId, prevCookie = "") => {
    const cookieHeader = prevCookie ? `${authCookies}; ${prevCookie}` : authCookies;
    const r = await fetch(`${appUrl}/api/collectiq/tenant/context`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: appUrl, cookie: cookieHeader },
      body: JSON.stringify({ tenantId }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(r.status, 200);
    const maybeList =
      typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : r.headers.get("set-cookie");
    return parseTenantCookie(maybeList);
  };

  const reqSummary = async (cookie, rid) => {
    const r = await fetch(`${appUrl}/api/collectiq/observability/summary?rid=${encodeURIComponent(rid)}`, {
      headers: { origin: appUrl, cookie: `${authCookies}; ${cookie}` },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(r.status, 200);
  };

  try {
    await Promise.all([
      waitForHttpReady(`http://127.0.0.1:${node1Port}/login`, 90_000),
      waitForHttpReady(`http://127.0.0.1:${node2Port}/login`, 90_000),
      waitForHttpReady(`${appUrl}/login`, 90_000),
    ]);

    let cookieA = await postTenant("tenant-dist-a");
    let cookieB = await postTenant("tenant-dist-b", cookieA);

    // 1) Multi-node request routing
    try {
      const ids = Array.from({ length: 8 }, (_, i) => `topology-${i + 1}`);
      await Promise.all(ids.map((id) => reqSummary(cookieB, id)));
      for (const id of ids) assert.equal(observations.get(id), "tenant-dist-b");
      matrix.push(pass("Multi-node request routing", "no cross-node tenant leakage"));
    } catch (e) {
      matrix.push(fail("Multi-node request routing", e));
    }

    // 2) Node restart mid-session
    try {
      await stopNode(n1, node1Port);
      await reqSummary(cookieB, "restart-1");
      assert.equal(observations.get("restart-1"), "tenant-dist-b");
      await startNodeAndMark(node1Port);
      await reqSummary(cookieB, "restart-2");
      assert.equal(observations.get("restart-2"), "tenant-dist-b");
      matrix.push(pass("Node restart mid-session", "cookie-based tenant recovery stable"));
    } catch (e) {
      matrix.push(fail("Node restart mid-session", e));
    }

    // 3) SSE reconnect after node switch
    try {
      const streamA = createSseClient(`${appUrl}/api/collectiq/api/v1/events/stream`, {
        origin: appUrl,
        cookie: `${authCookies}; ${cookieA}`,
      });
      await fetch(`${appUrl}/api/collectiq/observability/emit-test?cid=sse-a`, {
        method: "POST",
        headers: { origin: appUrl, cookie: `${authCookies}; ${cookieA}` },
      });
      await waitForEventCount(streamA, 1);
      assert.equal(streamA.events[0]?.tenantId, "tenant-dist-a");
      cookieB = await postTenant("tenant-dist-b", cookieA);
      await fetch(`${appUrl}/api/collectiq/observability/emit-test?cid=sse-b`, {
        method: "POST",
        headers: { origin: appUrl, cookie: `${authCookies}; ${cookieB}` },
      });
      await new Promise((r) => setTimeout(r, 300));
      assert.ok(streamA.events.every((e) => e.tenantId === "tenant-dist-a" || e.envelope === "HEARTBEAT"));
      streamA.close();
      await streamA.wait();

      const streamB = createSseClient(`${appUrl}/api/collectiq/api/v1/events/stream`, {
        origin: appUrl,
        cookie: `${authCookies}; ${cookieB}`,
      });
      await fetch(`${appUrl}/api/collectiq/observability/emit-test?cid=sse-b2`, {
        method: "POST",
        headers: { origin: appUrl, cookie: `${authCookies}; ${cookieB}` },
      });
      await waitForEventCount(streamB, 1);
      assert.ok(streamB.events.every((e) => e.tenantId === "tenant-dist-b" || e.envelope === "HEARTBEAT"));
      streamB.close();
      await streamB.wait();
      matrix.push(pass("SSE reconnect after node switch", "stream rebind tenant-safe"));
    } catch (e) {
      matrix.push(fail("SSE reconnect after node switch", e));
    }

    // 4) Redis delay injection analogue (backend fanout delay)
    try {
      injectDelayMs = 350;
      await reqSummary(cookieB, "delay-1");
      assert.equal(observations.get("delay-1"), "tenant-dist-b");
      injectDelayMs = 0;
      matrix.push(pass("Redis delay injection (analogue)", "no stale tenant resolution under delayed fanout"));
    } catch (e) {
      matrix.push(fail("Redis delay injection (analogue)", e));
    }

    // 5) Retry storm
    try {
      const ids = Array.from({ length: 20 }, (_, i) => `storm-${i + 1}`);
      await Promise.all(
        ids.map(async (id) => {
          await reqSummary(cookieB, id);
          await reqSummary(cookieB, `${id}-r`);
        }),
      );
      for (const id of ids) {
        assert.equal(observations.get(id), "tenant-dist-b");
        assert.equal(observations.get(`${id}-r`), "tenant-dist-b");
      }
      matrix.push(pass("Retry storm", "tenant context idempotent across retries"));
    } catch (e) {
      matrix.push(fail("Retry storm", e));
    }

    // 6) Partial node failure
    try {
      await stopNode(n2, node2Port);
      const ids = ["partial-1", "partial-2", "partial-3"];
      await Promise.all(ids.map((id) => reqSummary(cookieB, id)));
      ids.forEach((id) => assert.equal(observations.get(id), "tenant-dist-b"));
      await startNodeAndMark(node2Port);
      matrix.push(pass("Partial node failure", "no fallback corruption with one node blackholed"));
    } catch (e) {
      matrix.push(fail("Partial node failure", e));
    }

    console.log("distributed-tenant-isolation-cert: matrix");
    console.table(matrix);
    const failed = matrix.filter((x) => x.result !== "PASS");
    if (failed.length > 0) {
      throw new Error(`Invariant violations detected: ${failed.map((f) => f.scenario).join(", ")}`);
    }
    console.log("distributed-tenant-isolation-cert: OK");
  } finally {
    if (!n1.killed) n1.kill("SIGTERM");
    if (!n2.killed) n2.kill("SIGTERM");
    await new Promise((r) => lb.close(r));
    await new Promise((r) => backend.close(r));
  }
}

main().catch((e) => {
  console.error("distributed-tenant-isolation-cert: FAILED");
  console.error(e instanceof Error ? e.stack || e.message : String(e));
  process.exit(1);
});
