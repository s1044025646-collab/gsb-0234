// 业务逻辑：导入、版本、查询、解释、报告、版本比较。
import { flatten, parseHtml, type HtmlNode } from "./dom";
import { explainGroups } from "./explain";
import { matchGroups, parseSelector, SelectorError } from "./selector";
import { Store } from "./store";

export const MAX_HTML_BYTES = 1024 * 1024; // 1 MB
export const MAX_SELECTOR_LEN = 512;
export const MAX_RESULTS = 5000;

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export interface MatchResult {
  index: number;
  path: string;
  tag: string;
  id: string | null;
  classes: string[];
  attrs: Record<string, string>;
  text: string;
}

function toResult(n: HtmlNode): MatchResult {
  return {
    index: n.index,
    path: n.path,
    tag: n.tag,
    id: n.id,
    classes: n.classList,
    attrs: n.attrs,
    text: n.textSnippet,
  };
}

function validateHtml(html: unknown): string {
  if (typeof html !== "string" || html.trim().length === 0) {
    throw new ApiError("INVALID_HTML", "html 必须是非空字符串");
  }
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    throw new ApiError("HTML_TOO_LARGE", "HTML 超过大小限制（" + MAX_HTML_BYTES + " 字节）", 413);
  }
  return html;
}

function validateSelector(selector: unknown): string {
  if (typeof selector !== "string" || selector.trim().length === 0) {
    throw new ApiError("INVALID_SELECTOR", "selector 必须是非空字符串");
  }
  if (selector.length > MAX_SELECTOR_LEN) {
    throw new ApiError("SELECTOR_TOO_LONG", "选择器超过长度限制（" + MAX_SELECTOR_LEN + " 字符）", 413);
  }
  return selector;
}

export class Service {
  readonly store: Store;
  constructor(store: Store) {
    this.store = store;
  }

  importDocument(name: unknown, html: unknown) {
    const h = validateHtml(html);
    const docName = typeof name === "string" && name.trim() ? name.trim() : "未命名文档";
    const doc = this.store.createDocument(docName);
    const version = this.store.addVersion(doc.id, h);
    return { document: doc, version: { ...version, html: undefined } };
  }

  addVersion(documentId: number, html: unknown) {
    const h = validateHtml(html);
    const doc = this.store.getDocument(documentId);
    if (!doc) throw new ApiError("DOCUMENT_NOT_FOUND", "文档 " + documentId + " 不存在", 404);
    const version = this.store.addVersion(documentId, h);
    return { ...version, html: undefined };
  }

  listVersions(documentId: number) {
    const doc = this.store.getDocument(documentId);
    if (!doc) throw new ApiError("DOCUMENT_NOT_FOUND", "文档 " + documentId + " 不存在", 404);
    return this.store.listVersions(documentId);
  }

  private runQueryOnVersion(versionId: number, selector: string) {
    const version = this.store.getVersion(versionId);
    if (!version) throw new ApiError("VERSION_NOT_FOUND", "版本 " + versionId + " 不存在", 404);
    let groups;
    try {
      groups = parseSelector(selector);
    } catch (e) {
      if (e instanceof SelectorError) throw new ApiError("INVALID_SELECTOR", e.message);
      throw e;
    }
    const nodes = flatten(parseHtml(version.html));
    const matched = nodes.filter((n) => matchGroups(n, groups));
    if (matched.length > MAX_RESULTS) {
      throw new ApiError("TOO_MANY_RESULTS", "命中节点超过 " + MAX_RESULTS + " 个，请缩小查询范围", 413);
    }
    return { version, groups, matched };
  }

  query(versionId: number, selectorRaw: unknown) {
    const selector = validateSelector(selectorRaw);
    const { version, matched } = this.runQueryOnVersion(versionId, selector);
    const q = this.store.recordQuery(versionId, selector, matched.length);
    return {
      queryId: q.id,
      versionId: version.id,
      documentId: version.document_id,
      versionNo: version.version_no,
      selector,
      count: matched.length,
      matches: matched.map(toResult),
    };
  }

  explain(queryId: number) {
    const q = this.store.getQuery(queryId);
    if (!q) throw new ApiError("QUERY_NOT_FOUND", "查询 " + queryId + " 不存在", 404);
    const { version, groups, matched } = this.runQueryOnVersion(q.version_id, q.selector);
    return {
      queryId: q.id,
      versionId: version.id,
      selector: q.selector,
      count: matched.length,
      matches: matched.map((n) => ({
        ...toResult(n),
        explanation: explainGroups(n, groups) ?? [],
      })),
    };
  }

  saveReport(queryId: number, name: unknown) {
    const reportName = typeof name === "string" && name.trim() ? name.trim() : "报告-" + queryId;
    const detail = this.explain(queryId); // 重新计算并固化当前结果
    const report = this.store.saveReport(queryId, reportName, JSON.stringify(detail));
    return { id: report.id, queryId, name: report.name, createdAt: report.created_at };
  }

  getReport(id: number) {
    const r = this.store.getReport(id);
    if (!r) throw new ApiError("REPORT_NOT_FOUND", "报告 " + id + " 不存在", 404);
    return { id: r.id, queryId: r.query_id, name: r.name, createdAt: r.created_at, detail: JSON.parse(r.payload) };
  }

  compare(versionIdA: number, versionIdB: number, selectorRaw: unknown) {
    const selector = validateSelector(selectorRaw);
    const a = this.runQueryOnVersion(versionIdA, selector);
    const b = this.runQueryOnVersion(versionIdB, selector);
    const pathsA = new Map(a.matched.map((n) => [n.path, n]));
    const pathsB = new Map(b.matched.map((n) => [n.path, n]));
    const onlyA = a.matched.filter((n) => !pathsB.has(n.path)).map(toResult);
    const onlyB = b.matched.filter((n) => !pathsA.has(n.path)).map(toResult);
    const both = a.matched.filter((n) => pathsB.has(n.path)).map(toResult);
    return {
      selector,
      versionA: { versionId: versionIdA, count: a.matched.length },
      versionB: { versionId: versionIdB, count: b.matched.length },
      onlyInA: onlyA,
      onlyInB: onlyB,
      inBoth: both,
      note: "按节点路径比较；路径仅在同一版本内稳定，跨版本仅作参考",
    };
  }
}
