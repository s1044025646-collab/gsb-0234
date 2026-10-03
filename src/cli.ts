import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import { openDatabase } from "./db.js";
import { SelectorService, type QueryResult } from "./service.js";
import { AppError } from "./errors.js";

interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      flags._positional = token;
    }
  }
  return { command: command ?? "help", flags };
}

function requireString(flags: Record<string, string | boolean>, key: string): string {
  const value = flags[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new AppError("INVALID_PARAM", `缺少必需参数 --${key}`);
  }
  return value;
}

function requireNumber(flags: Record<string, string | boolean>, key: string): number {
  const raw = requireString(flags, key);
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new AppError("INVALID_PARAM", `--${key} 必须是整数`);
  return value;
}

function printHits(result: QueryResult, explain: boolean): void {
  console.log(`选择器: ${result.selector}`);
  console.log(`分组: ${result.groups.join(" , ")}`);
  console.log(`命中 ${result.total} 个节点（文档顺序，已去重）:`);
  for (const hit of result.hits) {
    const groupInfo =
      hit.matchedGroups.length > 1 ? ` [命中分组 ${hit.matchedGroups.join("、")}]` : "";
    console.log(`  #${hit.nodeId} <${hit.tag}> ${hit.path}${groupInfo}`);
    if (hit.id) console.log(`      id=${hit.id}`);
    if (hit.classes.length) console.log(`      class=${hit.classes.join(" ")}`);
    if (hit.text) console.log(`      文本=${JSON.stringify(hit.text)}`);
  }
  if (explain) {
    console.log("\n命中解释:");
    for (const hit of result.hits) {
      const explanations = result.explanations[hit.nodeId] ?? [];
      for (const explanation of explanations) {
        console.log(`  节点 #${hit.nodeId} 分组[${explanation.groupIndex}] ${explanation.selector}`);
        explanation.steps.forEach((step, index) => {
          const prefix = step.combinator === "child" ? "直接子代" : step.combinator === "descendant" ? "后代" : "起点";
          console.log(`    ${index + 1}. [${prefix}] 节点 #${step.matchedNode}: ${step.detail}`);
        });
      }
    }
  }
}

function usage(): void {
  console.log(`HTML 选择器后端 CLI

用法:
  npm run cli -- import --file <路径> [--document-id <id>] [--title <标题>]
  npm run cli -- versions [--document-id <id>]
  npm run cli -- query --version <id> --selector "<css>" [--save] [--explain]
  npm run cli -- report --id <报告id>
  npm run cli -- reports
  npm run cli -- compare --a <版本id> --b <版本id> --selector "<css>"

数据目录可用 --data-dir <路径> 指定，默认 ./data
`);
}

function main(): void {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const dataDir = typeof flags["data-dir"] === "string" ? resolve(flags["data-dir"]) : join(process.cwd(), "data");
  const db = openDatabase(join(dataDir, "app.sqlite"));
  const service = new SelectorService(db);

  switch (command) {
    case "import": {
      const file = requireString(flags, "file");
      const html = readFileSync(resolve(file), "utf8");
      const summary = service.importDocument({
        html,
        title: typeof flags.title === "string" ? flags.title : undefined,
        documentId: typeof flags["document-id"] === "string" ? Number(flags["document-id"]) : undefined,
      });
      console.log("已创建版本:");
      console.log(JSON.stringify(summary, null, 2));
      break;
    }
    case "versions": {
      const documentId = typeof flags["document-id"] === "string" ? Number(flags["document-id"]) : undefined;
      console.log(JSON.stringify(service.listVersions(documentId), null, 2));
      break;
    }
    case "query": {
      const versionId = requireNumber(flags, "version");
      const selector = requireString(flags, "selector");
      const result = service.query(versionId, selector, flags.save === true);
      printHits(result, flags.explain === true);
      console.log(`queryId=${result.queryId}${flags.save ? "（报告已保存）" : ""}`);
      break;
    }
    case "report": {
      const report = service.getReport(requireNumber(flags, "id"));
      printHits(report, true);
      console.log(`\n报告 #${report.reportId} 保存于 ${report.savedAt}（基于版本 ${report.versionId} 的原始树）`);
      break;
    }
    case "reports": {
      console.log(JSON.stringify(service.listReports(), null, 2));
      break;
    }
    case "compare": {
      const a = requireNumber(flags, "a");
      const b = requireNumber(flags, "b");
      const selector = requireString(flags, "selector");
      console.log(JSON.stringify(service.compare(a, b, selector), null, 2));
      break;
    }
    case undefined:
    case "help":
    case "--help":
    case "-h":
      usage();
      break;
    default:
      throw new AppError("INVALID_PARAM", `未知命令 ${command}`);
  }
}

try {
  main();
} catch (error) {
  if (error instanceof AppError) {
    console.error(`错误 [${error.code}]: ${error.message}`);
    if (error.position !== undefined) console.error(`位置: ${error.position}`);
    process.exitCode = 1;
  } else {
    console.error(error);
    process.exitCode = 1;
  }
}
