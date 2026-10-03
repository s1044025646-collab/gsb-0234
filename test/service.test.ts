// 服务层测试：导入、版本、查询、解释、报告保留、版本比较、限制。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ApiError, MAX_HTML_BYTES, Service } from "../src/service";
import { Store } from "../src/store";

const HTML_V1 = [
  "<html><body>",
  '<div id="main">',
  '  <ul class="list primary">',
  '    <li class="item active">一</li>',
  '    <li class="item">二<ul class="list nested"><li class="item sub">子一</li></ul></li>',
  "  </ul>",
  "  </div>",
  "</body></html>",
].join("\n");

const HTML_V2 = HTML_V1.replace(
  '<li class="item">二',
  '<li class="item">二</li><li class="item new">新增</li><li class="item">二（替换）'
);

let service: Service;
let dbFile: string;
let v1Id: number;
let v2Id: number;

before(() => {
  dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "htmlq-")), "test.db");
  service = new Service(new Store(dbFile));
  const imported = service.importDocument("测试", HTML_V1);
  const doc = imported.document;
  v1Id = service.listVersions(doc.id)[0].id;
  v2Id = service.addVersion(doc.id, HTML_V2).id;
});

after(() => {
  service.store.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test("导入与版本列表", () => {
  const docs = service.store.listDocuments();
  assert.equal(docs.length, 1);
  const versions = service.listVersions(docs[0].id);
  assert.deepEqual(versions.map((v) => v.version_no), [1, 2]);
});

test("查询返回标签、属性、文本与稳定路径", () => {
  const r = service.query(v1Id, "ul.primary > li");
  assert.equal(r.count, 2);
  assert.equal(r.matches[0].tag, "li");
  assert.equal(r.matches[0].id, null);
  assert.deepEqual(r.matches[0].classes, ["item", "active"]);
  assert.equal(r.matches[0].text, "一");
  assert.ok(r.matches[0].path.startsWith("/html[1]/body[1]/div[1]/ul[1]/li[1]"));
});

test("解释说明条件与祖先/父子关系", () => {
  const q = service.query(v1Id, "div .sub");
  const detail = service.explain(q.queryId);
  assert.equal(detail.count, 1);
  const lines = detail.matches[0].explanation;
  assert.ok(lines.some((l) => l.includes('class 词项包含 "sub"')));
  assert.ok(lines.some((l) => l.includes("祖先节点") && l.includes("<div>")));
});

test("旧报告对应原始树，不受新版本影响", () => {
  const q = service.query(v1Id, "li.item");
  const report = service.saveReport(q.queryId, "v1报告");
  const saved = service.getReport(report.id);
  assert.equal(saved.detail.count, 3); // v1: 一、二、子一
  const nowV2 = service.query(v2Id, "li.item");
  assert.equal(nowV2.count, 5); // v2 多了两条
  const savedAgain = service.getReport(report.id);
  assert.equal(savedAgain.detail.count, 3); // 报告仍是 v1 的结果
});

test("版本比较", () => {
  const cmp = service.compare(v1Id, v2Id, "ul.primary > li");
  assert.equal(cmp.versionA.count, 2);
  assert.equal(cmp.versionB.count, 4);
  assert.ok(cmp.onlyInB.length >= 1);
});

test("重启后可继续查询（重新打开数据库）", () => {
  const store2 = new Store(dbFile);
  const service2 = new Service(store2);
  const r = service2.query(v1Id, "li.active");
  assert.equal(r.count, 1);
  store2.close();
});

test("非法选择器返回明确错误码", () => {
  assert.throws(() => service.query(v1Id, "li:first-child"), (e: unknown) => {
    return e instanceof ApiError && e.code === "INVALID_SELECTOR";
  });
});

test("大小与长度限制", () => {
  assert.throws(() => service.importDocument("大", "x".repeat(MAX_HTML_BYTES + 1)), (e: unknown) => {
    return e instanceof ApiError && e.code === "HTML_TOO_LARGE";
  });
  assert.throws(() => service.query(v1Id, "a".repeat(600)), (e: unknown) => {
    return e instanceof ApiError && e.code === "SELECTOR_TOO_LONG";
  });
});

test("不存在的资源返回 404 错误码", () => {
  assert.throws(() => service.query(9999, "li"), (e: unknown) => {
    return e instanceof ApiError && e.code === "VERSION_NOT_FOUND" && e.status === 404;
  });
});
