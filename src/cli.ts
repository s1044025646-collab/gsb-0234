// CLI 入口：导入、版本、查询、解释、报告、比较、启动服务。
import * as fs from "node:fs";
import * as path from "node:path";
import { Service } from "./service";
import { startServer } from "./server";
import { Store } from "./store";

const DATA_DIR = process.env.HTMLQ_DATA_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = process.env.HTMLQ_DB ?? path.join(DATA_DIR, "htmlq.db");

function makeService(): Service {
  return new Service(new Store(DB_PATH));
}

function print(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function readHtmlArg(value: string): string {
  // 以 @ 开头表示从文件读取，否则视为内联 HTML
  if (value.startsWith("@")) {
    const file = value.slice(1);
    if (!fs.existsSync(file)) throw new Error("文件不存在: " + file);
    return fs.readFileSync(file, "utf8");
  }
  return value;
}

const USAGE = [
  "用法: htmlq <命令> [参数]",
  "",
  "命令:",
  "  serve [--port N]                     启动 HTTP API 服务（默认自动选择空闲端口）",
  "  import <名称> <html|@文件>           导入 HTML，创建文档与版本 1",
  "  update <文档id> <html|@文件>         为文档追加新版本",
  "  documents                            列出文档",
  "  versions <文档id>                    列出版本",
  "  query <版本id> <选择器>              执行查询",
  "  explain <查询id>                     查看命中解释",
  "  report-save <查询id> [名称]          保存报告",
  "  reports                              列出报告",
  "  report-show <报告id>                 查看报告",
  "  compare <版本idA> <版本idB> <选择器> 比较两个版本的查询结果",
  "",
  "环境变量: HTMLQ_DATA_DIR / HTMLQ_DB 指定数据目录或数据库文件",
].join("\n");

function usage(): never {
  console.log(USAGE);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === "help" || cmd === "--help") usage();

  const service = makeService();

  switch (cmd) {
    case "serve": {
      const portIdx = args.indexOf("--port");
      const port = portIdx >= 0 ? Number(args[portIdx + 1]) : 0;
      const { port: actual } = await startServer(service, port);
      console.log("服务已启动: http://127.0.0.1:" + actual + "  (数据库: " + DB_PATH + ")");
      return; // 保持进程运行
    }
    case "import":
      if (args.length < 3) usage();
      print(service.importDocument(args[1], readHtmlArg(args[2])));
      break;
    case "update":
      if (args.length < 3) usage();
      print(service.addVersion(Number(args[1]), readHtmlArg(args[2])));
      break;
    case "documents":
      print(service.store.listDocuments());
      break;
    case "versions":
      if (args.length < 2) usage();
      print(service.listVersions(Number(args[1])));
      break;
    case "query":
      if (args.length < 3) usage();
      print(service.query(Number(args[1]), args[2]));
      break;
    case "explain":
      if (args.length < 2) usage();
      print(service.explain(Number(args[1])));
      break;
    case "report-save":
      if (args.length < 2) usage();
      print(service.saveReport(Number(args[1]), args[2]));
      break;
    case "reports":
      print(service.store.listReports());
      break;
    case "report-show":
      if (args.length < 2) usage();
      print(service.getReport(Number(args[1])));
      break;
    case "compare":
      if (args.length < 4) usage();
      print(service.compare(Number(args[1]), Number(args[2]), args[3]));
      break;
    default:
      usage();
  }
}

main().catch((e) => {
  const err = e as { code?: string; message?: string };
  console.error(JSON.stringify({ error: { code: err.code ?? "ERROR", message: err.message ?? String(e) } }));
  process.exit(1);
});
