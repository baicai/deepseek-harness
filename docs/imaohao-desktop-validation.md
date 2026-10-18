# 贸号 Desktop — DSH Downstream Validation

> Status: engineering prototype. Not an official product release. The uploaded logo/QR source files have not been materialized in this session, so the mark below is **temporary** and cannot be accepted as the supplied identity.

## Scope

- Branch: `imaohao-branding-test` (kept separate from `master` and `cnyu-branding-test`).
- Upstream core packages, engine and existing DeepSeek account/provider functions remain.
- Desktop brand/installer display: **贸号**; Windows/macOS application ID `com.imaohao.desktop`.
- Official website: https://www.imaohao.com/
- About us: https://www.imaohao.com/aboutus.html
- Customer service: official website contact/QR pending the attached file; the current app menu opens the website, **not** an embedded QR.
- Embedded desktop sidebar and welcome: provisional text/monogram; upstream mascot/wordmark should not be shown on the branded desktop startup. The source of truth for production artwork must be the provided vector or lossless master.
- `dsh://` and internal package names remain unchanged intentionally to preserve the current host runtime and DeepSeek auth compatibility. They do not mean official 贸号 OAuth exists.
- The branded app uses a separate Electron userData and `DSH_HOME` to avoid overwriting upstream DSH credentials, sessions or defaults.

## Mock models — not inference services

Configured only with `IMAOHAO_BRANDING_TEST=1`:

| Provider ID | Model ID | UI name | Behavior |
|---|---|---|---|
| `imaohao-demo` | `default` | 默认 | Selected by default for new conversations; no real inference |
| `imaohao-demo` | `iMaoHao-V6.1-Astra` | iMaoHao-V6.1-Astra | Selectable; no real inference |

The adapter uses `openai-completions` and a **non-listening loopback example** `http://127.0.0.1:39401/v1` with a missing credential reference `IMAOHAO_MODEL_API_KEY`, so it should fail with a missing-credential diagnostic rather than sending a prompt to DeepSeek or a third-party server. **Do not put a real key into this prototype without replacing the endpoint.** The displayed capacity is a temporary configuration claim, not verified provider capability.

The upstream `session/initializeDefaultModel` DeepSeek account initialization is disabled for the 贸号 desktop test; this prevents an account sign-in from silently overwriting the `默认` selection. A previously saved non-default choice may still take priority, as normal DSH behavior specifies. This app uses separate profile storage.

### What 贸号 must provide for real models

1. Gateway base URL (for example `https://api.imaohao.com/v1`, **only if that service actually exists**), exact API protocol (`openai-completions`, `openai-responses`, or `anthropic-messages`), expected model IDs and routing policy for “默认”.
2. Auth scheme: gateway-issued API key or signed short-lived user token; key issuance, rotation, usage limit and revocation. Never put a shared platform master secret in the desktop client.
3. Per-model capability matrix: contextWindow, max output tokens, tool/function calling, streaming, images, effort controls and rate limits; test evidence for tools and SSE.
4. Tenant/user usage quota & billing, API error contracts, moderation/safety requirements, auditing and data retention, latency targets and availability.
5. Optional backend authorization gateway to map logged-in 贸号 users to permitted models (required for account-based quotas).

Suggested separation: **MaoHao User Identity** → entitlement/policy → **Model Gateway** → provider/model. The model dropdown alone is not a billing or identity system.

### Configure a real 贸号 endpoint

In the Desktop's isolated profile `$DSH_HOME/profiles/desktop/cordis.patch.yml`, override the complete `llm-pi-ai` config with a provider route. The following is only a **template**, not a live endpoint:

```yaml
- id: llm-pi-ai
  config:
    providers:
      imaohao:
        displayName: 贸号
        api: openai-completions
        baseURL: https://YOUR-REAL-API-HOST/v1
        apiKeyEnv: IMAOHAO_MODEL_API_KEY
        models:
          - id: default
            name: 默认
            contextWindow: 32768
            maxTokens: 4096
          - id: iMaoHao-V6.1-Astra
            name: iMaoHao-V6.1-Astra
            contextWindow: 32768
            maxTokens: 4096
```

After supplying the real gateway, update the application default route from `imaohao-demo` to `imaohao` using the Host Models settings. A saved default must name a routable configured provider. Replace model capacity numbers with verified server limits.

## Third-party accounts and 贸号 account

DSH already exposes its DeepSeek account flow (models, balance, token), plus separate provider auth/OAuth via the `authorization` and `credentials` seams. These are **not** a generic MaoHao SSO implementation.

Recommended new `imaohao-account` integration:

- OAuth2 Authorization Code + PKCE with OIDC when supported, and a browser/loopback native callback.
- Server-side verification of issuer, audience, expiry and nonce; local OS-protected refresh credential; bounded logout/revocation.
- One mapped `MaoHaoUser` (id, displayName, entitlements) independent of DeepSeek account state and model API-key records.
- Use a MaoHao Gateway for user-specific model authorization and quota, not a shared API key shipped in Electron.
- Define fallbacks when login is unavailable: existing DeepSeek sign-in and per-provider API key setup.

Inputs needed to implement actual OAuth: authorization/token/JWKS/discovery URLs, client ID, authorized callback origins/redirect URIs, scopes, logout/revoke endpoints, userinfo or introspection API, test accounts, identity mapping, session policy and privacy terms. Client secret, if any, must remain on a backend.

**Current state:** do not advertise `贸号账号登录` as working. The welcome UI explicitly names DeepSeek as the existing account provider.

## Desktop package build and verification

Workflow: `.github/workflows/imaohao-desktop-build.yml` on `imaohao-branding-test`.

Windows x64: unsigned .exe; macOS Apple Silicon: unsigned .dmg. Untrusted developer packages may show system warnings; signing, notarization, update feed and DMG/NSIS metadata production readiness are out of scope.

CI first generates **temporary** raster/ICO assets from `apps/desktop/resources/imaohao-prototype.svg`. For production, replace that one asset using the supplied master artwork, regenerate PNG+ICO, inspect at 16/20/24/32/48/64/128/256/512/1024 px and validate the OS-specific shape/safe margins.

Acceptance checklist:
- [ ] Windows installed app name, Start menu, running taskbar and tray show 贸号 (not DSH).
- [ ] macOS Finder .app, Dock, Menu, About, welcome show 贸号.
- [ ] Embedded workspace sidebar and browser/page icon show 贸号 artwork.
- [ ] Official website/About open the required URLs.
- [ ] Contact QR uses the **exact supplied attachment**; not yet completed.
- [ ] Both mock models appear; a clean install selects “默认”.
- [ ] Sending via either mock route never silently uses a real provider.
- [ ] Model and user account auth can be configured independently.
- [ ] Existing upstream desktop continues to work alongside and retains its own profile/session data.
- [ ] Actual downloaded package launches and passes the UI/manual checks (CI success alone does not establish this).

## License, credits and safe distribution

Preserve the upstream MIT license and attribution. Changing user-facing branding does not grant official DeepSeek model services or an official 贸号 SSO. Do not publish unsigned debug packages as a production release. Do not set the upstream official auto-update feed on a separately branded distribution.
