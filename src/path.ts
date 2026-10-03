import type { DomNode } from "./dom.js";

export function stablePath(node: DomNode): string {
  const segments: string[] = [];
  let current: DomNode | null = node;
  while (current && current.tag !== "#root") {
    const parent: DomNode | null = current.parent;
    let index = 1;
    if (parent) {
      for (const sibling of parent.children) {
        if (sibling === current) break;
        if (sibling.tag === current.tag) index += 1;
      }
    }
    segments.push(`${current.tag}[${index}]`);
    current = parent;
  }
  return segments.reverse().join(" > ");
}
