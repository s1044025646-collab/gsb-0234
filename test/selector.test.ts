// 选择器解析与匹配单元测试：固定小 DOM + 人工预期。
import { test } from "node:test";
import assert from "node:assert/strict";
import { flatten, parseHtml } from "../src/dom";
import { matchGroups, parseSelector, SelectorError } from "../src/selector";

const HTML = [
  "<!DOCTYPE html><html><body>",
  '<div id="main" class="container wide">',
  '  <ul class="list primary" data-tags="新闻, 热点">',
  '    <li class="item active" data-info="a, b">第一条</li>',
  '    <li class="item" data-info="hello world">第二条',
  '      <ul class="list nested">',
  '        <li class="item sub">子一</li>',
  '        <li class="item sub special">子二</li>',
  "      </ul>",
  "    </li>",
  '    <li class="item">第三条</li>',
  "  </ul>",
  '  <p class="note" title="带 空格,逗号 的标题">备注</p>',
  "</div>",
  "</body></html>",
].join("\n");

function paths(selector: string): string[] {
  const nodes = flatten(parseHtml(HTML));
  const groups = parseSelector(selector);
  return nodes.filter((n) => matchGroups(n, groups)).map((n) => n.path);
}

test("标签选择器", () => {
  assert.deepEqual(paths("p"), ["/html[1]/body[1]/div[1]/p[1]"]);
});

test("后代组合符跨层命中嵌套 li", () => {
  const r = paths("ul.primary li");
  assert.equal(r.length, 5); // 3 个一级 + 2 个嵌套
  assert.ok(r.includes("/html[1]/body[1]/div[1]/ul[1]/li[2]/ul[1]/li[1]"));
});

test("直接子代不包含嵌套层级", () => {
  const r = paths("ul.primary > li");
  assert.deepEqual(r, [
    "/html[1]/body[1]/div[1]/ul[1]/li[1]",
    "/html[1]/body[1]/div[1]/ul[1]/li[2]",
    "/html[1]/body[1]/div[1]/ul[1]/li[3]",
  ]);
});

test("class 按词项匹配，不是子串", () => {
  assert.deepEqual(paths(".wid"), []); // wide 不能被 wid 命中
  assert.equal(paths(".wide").length, 1);
});

test("id 与标签组合", () => {
  assert.deepEqual(paths("div#main.container"), ["/html[1]/body[1]/div[1]"]);
});

test("属性存在与等值", () => {
  assert.equal(paths("[data-info]").length, 2);
  assert.deepEqual(paths('li[data-info="hello world"]'), ["/html[1]/body[1]/div[1]/ul[1]/li[2]"]);
});

test("属性引号内的空格和逗号不被切开", () => {
  assert.equal(paths('p[title="带 空格,逗号 的标题"]').length, 1);
  assert.equal(paths("[data-tags='新闻, 热点']").length, 1);
});

test("分组去重且按文档顺序", () => {
  const r = paths("li.item, li.active, .sub");
  // li.active 与 li.item 交集只出现一次；顺序按文档先序
  assert.deepEqual(r, [
    "/html[1]/body[1]/div[1]/ul[1]/li[1]",
    "/html[1]/body[1]/div[1]/ul[1]/li[2]",
    "/html[1]/body[1]/div[1]/ul[1]/li[2]/ul[1]/li[1]",
    "/html[1]/body[1]/div[1]/ul[1]/li[2]/ul[1]/li[2]",
    "/html[1]/body[1]/div[1]/ul[1]/li[3]",
  ]);
});

test("空结果", () => {
  assert.deepEqual(paths("table .nothing"), []);
});

test("通配符", () => {
  assert.equal(paths("ul.primary > *").length, 3);
});

test("拒绝伪类", () => {
  assert.throws(() => parseSelector("li:first-child"), SelectorError);
  assert.throws(() => parseSelector("a:hover"), SelectorError);
});

test("拒绝兄弟组合符", () => {
  assert.throws(() => parseSelector("li + li"), SelectorError);
  assert.throws(() => parseSelector("li ~ li"), SelectorError);
});

test("拒绝非法语法", () => {
  assert.throws(() => parseSelector(""), SelectorError);
  assert.throws(() => parseSelector("li,"), SelectorError);
  assert.throws(() => parseSelector("[data-info"), SelectorError);
  assert.throws(() => parseSelector('p[title="未闭合'), SelectorError);
  assert.throws(() => parseSelector("div..a"), SelectorError);
  assert.throws(() => parseSelector("> li"), SelectorError);
});
