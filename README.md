# magpie-teleagent

把 **TeleAgent（星辰超级智能体 / TeleAI）** 账号接成 [magpie](https://github.com/yetone/magpie) 的模型提供方。

插件直接签名调用 TeleAgent 云网关，并把结果翻译回 OpenAI Chat Completions —— **不需要** 再跑 `teleagent-proxy` 那类独立反代进程。

```
magpie plugin add github:Ding-D-Z-S/magpie-teleagent
magpie plugin login teleagent
```

---

## 功能

| 能力 | 说明 |
|---|---|
| 模型 | `chat-flagship` / `chat-pro` / `chat-lite` / `chat-flash` / `chat-nano` |
| 协议 | magpie 以 `@ai-sdk/openai-compatible` 发请求，插件翻译成网关格式并签名 |
| 流式 | 网关 SSE 原样透传（OpenAI `chat.completion.chunk`） |
| 工具调用 | `tools` / `tool_choice` / `parallel_tool_calls` 等原样透传 |
| 模型限制 | 每个模型声明 `limit: { context: 1048576, output: 131072 }` |
| 积分 | `auth.usage` 钩子显示积分余额与各权益明细 |
| 自动签到 | 每日登录积分（100 分/天）自动领取，6 小时节流、幂等 |

---

## 安装

```bash
# 从 GitHub 安装（推荐）
magpie plugin add github:Ding-D-Z-S/magpie-teleagent

# 或本地目录
git clone https://github.com/Ding-D-Z-S/magpie-teleagent
magpie plugin add ./magpie-teleagent
```

依赖：Node.js ≥ 22（magpie 自带 Bun 运行时）。

---

## 登录

```bash
magpie plugin login teleagent
```

两种方式：

### 1. 网页登录（浏览器授权）

1. magpie 给出门户登录链接（**不会自动打开浏览器**）
2. 在浏览器完成 TeleAgent 登录，停在「我的积分」页
3. 复制 `operationToken`：
   ```js
   copy(document.cookie.match(/operationToken=([^;]+)/)[1])
   ```
   或 F12 → Application → Cookies → `agent.teleai.com.cn` → `operationToken`
4. 粘贴回 magpie → 插件校验积分 → 自动写入 `account.json`

粘贴内容兼容：裸 token、`operationToken=…`、整段 `document.cookie`。

### 2. 本地账号（读 account.json）

适合已有客户端导出凭据的机器。

---

## 账号文件

```
~/.config/magpie-teleagent/account.json
```

```json
{
  "token": "<TeleAgent token>",
  "channelKey": "sk-…",
  "deviceId": "<uuid>",
  "installId": "<uuid>",
  "accountId": "…",
  "accountName": "user_xxxx",
  "phone": "180****0000"
}
```

- `token`：客户端 `token.json` 解密值（Windows 为 `safe_storage`/DPAPI），或网页登录的 `operationToken` —— **两者等价**
- `channelKey`：所有客户端共用的渠道密钥（从 `app.asar` 提取，插件已内置默认值）
- 文件权限建议 `600`

---

## 多账号

每个账号单独一个文件，互不覆盖：

```
~/.config/magpie-teleagent/accounts/<accountId>.json
~/.config/magpie-teleagent/accounts/<accountId>.checkin.json   # 签到节流状态
```

- 登录第二个账号只会新增一个文件，不会动第一个
- magpie 按 `auth.key`（accountId）取对应账号
- 老的单文件 `account.json` 会在插件加载时自动迁移进 `accounts/`，之后不再使用

## 实现要点

### 1. 网关地址

```
https://agent.teleai.com.cn/superCowork/sapi/api/v1        # base
POST /superCowork/sapi/api/v1/chat/completions            # 对话
```

### 2. 签名（`lib/signer.mjs`）

`superagent-auth-v1`，两轮 HMAC-SHA256：

```
K    = JWT 第三段（token 按第一个 ':' 切开后取第三段）
m1   = "superagent-auth-v1/{token}/{installId}/{ts}/{nonce}"
sig1 = hex(HMAC_SHA256(K, m1))

m2   = "superagent-auth-v1\n{METHOD}\n{path}\n{ts}\n{nonce}\n{appVersion}\n{bodyHash}"
sig  = hex(HMAC_SHA256(sig1, m2))
```

- `bodyHash = hex(SHA256(原始请求体字节))`
- `nonce` 不可重用（服务端记 nonce，重复返回 `40105`）
- 请求头：`Authorization: Bearer <channelKey>`、`X-Token: <token>`、
  `X-Route-Target: ops-gateway`、`X-Runtime-Env: ctyun_pc`、
  `X-SuperAgent-{Timestamp,Nonce,Device-Id,Install-Id,Sign-Version,Signature}`

### 3. 协议转换（`lib/api.mjs`）

- `openaiToGateway()`：OpenAI Chat Completions → 网关请求体（`messages` 的 content 数组**原样保留**，工具/图片块不丢）
- `gatewayToOpenai()`：非流式响应 → 标准 `chat.completion`
- 流式：直接把网关 `ReadableStream` 作为 `Response.body` 返回，`content-type: text/event-stream`

### 4. 积分接口（`lib/account.mjs`）

鉴权只需 `X-Token` 头（Bearer/token/Cookie 都 401）：

| 接口 | 内容 |
|---|---|
| `GET /meter/super-agent/user/portal/points/detail` | 积分余额 + 各权益明细 |
| `GET /meter/super-agent/user/portal/companyStore/userCenter` | 套餐名、可并发任务数 |
| `GET /meter/cowork/user_info` | 账号 ID、脱敏手机号 |

### 5. 自动签到（`lib/checkin.mjs`）

| 用途 | 接口 |
|---|---|
| 查状态 | `GET /meter/super-agent/user/portal/companyStore/homePage?scene=web` → `data.tasks[]` 中 `task_code=daily_login` 的 `claimed` |
| 领取 | `GET /meter/super-agent/user/portal/companyStore/checkTask?type=daily_login` |

- 触发：每次对话请求、每次额度查询
- 节流：默认 6 小时一次，状态写 `account.json.checkin.json`
- 幂等：已领过返回 `data: []`，不会重复发分
- 关闭：`magpie plugin options teleagent '{"autoCheckIn":false}'`

### 6. 模型限制

网关实测 `max_tokens` 允许范围 **`[1, 131072]`**，因此：

```js
limit: { context: 1048576, output: 131072 }
```

可用 `magpie plugin options teleagent '{"contextWindow":131072,"maxOutputTokens":131072}'` 覆盖。

---

## 积分估算显示（v0.4.4）

TeleAgent 上游**不返回单次请求的积分消耗**（只有按天汇总的用量统计），插件按费率估算并随响应返回
`usage.credits`，magpie 面板即可像其他模型一样显示每次用了多少积分。

- 默认费率 0.05 积分/token（按今日实测消耗粗校准）
- 可校准：`magpie plugin options teleagent '{"pointsRate":0.047}'`

## 目录结构

```
magpie-teleagent/
├─ index.mjs           插件主体（config / auth / provider 三段钩子）
├─ lib/
│  ├─ signer.mjs       网关签名
│  ├─ api.mjs          OpenAI ⇄ 网关 协议转换
│  ├─ account.mjs      账号文件、积分、usage 结构
│  ├─ checkin.mjs      自动签到
│  └─ web-login.mjs    网页登录辅助（链接、token 解析）
├─ logo-mark.png       图标（magpie 会自动下载缓存）
└─ package.json        插件清单（含 magpie 元数据）
```

## 已知限制

- 凭据来自 TeleAgent 客户端；服务端若变更签名规则，需同步 `lib/signer.mjs`
- token 约 90 天过期；网页登录 token 随门户会话过期，长期使用建议用客户端 token
- 仅实现 OpenAI Chat Completions 路径（Anthropic / Responses 入参未接）
- 与 TeleAgent 官方无关联；使用时请遵守其服务条款

## License

MIT

## 流式 usage（v0.3.2 → v0.3.5）

TeleAgent 网关的 usage 有三个坑，插件逐个绕过了：

1. **usage 塞在内容 chunk 里** —— 网关把 `usage` 和 `choices` 放在同一个 chunk，
   而 OpenAI 规范要求 usage 单独一个 chunk（`choices: []`），magpie 按规范统计。
   → `lib/stream-usage.mjs` 拆成「内容 chunk」+「usage chunk」。
2. **部分模型默认不返回 usage** —— 实测 `chat-flagship` 有，`chat-pro`/`chat-lite` 没有，
   必须带 `stream_options: {include_usage: true}` 才返回。
   → 插件的流式请求固定带上这个参数。
3. **模型间 usage 字段不一致** —— `chat-pro`/`chat-lite` 只给顶层 `reasoning_tokens`，
   没有 `completion_tokens_details` / `prompt_tokens_details`。
   → `normalizeUsage()` 统一补齐成 OpenAI 标准结构。

效果：magpie 面板能正确显示 输入/输出 token 与 输出速度（tok/s）。

> 缓存读取/写入恒为 0：TeleAgent 上游不返回 `cached_tokens` / `cache_write_tokens`，
> 插件只能补 0，不是统计错误。

## Changelog

| 版本 | 内容 |
|---|---|
| 0.1.0 | 初版：provider + 签名 + 协议转换 + 积分 usage |
| 0.2.0 | 网页登录（粘贴 operationToken）+ 图标 |
| 0.3.0 | 模型 limit（context/output 131072）+ 自动签到 |
| 0.3.1 | 聊天请求也触发自动签到 |
| 0.3.2 | 流式 usage 拆成独立 chunk |
| 0.3.3 | 非流式 usage 字段归一 |
| 0.3.4 | 流式 usage 字段归一 |
| 0.3.5 | 流式请求带 `include_usage`，修复 chat-pro/chat-lite 无 usage |

## 目录结构

```
magpie-teleagent/
├─ index.mjs           插件主体（config / auth / provider 三段钩子）
├─ lib/
│  ├─ signer.mjs       网关签名
│  ├─ api.mjs          OpenAI ⇄ 网关 协议转换
│  ├─ account.mjs      账号文件、积分、usage 结构
│  ├─ checkin.mjs      自动签到
│  └─ web-login.mjs    网页登录辅助（链接、token 解析）
├─ logo-mark.png       图标（magpie 会自动下载缓存）
└─ package.json        插件清单（含 magpie 元数据）
```

## 已知限制

- 凭据来自 TeleAgent 客户端；服务端若变更签名规则，需同步 `lib/signer.mjs`
- token 约 90 天过期；网页登录 token 随门户会话过期，长期使用建议用客户端 token
- 仅实现 OpenAI Chat Completions 路径（Anthropic / Responses 入参未接）
- 与 TeleAgent 官方无关联；使用时请遵守其服务条款

## License

MIT

## 流式 usage（v0.3.2）

TeleAgent 网关把 `usage` 放在最后一个带 `choices` 的 chunk 里，而 OpenAI 规范要求
usage 单独一个 chunk（`choices: []`）——magpie 按规范统计，所以之前面板里
token 数/速度/缓存都是空的。

`lib/stream-usage.mjs` 会把流拆成「内容 chunk」+「usage chunk」，并补齐
`prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }`。

效果：magpie 面板能正确显示 输入/输出 token、输出速度、缓存读取/写入（TeleAgent 上游
本身不返回缓存明细，所以缓存恒为 0）。
