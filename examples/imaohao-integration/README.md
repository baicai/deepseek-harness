# iMaoHao DSH — customer integration example

This directory demonstrates **customer-owned identity and model APIs**. It is NOT a replacement for the DSH desktop application. Run `node server.mjs` (Node.js 22+, no npm installation), then configure an installed branded DSH executable:

```powershell
$env:IMAOHAO_INTEGRATION_BASE_URL = 'http://127.0.0.1:39401'
$env:IMAOHAO_INTEGRATION_SERVICE_TOKEN = 'dev-only-change-me-123456'
& 'C:\Program Files\iMaoHao\iMaoHao-DSH\贸号DSH.exe'
```

Without these variables the packaged demonstration uses its own embedded Mock. For customer integration, keep the API contract but replace the mock business implementations.

| HTTP API | Business logic to implement |
|---|---|
| POST /auth/login | Corporate IAM, SSO/MFA, account and tenant validation, login failure |
| GET /auth/me | User identity, tenant and roles |
| POST /auth/logout | Session revocation |
| GET /v1/models | Authorized model IDs, labels, model availability |
| POST /v1/chat/completions | OpenAI compatible inference, streaming SSE, usage, tool_calls |
| GET /health | Readiness |

Demo account: demo@imaohao.com / demo123456. Models: default, iMaoHao-V6.1-Astra. **Mock is for loopback only, never publish as a production service.**

Customer must supply: sandbox OAuth2/OIDC + PKCE account flows or equivalent API specification; test users and tenant/roles; MFA, refresh and revocation behavior; model API URL/headers, credentials; model catalog, supported tools, SSE, modality and quota behavior; error map, TLS and compliance requirements.

**Account login and model credentials are separate trust domains.** Do not ship permanent provider/tenant secrets inside the distributable desktop binary. The example is the minimum contract, not a production security architecture.

Original DSH includes the Electron shell, Host, Agent, sessions, tools, workspaces and original DeepSeek account/Platform components. This integration makes the branded demonstration use the customer API for sign-in and model requests. Separately audit legacy Platform (usage/top-up), telemetry, updates, profile persistence and other DeepSeek-specific surfaces before release.

For the downloadable offline contract-test, OpenAPI and developer checklist, see the companion `iMaoHao-DSH-Customer-Integration-Kit-v0.1.zip` archive.
