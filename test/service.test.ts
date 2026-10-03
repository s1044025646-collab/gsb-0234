import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../src/db.js";
import { SelectorService } from "../src/service.js";
import { AppError } from "../src/errors.js";
import { FIXED_DOM } from "./fixture.js";
import { DEMO_HTML_V1, DEMO_HTML_V2 } from "../scripts/fixtures.js";
import type { DatabaseSync } from "node:sqlite";

let dir: string;
let db: DatabaseSync;
let service: SelectorService;

before(() => {
  dir = mkdtempSync(join(process.cwd(), ".test-data-"));
  db = openDatabase(join(dir, "test.sqlite"));
  service = new SelectorService(db);
});

after(async () => {
  db.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(dir, { recursive: true, force: true });
});

test("导入文档产生版本并持久化，可重启后继续查询", () => {
  const v1 = service.importDocument({ title: "固定DOM", html: FIXED_DOM });
  assert.equal(v1.versionNo, 1);
  assert.ok(v1.nodeCount > 0);

  const reopenedDb = openDatabase(join(dir, "test.sqlite"));
  const reopened = new SelectorService(reopenedDb);
  const result = reopened.query(v1.versionId, "div > a");
  assert.deepEqual(result.hits.map((hit) => hit.text), ["独立链接"]);
  reopenedDb.close();
});

test("参数校验：空文档、超大文档、超长选择器、未知版本", () => {
  assert.throws(() => service.importDocument({ html: "   " }), (e: unknown) => e instanceof AppError && e.code === "EMPTY_DOCUMENT");
  assert.throws(() => service.importDocument({ html: "x".repeat(2 * 1024 * 1024 + 10) }), (e: unknown) => e instanceof AppError && e.code === "DOCUMENT_TOO_LARGE");
  assert.throws(() => service.query(1, "x".repeat(301)), (e: unknown) => e instanceof AppError && e.code === "SELECTOR_TOO_LONG");
  assert.throws(() => service.query(9999, "a"), (e: unknown) => e instanceof AppError && e.code === "NOT_FOUND");
});

test("更新 HTML 产生新版本，版本递增", () => {
  const first = service.importDocument({ title: "导航", html: DEMO_HTML_V1 });
  const second = service.importDocument({ documentId: first.documentId, html: DEMO_HTML_V2 });
  assert.equal(second.documentId, first.documentId);
  assert.equal(second.versionNo, 2);

  const comparison = service.compare(first.versionId, second.versionId, "ul.submenu a");
  assert.equal(comparison.a.total, 2);
  assert.equal(comparison.b.total, 3);
  assert.equal(comparison.added.length, 1);
  assert.match(comparison.added[0]!, /li\[3\] > a\[1\]$/);
  assert.deepEqual(comparison.removed, []);
});

test("保存报告后旧报告保留并对应原始版本树", () => {
  const versions = service.listVersions();
  const navV1 = versions.find((v) => v.title === "导航" && v.versionNo === 1)!;
  const navV2 = versions.find((v) => v.title === "导航" && v.versionNo === 2)!;

  const saved = service.query(navV1.versionId, "nav a", true);
  assert.equal(saved.total, 5);
  const savedQueryId = saved.queryId;

  const v2Result = service.query(navV2.versionId, "nav a");
  assert.equal(v2Result.total, 6);

  const reports = service.listReports();
  const reportEntry = reports.find((r) => r.queryId === savedQueryId)!;
  assert.ok(reportEntry);

  const report = service.getReport(reportEntry.reportId);
  assert.equal(report.versionId, navV1.versionId);
  assert.equal(report.total, 5);
  assert.deepEqual(
    report.hits.map((hit) => hit.path),
    saved.hits.map((hit) => hit.path),
  );
});

test("命中解释包含每个简单条件与父子/祖先关系", () => {
  const v1 = service.listVersions().find((v) => v.title === "导航" && v.versionNo === 1)!;
  const result = service.query(v1.versionId, "ul.submenu > li a.link");
  const first = result.hits[0]!;
  const explanation = result.explanations[first.nodeId]![0]!;
  assert.equal(explanation.steps.length, 3);
  assert.equal(explanation.steps[0]!.combinator, "self");
  assert.equal(explanation.steps[1]!.combinator, "child");
  assert.equal(explanation.steps[2]!.combinator, "descendant");
  assert.match(explanation.steps[0]!.detail, /submenu/);
  assert.match(explanation.steps[2]!.detail, /link/);
});
