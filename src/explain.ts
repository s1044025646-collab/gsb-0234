// 命中解释：说明每个简单条件如何满足，以及父子/祖先关系如何成立。
import type { HtmlNode } from "./dom";
import { matchCompound, type ComplexSelector, type Compound, type SelectorGroup } from "./selector";

function describeCompound(c: Compound): string[] {
  const parts: string[] = [];
  if (c.tag !== null) parts.push(`标签为 <${c.tag}>`);
  if (c.universal) parts.push("通配符 * 匹配任意标签");
  if (c.id !== null) parts.push(`id 等于 "${c.id}"`);
  for (const cls of c.classes) parts.push(`class 词项包含 "${cls}"`);
  for (const a of c.attrs) {
    parts.push(a.value === null ? `存在属性 [${a.name}]` : `属性 [${a.name}="${a.value}"] 等值匹配`);
  }
  return parts;
}

function nodeLabel(n: HtmlNode): string {
  return `<${n.tag}> @ ${n.path}`;
}

/** 对单个复合选择器给出命中解释；未命中返回 null */
export function explainComplex(node: HtmlNode, sel: ComplexSelector): string[] | null {
  const last = sel.compounds.length - 1;
  if (!matchCompound(node, sel.compounds[last])) return null;
  const lines: string[] = [];
  lines.push(`节点 ${nodeLabel(node)} 满足最右侧条件：${describeCompound(sel.compounds[last]).join("；")}`);

  let current: HtmlNode = node;
  for (let i = last - 1; i >= 0; i--) {
    const comb = sel.combinators[i];
    const target = sel.compounds[i];
    const desc = describeCompound(target).join("；");
    if (comb === "child") {
      const p = current.parent as HtmlNode | null;
      if (!p || !matchCompound(p, target)) return null;
      lines.push(`直接父节点 ${nodeLabel(p)} 满足：${desc}`);
      current = p;
    } else {
      let anc = current.parent as HtmlNode | null;
      while (anc && !matchCompound(anc, target)) anc = anc.parent as HtmlNode | null;
      if (!anc) return null;
      lines.push(`祖先节点 ${nodeLabel(anc)} 满足：${desc}（后代关系，允许跨层）`);
      current = anc;
    }
  }
  return lines;
}

export function explainGroups(node: HtmlNode, groups: SelectorGroup[]): string[] | null {
  for (let i = 0; i < groups.length; i++) {
    const lines = explainComplex(node, groups[i]);
    if (lines) {
      if (groups.length > 1) lines.unshift(`命中第 ${i + 1} 组选择器`);
      return lines;
    }
  }
  return null;
}
