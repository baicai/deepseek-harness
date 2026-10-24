# iMaoHao-dsh — Mock 服务与正式接口交接规范（v0.1）

> **开发演示专用。** 当前实现为本机 `127.0.0.1` 随机端口、进程内生成随机内部令牌的 Mock 服务。登录凭据和模型回复均为虚构数据。不得作为正式用户认证或模型推理服务上线。

## 一、集成目标和边界

Windows Desktop（贸号DSH）使用 DSH 的 Agent / Session / Tool Runtime，但在演示环境中：
- 不依赖 DeepSeek 账号、DeepSeek API Key 或它的模型目录
- 通过独立的 iMaoHao Host Adapter 提供完整模型目录和模型请求通道
- 客户端经 IPC 调用本地 Mock 账户服务，主进程保管内部 Bearer Token
- 首次打开要求演示登录，登录成功后进入工作区
- 模型显示为「贸号模型（Mock）/ 默认 / iMaoHao-V6.1-Astra」
- 所有回答明确标识 Mock，不执行实际 AI 推理
- 默认模型是 `provider: imaohao` + `model: default`

真实服务应由贸号团队部署于公司控制的 HTTPS 域名，使用独立账户与模型网关。客户端不得内置任何生产级共享主密钥。

## 二、API 约定（可提供给贸号开发团队）

基础路径视部署环境而定。Mock 在每次 Desktop Host 启动时生成随机 loopback 地址，无法作为公网 API 使用。

| 方法 | URL | 请求 | 返回 |
|---|---|---|---|
| GET | `/health` | 无 | `{ "status": "ok", "mode": "mock" }` |
| POST | `/auth/login` | `{ "username": "...", "password": "..." }` | `{ "access_token": "...", "token_type": "Bearer", "expires_in": 3600, "user": { ... } }` |
| GET | `/auth/me` | `Authorization: Bearer <token>` | `{ "id": "...", "name": "...", "email": "...", "roles": [] }` |
| POST | `/auth/logout` | Bearer Token | `{ "success": true }` |
| GET | `/v1/models` | Bearer Token | OpenAI-compatible models list |
| POST | `/v1/chat/completions` | `{ "model": "default", "messages": [], "stream": true/false }` | OpenAI-compatible Completion / SSE |

Mock 登录：
- 账号：`demo@imaohao.com`
- 密码：`demo123456`
- 本地运行时内存凭证：退出程序即失效
- 演示环境不应接受生产账户或密码

### 模型目录示例

```json
{
  "object": "list",
  "data": [
    {"id": "default", "object": "model", "owned_by": "imaohao-mock", "name": "默认"},
    {"id": "iMaoHao-V6.1-Astra", "object": "model", "owned_by": "imaohao-mock", "name": "iMaoHao-V6.1-Astra"}
  ]
}
```

**`default` 是网关路由别名，不应在客户端写死某个供应商模型。** 网关需要在响应/审计中记录它最终路由到的真实模型，以便诊断和计费。

### 推理响应

非流式：遵循 `chat.completion` 的 `choices[0].message.content`、`finish_reason`、`usage`。

流式：`Content-Type: text/event-stream`，按 `data: {JSON}\n\n` 发送 delta；最后发送 `data: [DONE]\n\n`。

Mock 文本带「【贸号 Mock】」，与真实 AI 结果明显区分。

## 三、正式系统需要开发

### 账户服务

正式身份系统推荐 **OIDC / OAuth 2.0 Authorization Code + PKCE**，而非把演示用户名密码登录搬到生产。必须提供授权端点、Token 端点、JWKS / 发行者、公钥轮换、撤销与登出、用户信息、MFA / 安全策略、客户端 ID、桌面应用回调 URI、测试账户及权限映射。正式账号需要支持产品会员等级与服务额度。

### 模型网关

需要提供：
- Base URL、鉴权机制、模型 ID、模型路由与回退策略；
- `default` 对应真实的路由策略；
- 模型能力：上下文窗口、最大输出、流式、Tool Calling / Function Calling、图像处理等；
- 账户级别授权、余额/额度/限流/计费、日志脱敏与合规；
- 可用性 SLA、并发限制、超时和明确的错误码；
- 对账与使用记录，区分「用户身份 Token」和「模型调用凭证」。

**重要：** Mock 只演示文本回复。正式 DSH Agent 需要有效执行工具调用，所以真实模型接口必须支持工具调用，或由网关实现兼容的工具调用协议，否则不能将文本 Mock 的成功视作 Agent 生产能力通过。

## 四、接口替换路径

1. 开发交付符合表中接口协议的 HTTPS 账户服务与模型网关。
2. Desktop 登录器替换 Mock 登录为 OIDC / PKCE 认证，并把用户令牌安全存储于操作系统凭证库；不要传给页面本身。
3. Host 的 `imaohao` Provider 从 Mock 网关切换为生产模型网关，移除演示凭证和演示响应，保留 `provider/model` 语义。
4. 接通真实账户权益、模型白名单、额度和调用审计。
5. 分别验收：未登录、正常登录、Token 过期、退出、权限不足、额度不足、模型切换、流式、工具调用、长会话与断线重连。

## 五、源码入口

- Mock 账户和模型网关：`apps/desktop-host/src/imaohao-mock.ts`
- Host 模型注册：`apps/desktop-host/src/index.ts`
- 桌面登录页：`apps/desktop/renderer/imaohao-login.html`
- IPC 登录桥：`apps/desktop/src/preload-imaohao.ts`
- Desktop 调用链：`apps/desktop/src/main.ts`
- 模型下拉目录：`packages/client/ui-model-selection/src/client/catalog.ts`
- 自动化接口测试：`apps/desktop-host/tests/imaohao-mock.spec.ts`
- Windows CI：`.github/workflows/imaohao-desktop-build.yml`

## 六、验收 Gate

1. 未登录 DeepSeek，安装启动只显示贸号 Mock 登录。
2. Mock 账户登录成功，进入真实 DSH Workspace。
3. 新会话默认选中「默认」，下拉列表能看到 `iMaoHao-V6.1-Astra`。
4. 手动切换第二个模型，发消息时模型 ID 实际送到 Mock 网关。
5. 返回 Mock 对话且不触发 DeepSeek 外部网络请求。
6. 网关宕机显示失败，而不是回退 DeepSeek。
7. 仅在 Windows CI 完成源码检查、Mock 合约测试、Windows 打包/启动测试后交付 EXE。

> 当前这份规范是接口契约草案。正式团队确认后建议补充完整 OpenAPI 3.1、账户的错误返回体、Token 时效与刷新语义、工具调用协议和用户权益字段。
