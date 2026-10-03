import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { AppError, HTTP_STATUS, type ErrorCode } from "./errors.js";
import { openDatabase } from "./db.js";
import { SelectorService } from "./service.js";

interface StartOptions {
  port?: number;
  dataDir?: string;
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("无法获取空闲端口"));
      });
    });
    server.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString("utf8");
  if (body.length === 0) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new AppError("INVALID_PARAM", "请求体不是合法 JSON");
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendError(res: ServerResponse, code: ErrorCode, message: string, detail?: unknown): void {
  sendJson(res, HTTP_STATUS[code], { error: { code, message, detail: detail ?? null } });
}

export async function startServer(options: StartOptions = {}): Promise<{ server: Server; port: number }> {
  const dataDir = options.dataDir ?? join(process.cwd(), "data");
  const db = openDatabase(join(dataDir, "app.sqlite"));
  const service = new SelectorService(db);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathParts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";

      if (method === "GET" && pathParts.length === 1 && pathParts[0] === "health") {
        sendJson(res, 200, { status: "ok" });
        return;
      }

      if (method === "POST" && pathParts.length === 1 && pathParts[0] === "documents") {
        const body = (await readJson(req)) as { title?: string; html?: string; documentId?: number };
        sendJson(res, 201, service.importDocument(body));
        return;
      }

      if (method === "GET" && pathParts.length === 1 && pathParts[0] === "versions") {
        const documentId = url.searchParams.get("documentId");
        sendJson(res, 200, service.listVersions(documentId ? Number(documentId) : undefined));
        return;
      }

      if (method === "POST" && pathParts.length === 2 && pathParts[0] === "versions" && pathParts[1] === "query") {
        const body = (await readJson(req)) as { versionId?: number; selector?: string; save?: boolean };
        if (typeof body.versionId !== "number") {
          throw new AppError("INVALID_PARAM", "versionId 必须是数字");
        }
        if (typeof body.selector !== "string") {
          throw new AppError("INVALID_PARAM", "selector 必须是字符串");
        }
        sendJson(res, 200, service.query(body.versionId, body.selector, body.save === true));
        return;
      }

      if (method === "POST" && pathParts.length === 1 && pathParts[0] === "compare") {
        const body = (await readJson(req)) as {
          versionA?: number;
          versionB?: number;
          selector?: string;
        };
        if (typeof body.versionA !== "number" || typeof body.versionB !== "number") {
          throw new AppError("INVALID_PARAM", "versionA 与 versionB 必须是数字");
        }
        if (typeof body.selector !== "string") {
          throw new AppError("INVALID_PARAM", "selector 必须是字符串");
        }
        sendJson(res, 200, service.compare(body.versionA, body.versionB, body.selector));
        return;
      }

      if (method === "GET" && pathParts.length === 2 && pathParts[0] === "reports") {
        const reportId = Number(pathParts[1]);
        if (!Number.isInteger(reportId)) throw new AppError("INVALID_PARAM", "reportId 必须是整数");
        sendJson(res, 200, service.getReport(reportId));
        return;
      }

      if (method === "GET" && pathParts.length === 1 && pathParts[0] === "reports") {
        sendJson(res, 200, service.listReports());
        return;
      }

      sendError(res, "NOT_FOUND", `未知路由 ${method} ${url.pathname}`);
    } catch (error) {
      if (error instanceof AppError) {
        sendError(res, error.code, error.message, error.detail ?? error.position);
      } else {
        sendError(res, "INTERNAL", error instanceof Error ? error.message : "未知内部错误");
      }
    }
  });

  const port = options.port ?? (Number(process.env.PORT) || (await pickFreePort()));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  server.on("close", () => db.close());
  return { server, port };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const requested = process.argv.find((arg) => arg.startsWith("--port="))?.split("=")[1];
  const dataDir = process.argv.find((arg) => arg.startsWith("--data-dir="))?.split("=")[1];
  startServer({
    port: requested ? Number(requested) : undefined,
    dataDir,
  }).then(({ port }) => {
    console.log(`HTML 选择器服务已启动: http://127.0.0.1:${port}`);
    console.log("按 Ctrl+C 退出");
  });
}
