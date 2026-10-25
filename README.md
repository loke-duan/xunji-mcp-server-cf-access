# 训记只读 MCP 服务

这是一个部署在 **Cloudflare Workers**、使用 **Cloudflare Access for SaaS（OIDC）** 认证的第三方训记远程 MCP 服务。它只读取训练、饮食和身体数据，不提供任何写入、同步或模板功能。

> 本项目不是训记官方运营的 MCP 服务。部署者需自行负责 Cloudflare 配置、训记 API Key 和访问策略。

## 功能范围

服务只注册以下四个业务工具：

| 领域 | MCP 工具 | 能力 |
| --- | --- | --- |
| 训练 | `xunji_get_training` | 按指定日期读取训练；可选完整数据，包括 RPE、备注、未完成组、递减组及心率摘要 |
| 最近训练 | `xunji_get_latest_training` | 基准日及之前 6 天内，从近到远查找最近一个有训练的日期，返回该日全部训练 |
| 饮食 | `xunji_get_food` | 按明确日期范围读取食物、份量和接口提供的营养明细 |
| 身体数据 | `xunji_get_body` | 按日期范围和指标类型读取身体数据，支持分页 |

四个工具均声明为只读、非破坏性、幂等操作。

明确不支持：

- 训练、饮食或身体数据的新增、更新、删除和写回
- 个人训练模板读取、同步或修改
- 官方训练计划查询
- 食物搜索、自定义食物和饮食模板
- 写入预览、确认令牌、mutation 或自动同步

## ChatGPT 直接调用（无需加载 skill）

连接 MCP 服务并完成 Cloudflare Access 登录后，ChatGPT 可通过 `tools/list` 获取四个工具的用途、参数、结果解释和错误处理规则；不需要先读取本仓库的 skill 快照，也不需要在聊天中提供 API Key。原 API 文档仅作为开发参考，不是运行时依赖。

调用所需信息直接放在工具描述和参数 Schema 中，不依赖额外的 Resource、Prompt 或服务级说明。工具名称、认证方式和成功返回数据格式保持兼容。服务端继续负责参数校验、只读接口访问和凭据保护；描述中的复用结果、限频等待和分析规则用于指导客户端，不代表服务端新增了缓存或自动翻页。

示例问题：

- “读取昨天的训练”：换算用户时区日期，查询一天的训练。
- “查看那天的 RPE 和心率”：使用 `include_full_data: true`。
- “汇总最近三天的饮食”：查询明确日期范围，避免重复累计汇总和明细。
- “看看这个月体重和腰围变化”：使用 `types: ["weight", "weist"]`，按需分页。

身体接口的 `latest` 日期范围语义尚未由上游文档明确，应核对记录日期，不能直接视作范围内最新值。饮食允许边界由当前服务按 UTC 日期计算；超范围错误给出准确边界，拆分查询不能绕过限制。

协议测试验证 `tools/list` 中的说明、参数默认值、范围、指标枚举以及未认证调用的拒绝行为。真实 ChatGPT 的工具选择仍需客户端验收：在已连接服务的新会话中，不加载外部 skill，尝试以上问题，并检查空记录、限频、超范围和部分分页结果是否被正确解释。自动测试不等同于真实聊天或线上凭据验证。

## 数据接口

### 训练

`xunji_get_training` 调用训记训练读取接口，输入：

```json
{
  "datestr": "2026-10-22",
  "include_full_data": false
}
```

`datestr` 必须是 `YYYY-MM-DD`。需要 RPE、备注、未完成组、递减组或心率摘要时，将 `include_full_data` 设为 `true`。

### 最近训练（最多回溯 7 天）

`xunji_get_latest_training` 输入：

```json
{
  "as_of_date": "2026-10-25",
  "include_full_data": false
}
```

`as_of_date` 必填，由客户端按用户时区确定；范围包含该日及之前 6 天。从近到远串行调用现有按日接口，找到非空 `res.trains` 即停止，返回该日全部训练，不处理同一天训练之间的先后顺序。最多 7 次上游请求，未新增官方 API，也不承诺减少上游请求或限频风险。

结果包含 `start_date`、`end_date`、`checked_dates`（已尝试日期）、`matched_date`、`found`、`search_complete` 和 `res`。`search_complete: true` 表示已确定查找结论，不代表扫描了全部 7 天；`found: false` 仅表示这 7 天内无记录，不推断更早历史。遇到认证、限频、网络或响应错误立即停止并返回 `isError: true`，文本中的 JSON 包含 `failed_date`、`checked_dates`、`search_complete: false` 和错误提示；不得跳过错误日期，也不自动重试。

### 饮食

`xunji_get_food` 输入：

```json
{
  "start_date": "2026-10-20",
  "end_date": "2026-10-22",
  "include_detail": true
}
```

开始日期不能晚于结束日期。查询范围限制为调用当日之前一年到之后三个月；单日查询时传入相同的开始和结束日期。

饮食明细在 `res.days[].foods.records[]`。每条记录新增 `totalCal: number | null`，表示实际摄入总热量（kcal，四舍五入保留两位小数）：

```text
totalCal = 实际摄入克数 / 100 × ntr.cal
```

例如 120 g、276 kcal/100 g 的贝果，`totalCal` 为 `331.2`。`amount`、`ntr.cal` 支持非负有限数值或十进制数字字符串；零是有效值，空字符串和无效值不当作零。单位 `g`/`克` 直接计算；其他单位仅匹配 `ntr.foodUnit[]` 的相同 `unit`，使用明确的每单位 `gram`，不猜测大小、密度或相似单位。`count` 缺省或为 1 时可换算，其他值因文档未明确关系不换算；缺失、无效或冲突的换算均返回 `null`。

原有字段和 `ntr.foodUnit` 全部保留，已有的记录级 `totalCal` 也不覆盖。历史兼容字段 `cals` 不参与计算；每日 `res.days[].totals.totalCal` 保持上游值及其含义，不用新增明细字段重新计算覆盖。上游营养异常（例如脂肪超过 100 g/100 g）保留原值，不静默修正，也不额外添加数据质量标记。未返回明细时不构造记录。

### 身体数据

`xunji_get_body` 输入：

```json
{
  "start_date": "2026-10-01",
  "end_date": "2026-10-22",
  "types": ["weight", "bodyfat"],
  "include_latest": true,
  "include_records": true,
  "limit": 500,
  "offset": 0
}
```

省略 `types` 时读取全部指标。`records` 按日期倒序返回；`latest` 是各类型最新记录；`by_type` 按类型归组。体重单位为 kg，体脂率为 %，围度为 cm。腰围字段沿用官方历史拼写 `weist`。

身体指标属于个人健康数据，调用方应谨慎描述趋势，不应据此进行医疗诊断。

## 架构与认证

- **Cloudflare Workers** 托管 `/mcp` Streamable HTTP 端点。
- **Cloudflare Access for SaaS** 提供 OIDC 登录和访问控制。
- **Workers OAuth Provider** 向 MCP 客户端提供授权、令牌和客户端注册端点。
- **Cloudflare KV（`OAUTH_KV`）** 保存 OAuth 状态和令牌数据。
- 三个独立的训记 Worker Secret 分别访问固定的官方读取接口。

当前是单个训记账号的个人实例：同一 Worker 配置一组个人训记 Key，所有被 Access 策略放行的用户共用这组凭证。因此只应允许本人或明确受信任的用户登录。

## API 文档快照

[xunji-all-skills_20261023.md](./xunji-all-skills_20261023.md) 是从训记 App 导出的完整 skill／Open API 说明快照，包含本项目没有实现的写入和模板接口。保留该文件只为核对官方接口，不表示这些能力已被实现或授权。

本项目只需要：

| Secret | 用途 |
| --- | --- |
| `XUNJI_TRAIN_API_KEY` | 训练记录查询 |
| `XUNJI_FOOD_API_KEY` | 饮食记录查询 |
| `XUNJI_BODY_API_KEY` | 身体数据查询 |

不需要模板 Key 或食物搜索 Key。

## 部署配置

### Cloudflare 资源

将仓库导入 Cloudflare Workers，或使用 Wrangler 部署。部署前检查 `wrangler.jsonc`：

- Worker 名称与实际项目一致。
- 创建自己的 KV namespace，并将其绑定为 `OAUTH_KV`。
- 不要复用仓库示例中的 KV namespace ID。

在 Cloudflare Access 中配置 Access for SaaS OIDC 应用和登录策略。生产回调地址为：

```text
https://<worker-name>.<subdomain>.workers.dev/callback
```

本地开发可使用 `http://localhost:8788/callback`。

### Worker Secrets

认证配置：

| Secret | 内容 |
| --- | --- |
| `ACCESS_CLIENT_ID` | Access for SaaS Client ID |
| `ACCESS_CLIENT_SECRET` | Access for SaaS Client secret |
| `ACCESS_TOKEN_URL` | OIDC Token endpoint |
| `ACCESS_AUTHORIZATION_URL` | OIDC Authorization endpoint |
| `ACCESS_JWKS_URL` | OIDC JWKS endpoint |
| `COOKIE_ENCRYPTION_KEY` | 高强度随机密钥 |

#### 获取训记 API Key

打开训记 App，依次进入 **我的 → 数据导入和导出**，申请本服务所需的训练、饮食和身体数据 Key，然后分别配置为对应的 Worker Secret：

| 训记 Key | Worker Secret |
| --- | --- |
| 训练数据 Key | `XUNJI_TRAIN_API_KEY` |
| 饮食数据 Key | `XUNJI_FOOD_API_KEY` |
| 身体数据 Key | `XUNJI_BODY_API_KEY` |

三个 Key 分别用于对应的数据查询，请勿混用；无需申请模板 Key 或食物搜索 Key。

Key 只填写原始值，不添加 `Bearer ` 前缀，不要写入仓库、聊天、工具参数或 `wrangler.jsonc`。

### 部署

```sh
npm install
npm run deploy
```

MCP 地址：

```text
https://<worker-name>.<subdomain>.workers.dev/mcp
```

连接并完成 Cloudflare Access 登录后，工具列表中应当只出现四个训记工具。

## 本地开发与验证

```sh
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

验证：

```sh
npm test
npm run type-check
npx wrangler deploy --dry-run
```

测试使用合成数据，不读取或修改真实训记记录。

## 安全和错误处理

- API Key 只从 Worker Secret 获取并通过 `Authorization: Bearer` 请求头发送。
- 请求只发送至代码中固定的训记 HTTPS 读取接口。
- 使用手动重定向模式并拒绝上游重定向，避免转发凭证。
- 支持 JSON 和 gzip 响应，包括缺少压缩响应头的 gzip 数据。
- 设置请求超时和 10 MiB 解压上限。
- 不输出 API Key、上游原始异常或私人错误正文。
- 不自动重试失败请求；遇到限频时遵守接口返回的等待时间。
- 查询结果会进入调用方 AI 客户端的会话上下文，后续保存与处理受该客户端的数据政策约束。

## 开发与致谢

本仓库基于 Cloudflare 官方示例项目开发，实现了部分训记（Xunji）MCP 服务能力。

- 感谢 Cloudflare 提供基础设施和示例项目。
- 感谢训记提供 API 接口和原始 skill 文档。
- 感谢 G老师（ChatGPT）提供技术支持；本仓库代码均由 G老师根据项目维护者提出的需求编写，项目维护者负责配置、部署和实际使用验证。

## 许可证

本项目代码采用 [MIT License](./LICENSE)，允许使用、修改、分发和商用；分发时须保留版权及许可声明。软件按原样提供，不作担保。

本项目基于 Cloudflare 官方的 [remote-mcp-cf-access 示例](https://github.com/cloudflare/ai/tree/e64009349c9af37cd3820a16ff4448103148b0f1/demos/remote-mcp-cf-access) 开发，保留其 MIT 许可证和 `Copyright (c) 2025 Cloudflare, Inc.` 声明；本项目新增代码的版权署名为 `Copyright (c) 2026 loke-duan`。

第三方依赖遵循各自许可证。[训记 API 文档快照](./xunji-all-skills_20261023.md) 不纳入本项目的 MIT 授权，相关权利归原权利人所有。代码许可不授予训记 API 或 Cloudflare 服务的访问权限，使用者仍需自行配置凭据并遵守相关服务条款。

## 参考资料

- [Cloudflare：Secure MCP servers](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/)
- [训记 App skill／Open API 说明（2026-10-23）](./xunji-all-skills_20261023.md)
