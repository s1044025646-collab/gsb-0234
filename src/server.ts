// HTTP API 服务（node:http，无外部依赖）。
import * as http from "node:http";
import * as net from "node:net";
import { ApiError, Service } from "./service";

function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new ApiError("PAYLOAD_TOO_LARGE", "请求体过大", 413));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseJson(body: string): Record<string, unknown> {
  if (!body.trim()) return {};
  try {
    const v = JSON.parse(body);
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new ApiError("INVALID_JSON", "请求体必须是 JSON 对象");
  }
}

function toId(v: string | undefined, what: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError("INVALID_ID", `${what} 必须是正整数`);
  return n;
}

export function createServer(service: Service): http.Server {
  const send = (res: http.ServerResponse, status: number, data: unknown) => {
    const body = JSON.stringify(data, null, 2);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(body);
  };

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";
      const body = method === "POST" ? parseJson(await readBody(req, 2 * 1024 * 1024)) : {};

      // 路由
      if (method === "GET" && parts.length === 0) {
        return send(res, 200, { name: "html-selector-service", endpoints: [
          "POST /documents {name?, html}",
          "GET /documents",
          "POST /documents/:id/versions {html}",
          "GET /documents/:id/versions",
          "POST /query {versionId, selector}",
          "GET /queries/:id/explain",
          "POST /reports {queryId, name?}",
          "GET /reports",
          "GET /reports/:id",
          "POST /compare {versionIdA, versionIdB, selector}",
        ]});
      }
      if (method === "POST" && parts[0] === "documents" && parts.length === 1) {
        return send(res, 201, service.importDocument(body.name, body.html));
      }
      if (method === "GET" && parts[0] === "documents" && parts.length === 1) {
        return send(res, 200, service.store.listDocuments());
      }
      if (parts[0] === "documents" && parts[2] === "versions" && parts.length === 3) {
        const docId = toId(parts[1], "文档 id");
        if (method === "POST") return send(res, 201, service.addVersion(docId, body.html));
        if (method === "GET") return send(res, 200, service.listVersions(docId));
      }
      if (method === "POST" && parts[0] === "query" && parts.length === 1) {
        return send(res, 200, service.query(toId(String(body.versionId ?? ""), "versionId"), body.selector));
      }
      if (method === "GET" && parts[0] === "queries" && parts[2] === "explain" && parts.length === 3) {
        return send(res, 200, service.explain(toId(parts[1], "查询 id")));
      }
      if (method === "POST" && parts[0] === "reports" && parts.length === 1) {
        return send(res, 201, service.saveReport(toId(String(body.queryId ?? ""), "queryId"), body.name));
      }
      if (method === "GET" && parts[0] === "reports" && parts.length === 1) {
        return send(res, 200, service.store.listReports());
      }
      if (method === "GET" && parts[0] === "reports" && parts.length === 2) {
        return send(res, 200, service.getReport(toId(parts[1], "报告 id")));
      }
      if (method === "POST" && parts[0] === "compare" && parts.length === 1) {
        return send(res, 200, service.compare(
          toId(String(body.versionIdA ?? ""), "versionIdA"),
          toId(String(body.versionIdB ?? ""), "versionIdB"),
          body.selector
        ));
      }
      throw new ApiError("NOT_FOUND", `未找到路由 ${method} ${url.pathname}`, 404);
    } catch (e) {
      if (e instanceof ApiError) {
        return send(res, e.status, { error: { code: e.code, message: e.message } });
      }
      const msg = e instanceof Error ? e.message : String(e);
      return send(res, 500, { error: { code: "INTERNAL_ERROR", message: msg } });
    }
  });
}

/** 从指定端口开始寻找空闲端口 */
export function findFreePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      if (port > start + 100) return reject(new Error("找不到空闲端口"));
      const srv = net.createServer();
      srv.once("error", () => tryPort(port + 1));
      srv.once("listening", () => srv.close(() => resolve(port)));
      srv.listen(port, "127.0.0.1");
    };
    tryPort(start);
  });
}

export async function startServer(service: Service, preferredPort: number): Promise<{ port: number; close: () => void }> {
  const port = preferredPort > 0 ? await findFreePort(preferredPort) : await findFreePort(8321);
  const server = createServer(service);
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { port, close: () => server.close() };
}
