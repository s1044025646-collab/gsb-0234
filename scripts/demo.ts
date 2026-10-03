import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.js";
import { SelectorService } from "../src/service.js";
import { DEMO_HTML_V1, DEMO_HTML_V2 } from "./fixtures.js";

const dir = mkdtempSync(join(tmpdir(), "html-selector-demo-"));
const db = openDatabase(join(dir, "demo.sqlite"));
const service = new SelectorService(db);

const heading = (text: string): void => {
  console.log(`\n=== ${text} ===`);
};

const v1 = service.importDocument({ title: "演示站点导航", html: DEMO_HTML_V1 });
heading("导入 v1");
console.log(v1);

const v2 = service.importDocument({ documentId: v1.documentId, html: DEMO_HTML_V2 });
heading("导入 v2（同一文档新版本）");
console.log({ documentId: v2.documentId, versionNo: v2.versionNo, nodeCount: v2.nodeCount });

heading("列出版本");
console.table(service.listVersions(v1.documentId));

heading("后代查询：nav a（nav 内所有层级的 a）");
const descendant = service.query(v1.versionId, "nav a", true);
descendant.hits.forEach((hit) => console.log(`  ${hit.path}  -> ${hit.text}`));
const reportId = descendant.queryId;

heading("直接子代查询：nav > a（仅 nav 的直接 a 子节点）");
const child = service.query(v1.versionId, "nav > a");
child.hits.forEach((hit) => console.log(`  ${hit.path}  -> ${hit.text}`));

heading("分组去重：.link, a.external（API 链接同时命中两组，只返回一次）");
const grouped = service.query(v1.versionId, ".link, a.external");
grouped.hits.forEach((hit) =>
  console.log(`  ${hit.path}  groups=${hit.matchedGroups.join("/")}  ${hit.text}`),
);

heading('引号内含分隔符：[data-role="guide, quick"]');
const quoted = service.query(v1.versionId, '[data-role="guide, quick"]');
quoted.hits.forEach((hit) => console.log(`  ${hit.path}  data-role=${hit.attributes["data-role"]}`));

heading("class 按词项匹配：.dark（class=\"bar primary dark\"）");
service
  .query(v1.versionId, ".dark")
  .hits.forEach((hit) => console.log(`  ${hit.path}  class=${hit.classes.join(" ")}`));

heading("命中解释：ul.submenu > li a（部分输出）");
const explained = service.query(v1.versionId, "ul.submenu > li a");
const first = explained.hits[0];
if (first) {
  const exp = explained.explanations[first.nodeId]![0]!;
  console.log(`  节点 #${first.nodeId} <${first.tag}> ${first.path}`);
  exp.steps.forEach((step, i) => console.log(`    ${i + 1}. [${step.combinator}] #${step.matchedNode}: ${step.detail}`));
}

heading("版本比较：v1 与 v2 上执行 ul.submenu a");
const comparison = service.compare(v1.versionId, v2.versionId, "ul.submenu a");
console.log("  v1 命中:", comparison.a.paths);
console.log("  v2 命中:", comparison.b.paths);
console.log("  新增:", comparison.added);
console.log("  移除:", comparison.removed);

heading("旧报告仍对应 v1 原始树");
const report = service.getReport(reportId);
console.log(`  报告 #${report.reportId} 保存于 ${report.savedAt}，命中 ${report.total} 个（仍为 v1 的 nav a 结果）`);

heading("非法选择器被拒绝：div :hover");
try {
  service.query(v1.versionId, "div :hover");
} catch (error) {
  console.log(`  已拒绝: ${(error as Error).message}`);
}

db.close();
rmSync(dir, { recursive: true, force: true });
console.log("\n演示完成。");
