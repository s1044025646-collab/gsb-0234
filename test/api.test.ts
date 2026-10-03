import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Server } from "node:http";
import { startServer } from "../src/server.js";
import { FIXED_DOM } from "./fixture.js";

let server: Server;
let baseUrl: string;
let dataDir: string;

before(async () => {
  dataDir = mkdtempSync(join(process.cwd(), ".test-api-"));
  const started = await startServer({ dataDir });
  server = started.server;
  baseUrl = `http://127.0.0.1:${started.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(dataDir, { recursive: true, force: true });
});

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init?.body,
  });
  return { status: response.status, body: await response.json() };
}

test("完整 API 流程：健康检查、导入、查询、保存、报告、错误码", async () => {
  const health = await call("/health");
  assert.equal(health.status, 200);

  const imported = await call("/documents", {
    method: "POST",
    body: JSON.stringify({ title: "api测试", html: FIXED_DOM }),
  });
  assert.equal(imported.status, 201);
  const versionId = imported.body.versionId;

  const versions = await call("/versions");
  assert.ok(versions.body.some((v: any) => v.versionId === versionId));

  const query = await call("/versions/query", {
    method: "POST",
    body: JSON.stringify({ versionId, selector: "div a, a.special", save: true }),
  });
  assert.equal(query.status, 200);
  assert.equal(query.body.total, 4);
  const paths = query.body.hits.map((h: any) => h.path);
  assert.equal(paths.length, new Set(paths).size);

  const reports = await call("/reports");
  assert.equal(reports.status, 200);
  const reportId = reports.body[0].reportId;
  const report = await call(`/reports/${reportId}`);
  assert.equal(report.body.total, 4);

  const badSelector = await call("/versions/query", {
    method: "POST",
    body: JSON.stringify({ versionId, selector: "a:hover" }),
  });
  assert.equal(badSelector.status, 400);
  assert.equal(badSelector.body.error.code, "UNSUPPORTED_SELECTOR");

  const missing = await call("/versions/query", {
    method: "POST",
    body: JSON.stringify({ versionId, selector: 123 }),
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, "INVALID_PARAM");

  const notFound = await call("/reports/99999");
  assert.equal(notFound.status, 404);

  const noRoute = await call("/nope");
  assert.equal(noRoute.status, 404);
});
