import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { resolveLightweightCharts, safeResolve } from "../../src/server/static";
import { rawGet, startTestServer, type TestServer } from "./helpers";

let srv: TestServer | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
});

describe("statische bestanden", () => {
  it("serveert index.html op / met beveiligingsheaders", async () => {
    srv = await startTestServer();
    const res = await fetch(srv.base + "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toContain("<title>Test</title>");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("geeft de juiste content-types", async () => {
    srv = await startTestServer();
    const cases: [string, string][] = [
      ["/js/app.js", "text/javascript; charset=utf-8"],
      ["/css/base.css", "text/css; charset=utf-8"],
      ["/favicon.svg", "image/svg+xml"],
    ];
    for (const [path, type] of cases) {
      const res = await fetch(srv.base + path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toBe(type);
      await res.arrayBuffer();
    }
    const missing = await fetch(srv.base + "/bestaat/niet.js");
    expect(missing.status).toBe(404);
    await missing.arrayBuffer();
  });

  it("blokkeert directory traversal en verborgen bestanden", async () => {
    srv = await startTestServer();
    for (const path of [
      "/../package.json",
      "/..%2f..%2fpackage.json",
      "/%2e%2e/%2e%2e/package.json",
      "/js/..%2f..%2f..%2fetc/passwd",
      "/..%5c..%5cpackage.json",
      "/%00index.html",
      "/.secret",
      "/%2esecret",
    ]) {
      const res = await rawGet(srv.port, path);
      expect([403, 404], path).toContain(res.status);
      expect(res.body, path).not.toContain("bitvavo-trader");
      expect(res.body, path).not.toContain("geheim");
      expect(res.body, path).not.toContain("root:");
    }
  });

  it("safeResolve blijft binnen de root", () => {
    expect(safeResolve("/srv/public", "/index.html")).toBe("/srv/public/index.html");
    expect(safeResolve("/srv/public", "/../x")).toBeNull();
    expect(safeResolve("/srv/public", "/a/%2e%2e/%2e%2e/x")).toBeNull();
    expect(safeResolve("/srv/public", "/%E0%A4%A")).toBeNull();
  });

  it("serveert lightweight-charts via /vendor", async () => {
    srv = await startTestServer({ deps: { vendorFile: undefined } });
    const file = resolveLightweightCharts();
    expect(file).toMatch(/lightweight-charts\.standalone\.production\.js$/);
    const res = await fetch(srv.base + "/vendor/lightweight-charts.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    const body = await res.text();
    expect(body.length).toBe(readFileSync(file!, "utf8").length);
    expect(body).toContain("LightweightCharts");
  });

  it("weigert andere methodes dan GET/HEAD voor statische bestanden", async () => {
    srv = await startTestServer();
    const res = await fetch(srv.base + "/index.html", { method: "POST" });
    expect(res.status).toBe(405);
    await res.arrayBuffer();
    const head = await fetch(srv.base + "/index.html", { method: "HEAD" });
    expect(head.status).toBe(200);
  });
});
