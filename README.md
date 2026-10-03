# html-selector-service

离线 HTML 选择器查询与匹配解释后端。TypeScript + Node.js + SQLite，仅提供 HTTP API 与 CLI，
不执行脚本、不加载外部资源、不访问网络、无浏览器与页面界面。

## 功能范围

- 导入 HTML 文本为文档，每次更新产生新版本，旧版本与旧报告永久保留
- 受限 CSS 选择器查询，返回节点标签、属性、简短文本与版本内稳定路径
- 命中解释：说明每个简单条件与父子/祖先关系如何满足
- 保存查询报告、比较同一选择器在两个版本上的结果差异
- SQLite 持久化（文档原文、版本、查询记录、报告），重启后可继续查询

## 选择器支持范围

| 语法 | 示例 | 说明 |
| --- | --- | --- |
| 标签 | `div` | 大小写不敏感（统一按小写匹配） |
| 通配符 | `*` | 任意标签 |
| id | `#main` | 大小写敏感 |
| class | `.item` | 按词项匹配，大小写敏感 |
| 属性存在 | `[data-info]` | 属性名大小写不敏感 |
| 属性等值 | `[title="a, b"]` | 值大小写敏感；引号内空格、逗号不会被当作组合符 |
| 后代 | `ul li` | 跨任意层级 |
| 直接子代 | `ul > li` | 仅直接父子 |
| 分组 | `.item, li.active` | 按文档顺序返回，同一节点只出现一次 |

简单选择器内可自由组合：`div#main.container[data-role="x"]`。

**明确拒绝**（返回 `INVALID_SELECTOR`，不退化为宽泛匹配）：伪类（`:hover`、`:first-child` 等）、
兄弟组合符（`+`、`~`）、未闭合括号/引号、空选择器、尾随逗号等非法语法。

## 大小写规则

- 标签名、属性名：不敏感（HTML 规范，统一小写处理）
- id、class、属性值：敏感（逐字符相等）

## 限制

- HTML 文档最大 1 MB（`HTML_TOO_LARGE`）
- 选择器最长 512 字符（`SELECTOR_TOO_LONG`）
- 单次查询命中上限 5000 节点（`TOO_MANY_RESULTS`）
- 节点路径（如 `/html[1]/body[1]/div[1]/li[2]`）仅保证同一版本内稳定，不追踪跨版本节点身份；
  版本比较按路径对齐，仅供参考

## 环境要求

- Windows 本地，Node.js ≥ 22（使用内置 `node:sqlite`，无需原生编译）
- 不依赖 Docker / WSL / 外部在线服务；唯一运行时依赖为 `parse5`（HTML 解析与实体处理）

## 复现命令

```powershell
npm install        # 安装依赖
npm run build      # 编译 TypeScript 到 dist/
npm test           # 运行全部测试（固定小 DOM + 人工预期）
npm run demo       # 端到端演示：后代 vs 子代、分组去重、引号属性、解释、报告、版本比较
npm start          # 启动 API 服务（默认自动选择空闲端口）
```

## CLI 用法

```powershell
npm run cli -- serve --port 8321          # 启动服务（端口被占用时自动顺延）
npm run cli -- import 名称 @examples\sample-v1.html
npm run cli -- update 1 @examples\sample-v2.html
npm run cli -- documents
npm run cli -- versions 1
npm run cli -- query 1 "ul.primary > li"
npm run cli -- explain 1
npm run cli -- report-save 1 我的报告
npm run cli -- reports
npm run cli -- report-show 1
npm run cli -- compare 1 2 "ul.primary li"
```

数据默认保存在项目内 `data\htmlq.db`，可用环境变量 `HTMLQ_DATA_DIR` 或 `HTMLQ_DB` 覆盖。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/documents` | `{name?, html}` 导入文档，创建版本 1 |
| GET | `/documents` | 列出文档 |
| POST | `/documents/:id/versions` | `{html}` 追加新版本 |
| GET | `/documents/:id/versions` | 列出版本 |
| POST | `/query` | `{versionId, selector}` 执行查询，返回 `queryId` 与命中列表 |
| GET | `/queries/:id/explain` | 查看命中解释 |
| POST | `/reports` | `{queryId, name?}` 保存报告（固化当时结果） |
| GET | `/reports` / `/reports/:id` | 列出 / 查看报告 |
| POST | `/compare` | `{versionIdA, versionIdB, selector}` 版本比较 |

错误响应统一为 `{"error": {"code": "...", "message": "..."}}`，错误码包括：
`INVALID_HTML`、`HTML_TOO_LARGE`、`INVALID_SELECTOR`、`SELECTOR_TOO_LONG`、`TOO_MANY_RESULTS`、
`INVALID_ID`、`INVALID_JSON`、`DOCUMENT_NOT_FOUND`、`VERSION_NOT_FOUND`、`QUERY_NOT_FOUND`、
`REPORT_NOT_FOUND`、`NOT_FOUND`。

## 项目结构

```
src/selector.ts   选择器词法、语法解析与匹配（自实现，不使用 querySelector）
src/dom.ts        parse5 解析 + 节点模型、稳定路径、文档顺序
src/explain.ts    命中解释生成
src/store.ts      SQLite 持久化（node:sqlite）
src/service.ts    业务逻辑与参数校验、错误码
src/server.ts     HTTP API（node:http）
src/cli.ts        CLI 入口
test/             单元与服务测试（固定小 DOM + 人工预期）
examples/         演示用 HTML（嵌套列表、多 class、带引号属性值）
scripts/demo.ts   端到端演示脚本
```
