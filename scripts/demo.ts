// 演示脚本：导入示例文档两个版本，展示后代 vs 直接子代、分组去重、
// 带引号属性值、命中解释、报告保存与版本比较。
import * as path from "node:path";
import * as fs from "node:fs";
import { Service } from "../src/service";
import { Store } from "../src/store";

const dbPath = path.join(process.cwd(), "data", "demo.db");
fs.rmSync(dbPath, { force: true });
const service = new Service(new Store(dbPath));

const htmlV1 = fs.readFileSync(path.join(__dirname, "..", "examples", "sample-v1.html"), "utf8");
const htmlV2 = fs.readFileSync(path.join(__dirname, "..", "examples", "sample-v2.html"), "utf8");

const show = (title: string, data: unknown) => {
  console.log("\n=== " + title + " ===");
  console.log(JSON.stringify(data, null, 2));
};

const imported = service.importDocument("示例文档", htmlV1);
const doc = imported.document;
const v2 = service.addVersion(doc.id, htmlV2);
const versions = service.listVersions(doc.id);
const v1 = versions[0];
console.log("文档 " + doc.id + "，版本 1 id=" + v1.id + "，版本 2 id=" + v2.id);

// 1. 后代查询 vs 直接子代查询
const desc = service.query(v1.id, "ul.primary li");
show("后代查询: ul.primary li（含嵌套子列表，共 " + desc.count + " 条）",
  desc.matches.map((m) => m.path + "  " + m.text));

const child = service.query(v1.id, "ul.primary > li");
show("直接子代查询: ul.primary > li（不含嵌套，共 " + child.count + " 条）",
  child.matches.map((m) => m.path + "  " + m.text));

// 2. 分组去重：.item 与 li.active 有交集，同一节点只出现一次
const grouped = service.query(v1.id, ".item, li.active");
show("分组去重: .item, li.active（共 " + grouped.count + " 条，按文档顺序）",
  grouped.matches.map((m) => m.path));

// 3. 带引号属性值（含空格和逗号）
const attrQ = service.query(v1.id, 'p[title="带 空格,逗号 的标题"]');
show("带引号属性值: p[title=...]", attrQ.matches.map((m) => m.path));

// 4. 命中解释
const expl = service.explain(child.queryId);
show("命中解释（ul.primary > li 第一条）", expl.matches[0]);

// 5. 保存报告（对应版本 1 的树）
const report = service.saveReport(desc.queryId, "v1-后代查询报告");
show("已保存报告", report);

// 6. 版本比较：同一选择器在 v1 / v2 上的差异
const cmp = service.compare(v1.id, v2.id, "ul.primary li");
show("版本比较: ul.primary li（v1 vs v2）", {
  v1数量: cmp.versionA.count,
  v2数量: cmp.versionB.count,
  仅v2有: cmp.onlyInB.map((m) => m.path + "  " + m.text),
  仅v1有: cmp.onlyInA.map((m) => m.path + "  " + m.text),
});

// 7. 旧报告仍对应原始树（v1 有 8 条 li，v2 有 9 条）
const saved = service.getReport(report.id);
show("旧报告保留（仍对应 v1 的树）", { 报告命中数: saved.detail.count });

console.log("\n演示完成，数据库: " + dbPath);
