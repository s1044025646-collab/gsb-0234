// 受限 CSS 选择器：词法、语法解析与匹配。
// 支持：标签、*、#id、.class、[attr]、[attr=value]（可带引号）、
// 后代组合符（空格）、直接子代组合符（>）、逗号分组。
// 明确拒绝：伪类(:)、兄弟组合符(+ ~)、未闭合括号、空条件等非法语法。

export class SelectorError extends Error {
  readonly code = "INVALID_SELECTOR";
  constructor(message: string) {
    super(message);
    this.name = "SelectorError";
  }
}

export type AttrCond = { name: string; value: string | null };

export interface Compound {
  tag: string | null; // null 表示未指定；"*" 用 universal 表示
  universal: boolean;
  id: string | null;
  classes: string[];
  attrs: AttrCond[];
}

export type Combinator = "descendant" | "child";

export interface ComplexSelector {
  compounds: Compound[];
  combinators: Combinator[]; // 长度 = compounds.length - 1
}

export type SelectorGroup = ComplexSelector;

const IDENT_RE = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;

export function parseSelector(input: string): SelectorGroup[] {
  if (typeof input !== "string") throw new SelectorError("选择器必须是字符串");
  const src = input;
  let pos = 0;

  const peek = (): string | null => (pos < src.length ? src[pos] : null);
  const next = (): string => src[pos++];
  const error = (msg: string): never => {
    throw new SelectorError(msg + "（位置 " + pos + "）");
  };

  const skipSpaces = (): boolean => {
    let had = false;
    while (peek() !== null && /\s/.test(peek()!)) {
      pos++;
      had = true;
    }
    return had;
  };

  const readIdent = (what: string): string => {
    const start = pos;
    while (peek() !== null && /[-_a-zA-Z0-9]/.test(peek()!)) pos++;
    const ident = src.slice(start, pos);
    if (!ident || !IDENT_RE.test(ident)) error("非法的" + what + ' "' + (ident || peek()) + '"');
    return ident;
  };

  const parseAttr = (): AttrCond => {
    next(); // consume '['
    skipSpaces();
    const name = readIdent("属性名");
    skipSpaces();
    if (peek() === "]") {
      next();
      return { name, value: null };
    }
    if (peek() !== "=") error("属性 [" + name + "] 仅支持存在或等值匹配");
    next();
    skipSpaces();
    let value: string;
    const q = peek();
    if (q === '"' || q === "'") {
      next();
      const start = pos;
      while (peek() !== null && peek() !== q) pos++;
      if (peek() === null) error("属性值引号未闭合");
      value = src.slice(start, pos);
      next(); // closing quote
    } else {
      const start = pos;
      while (peek() !== null && /[-_a-zA-Z0-9]/.test(peek()!)) pos++;
      value = src.slice(start, pos);
      if (!value) error("属性值不能为空，含空格或逗号时请使用引号");
    }
    skipSpaces();
    if (peek() !== "]") error("属性选择器缺少右括号 ]");
    next();
    return { name, value };
  };

  const parseCompound = (): Compound => {
    const c: Compound = { tag: null, universal: false, id: null, classes: [], attrs: [] };
    let consumed = false;
    const ch = peek();
    if (ch === "*") {
      next();
      c.universal = true;
      consumed = true;
    } else if (ch !== null && /[_a-zA-Z]/.test(ch)) {
      c.tag = readIdent("标签名").toLowerCase();
      consumed = true;
    }
    for (;;) {
      const p = peek();
      if (p === "#") {
        next();
        const id = readIdent("id");
        if (c.id !== null) error("一个简单选择器中只能有一个 #id");
        c.id = id;
        consumed = true;
      } else if (p === ".") {
        next();
        c.classes.push(readIdent("类名"));
        consumed = true;
      } else if (p === "[") {
        c.attrs.push(parseAttr());
        consumed = true;
      } else if (p === ":") {
        error("不支持伪类选择器（:）");
      } else if (p === "+" || p === "~") {
        error("不支持兄弟组合符（+ 或 ~）");
      } else {
        break;
      }
    }
    if (!consumed) error("缺少简单选择器（标签、*、#id、.class 或 [attr]）");
    return c;
  };

  const parseComplex = (): ComplexSelector => {
    const compounds: Compound[] = [];
    const combinators: Combinator[] = [];
    skipSpaces();
    compounds.push(parseCompound());
    for (;;) {
      const hadSpace = skipSpaces();
      const p = peek();
      if (p === ">") {
        next();
        skipSpaces();
        combinators.push("child");
        compounds.push(parseCompound());
      } else if (p === null || p === ",") {
        break;
      } else if (hadSpace) {
        combinators.push("descendant");
        compounds.push(parseCompound());
      } else {
        error('无法识别的字符 "' + p + '"');
      }
    }
    return { compounds, combinators };
  };

  const groups: SelectorGroup[] = [];
  skipSpaces();
  if (peek() === null) throw new SelectorError("选择器不能为空");
  groups.push(parseComplex());
  for (;;) {
    skipSpaces();
    if (peek() === null) break;
    if (peek() !== ",") error('无法识别的字符 "' + peek() + '"');
    next();
    skipSpaces();
    if (peek() === null || peek() === ",") error("逗号后缺少选择器");
    groups.push(parseComplex());
  }
  return groups;
}

// 可被匹配的节点视图（由 DOM 层实现）
export interface MatchNode {
  tag: string;
  id: string | null;
  classList: string[];
  getAttr(name: string): string | null;
  parent: MatchNode | null;
}

export function matchCompound(node: MatchNode, c: Compound): boolean {
  if (c.tag !== null && node.tag !== c.tag) return false;
  if (c.id !== null && node.id !== c.id) return false;
  for (const cls of c.classes) {
    if (!node.classList.includes(cls)) return false;
  }
  for (const attr of c.attrs) {
    const v = node.getAttr(attr.name);
    if (v === null) return false;
    if (attr.value !== null && v !== attr.value) return false;
  }
  return true;
}

// 判断节点是否命中一个复合选择器（从右向左回溯祖先链）
export function matchComplex(node: MatchNode, sel: ComplexSelector): boolean {
  const last = sel.compounds.length - 1;
  if (!matchCompound(node, sel.compounds[last])) return false;
  let current: MatchNode | null = node;
  for (let i = last - 1; i >= 0; i--) {
    const comb = sel.combinators[i];
    const target = sel.compounds[i];
    if (comb === "child") {
      current = current!.parent;
      if (current === null || !matchCompound(current, target)) return false;
    } else {
      let anc: MatchNode | null = current!.parent;
      let found: MatchNode | null = null;
      while (anc !== null) {
        if (matchCompound(anc, target)) {
          found = anc;
          break;
        }
        anc = anc.parent;
      }
      if (found === null) return false;
      current = found;
    }
  }
  return true;
}

export function matchGroups(node: MatchNode, groups: SelectorGroup[]): boolean {
  return groups.some((g) => matchComplex(node, g));
}
