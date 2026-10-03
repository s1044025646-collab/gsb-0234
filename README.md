# HTML 选择器查询与匹配解释后端

一个完全离线运行的本地 HTML 文档结构查询服务。导入 HTML 文本后解析成可查询的
DOM，执行受限 CSS 选择器，返回命中节点的标签、属性、简短文本与在该文档版本内
稳定的定位路径，并给出每个条件如何满足的解释。

- 只做**离线结构查询**：不执行脚本、不加载外部资源、不访问网页、没有浏览器界面。
- HTML 由成熟库 [`parse5`](https://github.com/inikulin/parse5) 负责实体与树构建；
  **选择器解析与节点匹配全部为本项目自行实现**，没有使用 `querySelector` 或任何
  现成选择器引擎。
- 技术栈：TypeScript + Node.js（内置 `node:sqlite`），无需 Docker、WSL、付费服务
  或在线 API。需要 Node.js **22.5 以上**（`node:sqlite` 首次出现在该版本）。

## 支持的选择器范围

在一个逗号分组的查询中，每一段是“简单选择器 + 组合符 + 简单选择器 …”：

| 能力 | 写法 | 说明 |
| --- | --- | --- |
| 标签 | `div`、`LI` | 标签名按 ASCII 小写比较，大小写不敏感 |
| 通配符 | `*` | 匹配任意元素 |
| id | `#main` | 值大小写敏感 |
| class | `.a.b` | 按 `class` 属性的空格词项匹配，词项大小写敏感；不是子串匹配 |
| 属性存在 | `[href]` | 属性存在即命中 |
| 属性等值 | `[href="/x"]` | 完全相等；值大小写敏感 |
| 组合 | `a.link.external[id]` | 同一简单选择器内的条件为“与” |
| 后代 | `nav a` | 任意层级祖先 |
| 直接子代 | `nav > a` | 必须是直接父节点 |
| 分组 | `a, .link` | 按文档顺序返回，**同一节点多组命中只返回一次** |

属性值可以用单引号或双引号包裹，**引号内的空格、逗号、`>` 都只是普通字符**，
不会被当作组合符或分组切开，例如 `[data-role="guide, quick"]`。

### 明确拒绝（不会退化成宽泛匹配）

- 伪类、伪元素：`a:hover`、`li:first-child`、`p::before`
- 兄弟组合符：`+`、`~`
- 其他属性算子：`~= |= ^= $= *=`
- 非法语法：悬空组合符（`> a`、`a >`）、空分组（`a,,b`）、未闭合方括号或引号等

拒绝时返回错误码 `UNSUPPORTED_SELECTOR` 或 `SELECTOR_SYNTAX`，HTTP 状态码 400。

## 大小写规则

- HTML 标签名与属性名：大小写不敏感（HTML 规则），内部按小写比较。
- `id`、`class` 词项、属性值：大小写敏感。

## 稳定路径

路径形如 `html[1] > body[1] > ul[1] > li[2] > a[1]`，每段的序号是该节点在同名兄弟
中的次序（从 1 开始）。路径**只保证在同一文档版本内稳定**；不同版本之间不做节点
身份追踪，版本比较以路径字符串作为对照键。

## 数据与限制

- SQLite 数据库默认保存在项目内 `data/app.sqlite`，重启后可继续查询。
- 文档原文、版本、查询记录与报告均持久化；报告保存查询时的命中快照，始终对应其
  所属版本的原始树，后续新增版本不会改动旧报告。
- 上限（见 `src/limits.ts`）：HTML 2 MiB、选择器 300 字符、文本摘要 80 字符。

## 快速开始

```powershell
npm install
npm run build
npm test
```

### 一键演示（无需自己准备数据）

```powershell
npm run demo
```

演示使用嵌套列表 + 多 class + 引号属性值的固定文档，展示后代 `nav a` 与直接子代
`nav > a` 的差别、分组去重、引号分隔符、命中解释、两版本比较与旧报告保留。

### CLI

```powershell
# 导入新文档（返回 documentId / versionId）
npm run cli -- import --file examples/nav.html --title "导航示例"

# 同一文档追加新版本（HTML 更新）
npm run cli -- import --file examples/nav-v2.html --document-id 1

# 列出版本
npm run cli -- versions

# 查询（--save 保存报告，--explain 输出命中解释）
npm run cli -- query --version 1 --selector "nav a" --save --explain
npm run cli -- query --version 1 --selector "nav > a"

# 查看已保存报告 / 报告列表
npm run cli -- reports
npm run cli -- report --id 1

# 比较两个版本上的同一选择器
npm run cli -- compare --a 1 --b 2 --selector "ul.submenu a"
```

可用 `--data-dir <路径>` 指定其它数据目录。

### HTTP API

```powershell
# 默认选择一个空闲端口并打印实际地址；也可指定端口
npm run dev
npm run dev -- --port=8080
npm start -- --port=8080        # 使用构建产物 dist/
```

仅监听 `127.0.0.1`。路由：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| POST | `/documents` | 导入文档；`{title?, html, documentId?}`，带 `documentId` 表示追加版本 |
| GET | `/versions` / `?documentId=1` | 列出全部或指定文档的版本 |
| POST | `/versions/query` | `{versionId, selector, save?}` |
| GET | `/reports` / `/reports/:id` | 报告列表 / 报告快照（含解释） |
| POST | `/compare` | `{versionA, versionB, selector}`，返回 added/removed/retained 路径 |

示例：

```powershell
$html = Get-Content -Raw examples/nav.html
$body = @{ title = "导航示例"; html = $html } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8080/documents `
  -ContentType "application/json; charset=utf-8" -Body $body
```

查询响应示例（节选）：

```json
{
  "queryId": 3,
  "versionId": 1,
  "selector": ".link, a.external",
  "groups": [".link", "a.external"],
  "total": 5,
  "hits": [
    {
      "nodeId": 7,
      "tag": "a",
      "id": null,
      "classes": ["link", "external"],
      "attributes": { "href": "/docs/api", "class": "link external" },
      "text": "API",
      "path": "html[1] > body[1] > nav[1] > ul[1] > li[1] > ul[1] > li[2] > a[1]",
      "matchedGroups": [0, 1]
    }
  ],
  "explanations": { "7": [{ "groupIndex": 0, "selector": ".link", "steps": ["..."] }] }
}
```

## 错误码

| code | HTTP | 含义 |
| --- | --- | --- |
| `INVALID_PARAM` | 400 | 参数缺失或类型错误 |
| `SELECTOR_SYNTAX` | 400 | 选择器非法语法 |
| `UNSUPPORTED_SELECTOR` | 400 | 使用了不支持的伪类/兄弟组合符/属性算子 |
| `EMPTY_DOCUMENT` | 400 | HTML 为空 |
| `DOCUMENT_TOO_LARGE` | 413 | HTML 超过 2 MiB |
| `SELECTOR_TOO_LONG` | 413 | 选择器超过 300 字符 |
| `NOT_FOUND` | 404 | 版本或报告不存在 |
| `INTERNAL` | 500 | 其它内部错误 |

## 项目结构

```
src/
  dom.ts       parse5 -> 内部轻量 DOM（标签/属性/聚合文本）
  path.ts      同名兄弟序号稳定路径
  selector.ts  选择器词法/语法解析 + 自研匹配器 + 命中解释
  db.ts        SQLite 建表与迁移
  service.ts   文档/版本/查询/报告/比较业务逻辑
  server.ts    HTTP API（默认空闲端口）
  cli.ts       命令行
scripts/demo.ts  演示；scripts/fixtures.ts 演示文档
test/          固定小 DOM 上的人工预期测试（node --test）
examples/      示例 HTML
```

## 已知限制

- 不是完整 CSS 实现：不支持伪类、兄弟组合、命名空间、属性模糊匹配、`:scope` 等。
- HTML 按标准 HTML 规则解析（标签/属性名小写化），不支持 XML/XHTML 命名空间语义。
- 只输出结构信息与压缩后的文本摘要，不做样式计算、布局、脚本执行或 XPath。
- 跨版本比较依赖稳定路径字符串；若大幅重排同名兄弟顺序，路径可能指向不同节点，
  这是有意为之的简化，不做跨版本身份追踪。
