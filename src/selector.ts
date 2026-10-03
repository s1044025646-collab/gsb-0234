import { AppError } from "./errors.js";
import type { DomNode } from "./dom.js";

export type Combinator = "descendant" | "child";

export interface SimpleSelector {
  tag: string | null;
  id: string | null;
  classes: string[];
  attributes: AttrCondition[];
}

export interface AttrCondition {
  name: string;
  operator: null | "=";
  value: string | null;
}

export interface ComplexSelector {
  parts: { combinator: Combinator; simple: SimpleSelector }[];
}

export interface ExplanationStep {
  combinator: "self" | Combinator;
  tag: string | null;
  matchedNode: number;
  detail: string;
}

export interface GroupExplanation {
  groupIndex: number;
  selector: string;
  steps: ExplanationStep[];
}

const IDENT_RE = /^-?[A-Za-z_][A-Za-z0-9_-]*/;

export function splitGroups(input: string): { text: string; start: number }[] {
  const groups: { text: string; start: number }[] = [];
  let current = "";
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (quote) {
      current += ch;
      if (ch === "\\") {
        if (i + 1 < input.length) {
          current += input[i + 1];
          i += 1;
        }
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      groups.push({ text: current, start });
      current = "";
      start = i + 1;
    } else {
      current += ch;
    }
  }
  if (quote) {
    throw new AppError("SELECTOR_SYNTAX", "属性值引号未闭合", { position: start + current.length });
  }
  groups.push({ text: current, start });
  return groups;
}

class Parser {
  private pos = 0;

  constructor(private readonly src: string, private readonly baseOffset: number) {}

  private fail(message: string, unsupported = false): never {
    throw new AppError(
      unsupported ? "UNSUPPORTED_SELECTOR" : "SELECTOR_SYNTAX",
      message,
      { position: this.baseOffset + this.pos },
    );
  }

  private peek(): string {
    return this.src[this.pos] ?? "";
  }

  private skipSpaces(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos]!)) this.pos += 1;
  }

  parse(): ComplexSelector {
    this.skipSpaces();
    const first = this.parseSimple();
    const parts: ComplexSelector["parts"] = [{ combinator: "descendant", simple: first }];
    for (;;) {
      const saved = this.pos;
      this.skipSpaces();
      if (this.pos >= this.src.length) break;
      let combinator: Combinator;
      const ch = this.peek();
      if (ch === ">") {
        this.pos += 1;
        this.skipSpaces();
        combinator = "child";
      } else if (/\s/.test(this.src[saved] ?? "")) {
        combinator = "descendant";
      } else {
        combinator = "descendant";
      }
      if (this.pos >= this.src.length) this.fail("组合符后缺少简单选择器");
      parts.push({ combinator, simple: this.parseSimple() });
    }
    return { parts };
  }

  private readIdent(): string {
    const rest = this.src.slice(this.pos);
    const match = IDENT_RE.exec(rest);
    if (!match || match[0] === undefined) {
      this.fail(`非法标识符，位置 ${this.baseOffset + this.pos}`);
    }
    this.pos += match[0].length;
    return match[0];
  }

  private parseSimple(): SimpleSelector {
    const simple: SimpleSelector = { tag: null, id: null, classes: [], attributes: [] };
    let sawCondition = false;
    for (;;) {
      const ch = this.peek();
      if (ch === "") break;
      if (ch === "*") {
        this.pos += 1;
        sawCondition = true;
      } else if (/[A-Za-z_-]/.test(ch)) {
          simple.tag = this.readIdent().toLowerCase();
          sawCondition = true;
      } else if (ch === "#") {
        this.pos += 1;
        simple.id = this.readIdent();
        sawCondition = true;
      } else if (ch === ".") {
        this.pos += 1;
        simple.classes.push(this.readIdent());
        sawCondition = true;
      } else if (ch === "[") {
        this.parseAttribute(simple);
        sawCondition = true;
      } else if (/\s/.test(ch) || ch === ">") {
        break;
      } else if (ch === ":") {
        this.fail("不支持伪类与伪元素", true);
      } else if (ch === "+" || ch === "~") {
        this.fail("不支持兄弟组合符（+ / ~）", true);
      } else {
        this.fail(`无法识别的字符 "${ch}"`);
      }
    }
    if (!sawCondition) {
      this.fail("空的简单选择器");
    }
    return simple;
  }

  private parseAttribute(simple: SimpleSelector): void {
    this.pos += 1;
    this.skipSpaces();
    const name = this.readIdent();
    this.skipSpaces();
    const condition: AttrCondition = { name, operator: null, value: null };
    const ch = this.peek();
    if (ch === "=") {
      this.pos += 1;
      this.skipSpaces();
      condition.operator = "=";
      condition.value = this.readAttrValue();
      this.skipSpaces();
    } else if (ch === "~" || ch === "|" || ch === "^" || ch === "$" || ch === "*") {
      this.fail("仅支持属性存在与 = 等值匹配", true);
    }
    if (this.peek() !== "]") {
      this.fail("属性选择器缺少右方括号 ]");
    }
    this.pos += 1;
    simple.attributes.push(condition);
  }

  private readAttrValue(): string {
    const quote = this.peek();
    if (quote === '"' || quote === "'") {
      this.pos += 1;
      let value = "";
      while (this.pos < this.src.length && this.src[this.pos] !== quote) {
        const ch = this.src[this.pos]!;
        if (ch === "\\") {
          this.pos += 1;
          value += this.src[this.pos] ?? "";
        } else {
          value += ch;
        }
        this.pos += 1;
      }
      if (this.pos >= this.src.length) this.fail("属性值引号未闭合");
      this.pos += 1;
      return value;
    }
    const rest = this.src.slice(this.pos);
    const match = /^[A-Za-z0-9_-]+/.exec(rest);
    if (!match || match[0] === undefined) {
      this.fail("未加引号的属性值只能包含字母、数字、下划线与连字符");
    }
    this.pos += match[0].length;
    return match[0];
  }
}

export function parseSelector(raw: string, maxLength: number): { source: string; groups: ComplexSelector[] } {
  const source = raw.trim();
  if (source.length === 0) {
    throw new AppError("SELECTOR_SYNTAX", "选择器为空");
  }
  if (raw.length > maxLength) {
    throw new AppError("SELECTOR_TOO_LONG", `选择器长度超过上限 ${maxLength} 字符`);
  }
  const rawGroups = splitGroups(source);
  const groups: ComplexSelector[] = [];
  for (const group of rawGroups) {
    const text = group.text.trim();
    if (text.length === 0) {
      throw new AppError("SELECTOR_SYNTAX", "存在空的分组", { position: group.start });
    }
    groups.push(new Parser(text, group.start).parse());
  }
  return { source, groups };
}

function classTokens(node: DomNode): string[] {
  return (node.attrs.class ?? "").trim().split(/\s+/).filter(Boolean);
}

export function matchSimple(node: DomNode, simple: SimpleSelector): string[] {
  const reasons: string[] = [];
  if (simple.tag !== null && node.tag.toLowerCase() !== simple.tag) {
    return [];
  }
  if (simple.tag !== null) reasons.push(`标签 <${node.tag}> 匹配 ${simple.tag}`);
  if (simple.id !== null) {
    if (node.attrs.id !== simple.id) return [];
    reasons.push(`id="${simple.id}" 相等`);
  }
  for (const cls of simple.classes) {
    if (!classTokens(node).includes(cls)) return [];
    reasons.push(`class 词项包含 "${cls}"`);
  }
  for (const attr of simple.attributes) {
    if (!(attr.name in node.attrs)) return [];
    if (attr.operator === "=") {
      if (node.attrs[attr.name] !== attr.value) return [];
      reasons.push(`属性 ${attr.name}="${attr.value}" 完全相等`);
    } else {
      reasons.push(`属性 ${attr.name} 存在（值为 "${node.attrs[attr.name] ?? ""}"）`);
    }
  }
  if (reasons.length === 0) reasons.push("通配符 * 匹配任意元素");
  return reasons;
}

function matchGroup(
  node: DomNode,
  group: ComplexSelector,
): ExplanationStep[] | null {
  const matchAt = (
    current: DomNode,
    partIndex: number,
  ): ExplanationStep[] | null => {
    const part = group.parts[partIndex]!;
    const reasons = matchSimple(current, part.simple);
    if (reasons.length === 0) return null;
    if (partIndex === 0) {
      return [
        {
          combinator: "self",
          tag: part.simple.tag,
          matchedNode: current.id,
          detail: reasons.join("；"),
        },
      ];
    }
    const combinator = part.combinator;
    if (combinator === "child") {
      const parent = current.parent;
      if (!parent || parent.tag === "#root") return null;
      const tail = matchAt(parent, partIndex - 1);
      if (!tail) return null;
      return [
        ...tail,
        {
          combinator: "child",
          tag: part.simple.tag,
          matchedNode: current.id,
          detail: `${reasons.join("；")}；其直接父节点（节点 #${parent.id}）满足上一条件`,
        },
      ];
    }
    let ancestor = current.parent;
    while (ancestor && ancestor.tag !== "#root") {
      const tail = matchAt(ancestor, partIndex - 1);
      if (tail) {
        return [
          ...tail,
          {
            combinator: "descendant",
            tag: part.simple.tag,
            matchedNode: current.id,
            detail: `${reasons.join("；")}；其祖先节点 #${ancestor.id} 满足上一条件`,
          },
        ];
      }
      ancestor = ancestor.parent;
    }
    return null;
  };
  return matchAt(node, group.parts.length - 1);
}

export interface MatchResult {
  node: DomNode;
  groupIndex: number;
  steps: ExplanationStep[];
}

export function matchAll(
  nodes: DomNode[],
  groups: ComplexSelector[],
  groupSources: string[],
): Map<number, GroupExplanation[]> {
  const hits = new Map<number, GroupExplanation[]>();
  for (const node of nodes) {
    const explanations: GroupExplanation[] = [];
    groups.forEach((group, groupIndex) => {
      const steps = matchGroup(node, group);
      if (steps) {
        explanations.push({ groupIndex, selector: groupSources[groupIndex]!, steps });
      }
    });
    if (explanations.length > 0) hits.set(node.id, explanations);
  }
  return hits;
}

export function serializeGroupSelector(group: ComplexSelector): string {
  return group.parts
    .map((part, i) => {
      const s = part.simple;
      let text = s.tag ?? "*";
      if (s.id) text += `#${s.id}`;
      for (const cls of s.classes) text += `.${cls}`;
      for (const attr of s.attributes) {
        text += attr.operator === "=" ? `[${attr.name}="${attr.value}"]` : `[${attr.name}]`;
      }
      if (i === 0) return text;
      return part.combinator === "child" ? `> ${text}` : text;
    })
    .join(" ");
}
