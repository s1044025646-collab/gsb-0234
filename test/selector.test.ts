import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtml } from "../src/dom.js";
import { stablePath } from "../src/path.js";
import { matchAll, parseSelector, serializeGroupSelector } from "../src/selector.js";
import { AppError } from "../src/errors.js";
import { FIXED_DOM, pathsOf } from "./fixture.js";

function run(html: string, selector: string) {
  const { nodes } = parseHtml(html);
  const parsed = parseSelector(selector, 300);
  const sources = parsed.groups.map(serializeGroupSelector);
  const matched = matchAll(nodes, parsed.groups, sources);
  return nodes
    .filter((node) => matched.has(node.id))
    .map((node) => ({ id: node.id, tag: node.tag, path: stablePath(node), groups: matched.get(node.id)!.map((e) => e.groupIndex) }));
}

test("标签与通配符", () => {
  assert.equal(run(FIXED_DOM, "h1")[0]!.tag, "h1");
  assert.ok(run(FIXED_DOM, "*").length >= 10);
});

test("id 与组合标签属性条件", () => {
  assert.deepEqual(pathsOf(run(FIXED_DOM, "div#root")), ["html[1] > body[1] > div[1]"]);
  assert.deepEqual(run(FIXED_DOM, "div#nope"), []);
  assert.deepEqual(run(FIXED_DOM, "a.link.special").map((h) => h.path), [
    "html[1] > body[1] > div[1] > ul[1] > li[1] > ul[1] > li[1] > a[1]",
    "html[1] > body[1] > div[1] > a[1]",
  ]);
});

test("class 按空格词项匹配，不做子串匹配", () => {
  assert.equal(run(FIXED_DOM, ".wrap").length, 1);
  assert.equal(run(FIXED_DOM, ".wra").length, 0);
  assert.equal(run(FIXED_DOM, "ul.list").length, 2);
});

test("后代与直接子代必须区分", () => {
  const descendant = run(FIXED_DOM, "div a");
  assert.equal(descendant.length, 4);
  const child = run(FIXED_DOM, "div > a");
  assert.deepEqual(pathsOf(child), ["html[1] > body[1] > div[1] > a[1]"]);
  const nestedChild = run(FIXED_DOM, "ul.list > li");
  assert.equal(nestedChild.length, 3);
  const nestedDescendant = run(FIXED_DOM, "ul.list li");
  assert.equal(nestedDescendant.length, 3);
  assert.equal(run(FIXED_DOM, "header > h1").length, 1);
  assert.equal(run(FIXED_DOM, "div > h1").length, 0);
});

test("属性存在与等值", () => {
  assert.equal(run(FIXED_DOM, "[href]").length, 4);
  assert.deepEqual(pathsOf(run(FIXED_DOM, 'a[href="/deep"]')), [
    "html[1] > body[1] > div[1] > ul[1] > li[1] > ul[1] > li[1] > a[1]",
  ]);
  assert.equal(run(FIXED_DOM, '[href="/nope"]').length, 0);
});

test("引号属性值中的空格与逗号不切开分组或组合符", () => {
  const hits = run(FIXED_DOM, '[data-tags="alpha, beta"]');
  assert.equal(hits.length, 1);
  assert.match(hits[0]!.path, /header/);
  assert.equal(run(FIXED_DOM, 'a[data-tags="alpha beta"]').length, 0);
});

test("逗号分组按文档顺序去重", () => {
  const hits = run(FIXED_DOM, "a, a.link");
  const paths = pathsOf(hits);
  assert.equal(paths.length, new Set(paths).size);
  assert.deepEqual(paths, [
    "html[1] > body[1] > div[1] > header[1] > a[1]",
    "html[1] > body[1] > div[1] > ul[1] > li[1] > ul[1] > li[1] > a[1]",
    "html[1] > body[1] > div[1] > ul[1] > li[2] > a[1]",
    "html[1] > body[1] > div[1] > a[1]",
  ]);
  const special = run(FIXED_DOM, "a, a.special");
  const specialLinks = special.filter((h) => h.path.endsWith("a[1]") && h.groups.length === 2);
  assert.equal(specialLinks.length, 2);
});

test("空结果", () => {
  assert.deepEqual(run(FIXED_DOM, "section.nope > p"), []);
});

test("拒绝伪类、兄弟组合符与非法语法", () => {
  for (const bad of ["a:hover", "li:first-child", "h1::before", "a + a", "li ~ li", "a ~ b", "div >> p", "a[href^=http]", "a[href*=x]", "> a", "a >", "a,,b", ".", "#", "a[href", "a[href=]", "a[", 'a[x="unterminated]']) {
    assert.throws(
      () => run(FIXED_DOM, bad),
      (error: unknown) => error instanceof AppError && ["SELECTOR_SYNTAX", "UNSUPPORTED_SELECTOR"].includes(error.code),
      `应当拒绝: ${bad}`,
    );
  }
});

test("tag 大小写不敏感，id/class/属性值保持大小写敏感", () => {
  const html = `<Div ID="One" class="Aaa">x</Div>`;
  assert.equal(run(html, "div").length, 1);
  assert.equal(run(html, "DIV").length, 1);
  assert.equal(run(html, "#One").length, 1);
  assert.equal(run(html, "#one").length, 0);
  assert.equal(run(html, ".Aaa").length, 1);
  assert.equal(run(html, ".aaa").length, 0);
});
