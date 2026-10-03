import type { DatabaseSync } from "node:sqlite";
import { Buffer } from "node:buffer";
import { AppError } from "./errors.js";
import { LIMITS } from "./limits.js";
import { parseHtml, getSnippet, type DomNode, type ParsedDocument } from "./dom.js";
import { stablePath } from "./path.js";
import { parseSelector, matchAll, serializeGroupSelector, type GroupExplanation } from "./selector.js";

export interface VersionSummary {
  versionId: number;
  documentId: number;
  versionNo: number;
  title: string;
  nodeCount: number;
  createdAt: string;
}

export interface HitView {
  nodeId: number;
  tag: string;
  id: string | null;
  classes: string[];
  attributes: Record<string, string>;
  text: string;
  path: string;
  matchedGroups: number[];
}

export interface QueryResult {
  queryId: number;
  versionId: number;
  selector: string;
  groups: string[];
  total: number;
  hits: HitView[];
  explanations: Record<number, GroupExplanation[]>;
}

export interface ReportRecord extends QueryResult {
  reportId: number;
  savedAt: string;
}

interface VersionRow {
  id: number;
  document_id: number;
  version_no: number;
  html: string;
  created_at: string;
}

interface DocumentRow {
  id: number;
  title: string;
}

export class SelectorService {
  constructor(private readonly db: DatabaseSync) {}

  importDocument(input: { title?: string; html?: string; documentId?: number }): VersionSummary {
    const html = input.html ?? "";
    if (typeof html !== "string" || html.trim().length === 0) {
      throw new AppError("EMPTY_DOCUMENT", "HTML 内容为空");
    }
    const byteLength = Buffer.byteLength(html, "utf8");
    if (byteLength > LIMITS.MAX_HTML_BYTES) {
      throw new AppError(
        "DOCUMENT_TOO_LARGE",
        `HTML 大小 ${byteLength} 字节超过上限 ${LIMITS.MAX_HTML_BYTES} 字节`,
      );
    }

    let documentId = input.documentId;
    let title = (input.title ?? "").trim();
    if (documentId === undefined) {
      if (title.length === 0) title = `文档-${new Date().toISOString().slice(0, 19)}`;
      const info = this.db
        .prepare("INSERT INTO documents (title) VALUES (?)")
        .run(title);
      documentId = Number(info.lastInsertRowid);
    } else {
      const doc = this.db
        .prepare("SELECT id, title FROM documents WHERE id = ?")
        .get(documentId) as DocumentRow | undefined;
      if (!doc) throw new AppError("NOT_FOUND", `文档 ${documentId} 不存在`);
      if (title.length > 0) {
        this.db.prepare("UPDATE documents SET title = ? WHERE id = ?").run(title, documentId);
      } else {
        title = doc.title;
      }
    }

    const maxRow = this.db
      .prepare("SELECT COALESCE(MAX(version_no), 0) AS max_no FROM versions WHERE document_id = ?")
      .get(documentId) as { max_no: number };
    const versionNo = Number(maxRow.max_no) + 1;
    const parsed = parseHtml(html);
    const info = this.db
      .prepare("INSERT INTO versions (document_id, version_no, html, node_count) VALUES (?, ?, ?, ?)")
      .run(documentId, versionNo, html, parsed.nodes.length);
    const versionId = Number(info.lastInsertRowid);
    const row = this.db.prepare("SELECT created_at FROM versions WHERE id = ?").get(versionId) as {
      created_at: string;
    };
    return {
      versionId,
      documentId: documentId!,
      versionNo,
      title,
      nodeCount: parsed.nodes.length,
      createdAt: row.created_at,
    };
  }

  listVersions(documentId?: number): (VersionSummary & { htmlBytes: number })[] {
    const rows = this.db
      .prepare(
        `SELECT v.id, v.document_id, v.version_no, v.created_at, length(v.html) AS bytes, v.node_count, d.title
         FROM versions v JOIN documents d ON d.id = v.document_id
         ${documentId === undefined ? "" : "WHERE v.document_id = ?"}
         ORDER BY v.document_id, v.version_no`,
      )
      .all(...(documentId === undefined ? [] : [documentId])) as unknown as (Omit<VersionRow, "html"> & {
      bytes: number;
      node_count: number;
      title: string;
    })[];
    return rows.map((row) => ({
      versionId: row.id,
      documentId: row.document_id,
      versionNo: row.version_no,
      title: row.title,
      nodeCount: row.node_count,
      htmlBytes: Number(row.bytes),
      createdAt: row.created_at,
    }));
  }

  getVersion(versionId: number): { html: string; parsed: ParsedDocument } {
    const row = this.db.prepare("SELECT html FROM versions WHERE id = ?").get(versionId) as
      | VersionRow
      | undefined;
    if (!row) throw new AppError("NOT_FOUND", `版本 ${versionId} 不存在`);
    return { html: row.html, parsed: parseHtml(row.html) };
  }

  query(versionId: number, selectorRaw: string, save = false): QueryResult {
    const { parsed } = this.getVersion(versionId);
    const parsedSelector = parseSelector(selectorRaw, LIMITS.MAX_SELECTOR_LENGTH);
    const groupSources = parsedSelector.groups.map(serializeGroupSelector);
    const matched = matchAll(parsed.nodes, parsedSelector.groups, groupSources);

    const hits: HitView[] = [];
    const explanations: Record<number, GroupExplanation[]> = {};
    for (const node of parsed.nodes) {
      const explanation = matched.get(node.id);
      if (!explanation) continue;
      hits.push(this.toHitView(node, explanation));
      explanations[node.id] = explanation;
    }

    const info = this.db
      .prepare("INSERT INTO queries (version_id, selector) VALUES (?, ?)")
      .run(versionId, parsedSelector.source);
    const queryId = Number(info.lastInsertRowid);

    const result: QueryResult = {
      queryId,
      versionId,
      selector: parsedSelector.source,
      groups: groupSources,
      total: hits.length,
      hits,
      explanations,
    };

    if (save) {
      this.db.prepare("INSERT INTO reports (query_id, payload) VALUES (?, ?)").run(
        queryId,
        JSON.stringify(result),
      );
    }
    return result;
  }

  getReport(reportId: number): ReportRecord {
    const row = this.db
      .prepare(
        `SELECT r.id AS report_id, r.payload, r.created_at, q.version_id
         FROM reports r JOIN queries q ON q.id = r.query_id WHERE r.id = ?`,
      )
      .get(reportId) as { report_id: number; payload: string; created_at: string; version_id: number } | undefined;
    if (!row) throw new AppError("NOT_FOUND", `报告 ${reportId} 不存在`);
    const payload = JSON.parse(row.payload) as QueryResult;
    return { ...payload, reportId: row.report_id, savedAt: row.created_at };
  }

  listReports(): { reportId: number; queryId: number; versionId: number; selector: string; createdAt: string }[] {
    const rows = this.db
      .prepare(
        `SELECT r.id AS report_id, r.created_at, q.id AS query_id, q.version_id, q.selector
         FROM reports r JOIN queries q ON q.id = r.query_id ORDER BY r.id`,
      )
      .all() as unknown as {
      report_id: number;
      query_id: number;
      version_id: number;
      selector: string;
      created_at: string;
    }[];
    return rows.map((row) => ({
      reportId: row.report_id,
      queryId: row.query_id,
      versionId: row.version_id,
      selector: row.selector,
      createdAt: row.created_at,
    }));
  }

  compare(versionAId: number, versionBId: number, selectorRaw: string): {
    selector: string;
    a: { versionId: number; total: number; paths: string[] };
    b: { versionId: number; total: number; paths: string[] };
    added: string[];
    removed: string[];
    retained: string[];
  } {
    const run = (versionId: number) => {
      const { parsed } = this.getVersion(versionId);
      const parsedSelector = parseSelector(selectorRaw, LIMITS.MAX_SELECTOR_LENGTH);
      const sources = parsedSelector.groups.map(serializeGroupSelector);
      const matched = matchAll(parsed.nodes, parsedSelector.groups, sources);
      const paths = parsed.nodes
        .filter((node) => matched.has(node.id))
        .map((node) => stablePath(node));
      return { versionId, total: paths.length, paths };
    };
    const a = run(versionAId);
    const b = run(versionBId);
    const setB = new Set(b.paths);
    const setA = new Set(a.paths);
    return {
      selector: selectorRaw.trim(),
      a,
      b,
      added: b.paths.filter((path) => !setA.has(path)),
      removed: a.paths.filter((path) => !setB.has(path)),
      retained: a.paths.filter((path) => setB.has(path)),
    };
  }

  private toHitView(node: DomNode, explanation: GroupExplanation[]): HitView {
    return {
      nodeId: node.id,
      tag: node.tag,
      id: node.attrs.id ?? null,
      classes: (node.attrs.class ?? "").trim().split(/\s+/).filter(Boolean),
      attributes: node.attrs,
      text: getSnippet(node, LIMITS.MAX_TEXT_SNIPPET_LENGTH),
      path: stablePath(node),
      matchedGroups: explanation.map((entry) => entry.groupIndex),
    };
  }
}
