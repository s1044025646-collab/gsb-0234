// SQLite 持久化：文档、版本、查询记录、报告。
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

export interface DocumentRow {
  id: number;
  name: string;
  created_at: string;
}

export interface VersionRow {
  id: number;
  document_id: number;
  version_no: number;
  html: string;
  created_at: string;
}

export interface QueryRow {
  id: number;
  version_id: number;
  selector: string;
  result_count: number;
  created_at: string;
}

export interface ReportRow {
  id: number;
  query_id: number;
  name: string;
  payload: string;
  created_at: string;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(
      "PRAGMA journal_mode = WAL;" +
      "CREATE TABLE IF NOT EXISTS documents (" +
      " id INTEGER PRIMARY KEY AUTOINCREMENT," +
      " name TEXT NOT NULL," +
      " created_at TEXT NOT NULL DEFAULT (datetime('now'))" +
      ");" +
      "CREATE TABLE IF NOT EXISTS versions (" +
      " id INTEGER PRIMARY KEY AUTOINCREMENT," +
      " document_id INTEGER NOT NULL REFERENCES documents(id)," +
      " version_no INTEGER NOT NULL," +
      " html TEXT NOT NULL," +
      " created_at TEXT NOT NULL DEFAULT (datetime('now'))," +
      " UNIQUE(document_id, version_no)" +
      ");" +
      "CREATE TABLE IF NOT EXISTS queries (" +
      " id INTEGER PRIMARY KEY AUTOINCREMENT," +
      " version_id INTEGER NOT NULL REFERENCES versions(id)," +
      " selector TEXT NOT NULL," +
      " result_count INTEGER NOT NULL," +
      " created_at TEXT NOT NULL DEFAULT (datetime('now'))" +
      ");" +
      "CREATE TABLE IF NOT EXISTS reports (" +
      " id INTEGER PRIMARY KEY AUTOINCREMENT," +
      " query_id INTEGER NOT NULL REFERENCES queries(id)," +
      " name TEXT NOT NULL," +
      " payload TEXT NOT NULL," +
      " created_at TEXT NOT NULL DEFAULT (datetime('now'))" +
      ");"
    );
  }

  createDocument(name: string): DocumentRow {
    const r = this.db.prepare("INSERT INTO documents (name) VALUES (?)").run(name);
    return this.getDocument(Number(r.lastInsertRowid))!;
  }

  getDocument(id: number): DocumentRow | null {
    return (this.db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as unknown as DocumentRow) ?? null;
  }

  listDocuments(): DocumentRow[] {
    return this.db.prepare("SELECT * FROM documents ORDER BY id").all() as unknown as DocumentRow[];
  }

  addVersion(documentId: number, html: string): VersionRow {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(version_no), 0) + 1 AS next FROM versions WHERE document_id = ?")
      .get(documentId) as { next: number };
    const r = this.db
      .prepare("INSERT INTO versions (document_id, version_no, html) VALUES (?, ?, ?)")
      .run(documentId, row.next, html);
    return this.getVersion(Number(r.lastInsertRowid))!;
  }

  getVersion(id: number): VersionRow | null {
    return (this.db.prepare("SELECT * FROM versions WHERE id = ?").get(id) as unknown as VersionRow) ?? null;
  }

  listVersions(documentId: number): VersionRow[] {
    return this.db
      .prepare("SELECT id, document_id, version_no, created_at FROM versions WHERE document_id = ? ORDER BY version_no")
      .all(documentId) as unknown as VersionRow[];
  }

  recordQuery(versionId: number, selector: string, resultCount: number): QueryRow {
    const r = this.db
      .prepare("INSERT INTO queries (version_id, selector, result_count) VALUES (?, ?, ?)")
      .run(versionId, selector, resultCount);
    return this.getQuery(Number(r.lastInsertRowid))!;
  }

  getQuery(id: number): QueryRow | null {
    return (this.db.prepare("SELECT * FROM queries WHERE id = ?").get(id) as unknown as QueryRow) ?? null;
  }

  saveReport(queryId: number, name: string, payload: string): ReportRow {
    const r = this.db
      .prepare("INSERT INTO reports (query_id, name, payload) VALUES (?, ?, ?)")
      .run(queryId, name, payload);
    return this.getReport(Number(r.lastInsertRowid))!;
  }

  getReport(id: number): ReportRow | null {
    return (this.db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as unknown as ReportRow) ?? null;
  }

  listReports(): ReportRow[] {
    return this.db.prepare("SELECT id, query_id, name, created_at FROM reports ORDER BY id").all() as unknown as ReportRow[];
  }

  close(): void {
    this.db.close();
  }
}
