// HTML 解析与节点模型：使用 parse5 处理实体与树结构，
// 自行维护节点索引、稳定路径与文档顺序。
import * as parse5 from "parse5";
import type { MatchNode } from "./selector";

export interface HtmlNode extends MatchNode {
  index: number; // 文档顺序（先序）编号，从 0 开始
  path: string; // 形如 /html/body/div[2]/li[1]，同一版本内稳定
  attrs: Record<string, string>;
  children: HtmlNode[];
  textSnippet: string;
}

const VOID_OR_SKIP = new Set(["script", "style"]);

function collectText(el: parse5.DefaultTreeAdapterMap["element"], out: string[], limit: number): void {
  if (out.join("").length > limit) return;
  for (const child of el.childNodes) {
    if (child.nodeName === "#text") {
      out.push((child as parse5.DefaultTreeAdapterMap["textNode"]).value);
    } else if ((child as parse5.DefaultTreeAdapterMap["element"]).tagName) {
      const ce = child as parse5.DefaultTreeAdapterMap["element"];
      if (!VOID_OR_SKIP.has(ce.tagName)) collectText(ce, out, limit);
    }
  }
}

export function parseHtml(html: string): HtmlNode[] {
  const doc = parse5.parse(html);
  const roots: HtmlNode[] = [];
  let counter = 0;

  const build = (
    el: parse5.DefaultTreeAdapterMap["element"],
    parent: HtmlNode | null,
    parentPath: string,
    siblingTagCounts: Map<string, number>
  ): HtmlNode => {
    const tag = el.tagName.toLowerCase();
    const n = (siblingTagCounts.get(tag) ?? 0) + 1;
    siblingTagCounts.set(tag, n);
    const path = parentPath + "/" + tag + "[" + n + "]";

    const attrs: Record<string, string> = {};
    for (const a of el.attrs) {
      // 属性名统一小写（HTML 规范），属性值保持原样
      attrs[a.name.toLowerCase()] = a.value;
    }
    const classList = (attrs["class"] ?? "").split(/\s+/).filter((s) => s.length > 0);

    const node: HtmlNode = {
      index: counter++,
      path,
      tag,
      id: attrs["id"] ?? null,
      classList,
      attrs,
      parent,
      children: [],
      textSnippet: "",
      getAttr(name: string): string | null {
        const key = name.toLowerCase();
        return key in this.attrs ? this.attrs[key] : null;
      },
    };

    const textParts: string[] = [];
    collectText(el, textParts, 200);
    node.textSnippet = textParts.join(" ").replace(/\s+/g, " ").trim().slice(0, 80);

    const childCounts = new Map<string, number>();
    for (const child of el.childNodes) {
      const ce = child as parse5.DefaultTreeAdapterMap["element"];
      if (ce.tagName) {
        node.children.push(build(ce, node, path, childCounts));
      }
    }
    return node;
  };

  const topCounts = new Map<string, number>();
  const walk = (parent: parse5.DefaultTreeAdapterMap["parentNode"], parentNode: HtmlNode | null, parentPath: string) => {
    for (const child of parent.childNodes) {
      const ce = child as parse5.DefaultTreeAdapterMap["element"];
      if (ce.tagName) {
        const node = build(ce, parentNode, parentPath, topCounts);
        if (parentNode) parentNode.children.push(node);
        else roots.push(node);
      }
    }
  };
  walk(doc, null, "");
  return roots;
}

/** 先序展开为文档顺序数组 */
export function flatten(roots: HtmlNode[]): HtmlNode[] {
  const out: HtmlNode[] = [];
  const visit = (n: HtmlNode) => {
    out.push(n);
    n.children.forEach(visit);
  };
  roots.forEach(visit);
  return out;
}
