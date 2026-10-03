import { parse, type DefaultTreeAdapterMap } from "parse5";

export type P5Node = DefaultTreeAdapterMap["node"];
export type P5Element = DefaultTreeAdapterMap["element"];
export type P5Text = DefaultTreeAdapterMap["textNode"];

export interface DomNode {
  id: number;
  tag: string;
  attrs: Record<string, string>;
  text: string;
  parent: DomNode | null;
  children: DomNode[];
}

export interface ParsedDocument {
  root: DomNode;
  nodes: DomNode[];
}

function isElement(node: P5Node): node is P5Element {
  return node.nodeName !== "#text" && node.nodeName !== "#comment" && "tagName" in node;
}

function collectText(node: P5Node): string {
  if (node.nodeName === "#text") {
    return (node as P5Text).value;
  }
  if ("childNodes" in node) {
    return node.childNodes.map(collectText).join("");
  }
  return "";
}

export function parseHtml(html: string): ParsedDocument {
  const documentNode = parse(html);
  const root: DomNode = {
    id: -1,
    tag: "#root",
    attrs: {},
    text: "",
    parent: null,
    children: [],
  };
  const nodes: DomNode[] = [];

  const walk = (p5Node: P5Node, parent: DomNode): void => {
    if (!isElement(p5Node)) return;
    const tag = p5Node.tagName;
    const attrs: Record<string, string> = {};
    for (const attr of p5Node.attrs) {
      attrs[attr.name] = attr.value;
    }
    const domNode: DomNode = {
      id: nodes.length,
      tag,
      attrs,
      text: collectText(p5Node).replace(/\s+/g, " ").trim(),
      parent,
      children: [],
    };
    nodes.push(domNode);
    parent.children.push(domNode);
    for (const child of p5Node.childNodes) {
      walk(child, domNode);
    }
  };

  for (const child of documentNode.childNodes) {
    walk(child, root);
  }

  return { root, nodes };
}

export function getSnippet(node: DomNode, maxLength: number): string {
  if (node.text.length <= maxLength) return node.text;
  return node.text.slice(0, maxLength - 1) + "…";
}
