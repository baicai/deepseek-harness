/**
 * iMaoHao-dsh local demo identity and model gateway.
 *
 * This is a development-only, loopback-bound service; it never contacts
 * DeepSeek or an external provider. The HTTP contract is intentionally
 * replaceable by a production iMaoHao service.
 */
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { LlmAdapter, LlmError, type GenerateOptions, type LlmModelInfo, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'

export const IMAOHAO_DEMO_PROVIDER = 'imaohao'
export const IMAOHAO_DEMO_MODELS = [
  { id: 'default', name: '默认' },
  { id: 'iMaoHao-V6.1-Astra', name: 'iMaoHao-V6.1-Astra' },
] as const
const MOCK_EMAIL = 'demo@imaohao.com'
const MOCK_PASSWORD = 'demo123456'
const MAX_BODY_BYTES = 64 * 1024

export interface MaoHaoGateway {
  readonly url: string
  /** Desktop-process only: do not expose this bearer token to an untrusted renderer. */
  readonly internalToken: string
  readonly close: () => Promise<void>
}

function equalSecret(received: string, expected: string): boolean {
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const item of request) {
    const buffer = Buffer.isBuffer(item) ? item : Buffer.from(item as Uint8Array)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('payload too large')
    chunks.push(buffer)
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid JSON object')
  return input as Record<string, unknown>
}

function json(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' })
  response.end(JSON.stringify(data))
}
function incomingModel(model: unknown): model is 'default' | 'iMaoHao-V6.1-Astra' {
  return IMAOHAO_DEMO_MODELS.some(entry => entry.id === model)
}

/** Start on an ephemeral loopback port, with no public listener or static secret. */
export async function startMaoHaoDemoGateway(): Promise<MaoHaoGateway> {
  const internalToken = randomBytes(32).toString('hex')
  const sessions = new Set<string>()
  const server = createServer((request, response) => {
    const route = new URL(request.url ?? '/', 'http://127.0.0.1')
    const method = request.method ?? ''
    const bearer = request.headers.authorization?.replace(/^Bearer /i, '') ?? ''
    const internal = equalSecret(bearer, internalToken)
    const user = sessions.has(bearer)
    const permitted = internal || user
    const reject = (code: number, message: string): void => json(response, code, { error: { message, type: 'mock_error' } })
    void (async () => {
      // Do not allow browser-origin requests from arbitrary websites to use the
      // loopback server, even when they can make cross-origin requests.
      if (request.headers.origin !== undefined) { reject(403, 'browser origin not permitted'); return }
      if (route.pathname === '/health' && method === 'GET') {
        json(response, 200, { status: 'ok', mode: 'mock', product: 'iMaoHao-dsh' })
        return
      }
      if (route.pathname === '/auth/login' && method === 'POST') {
        if (!internal) { reject(401, 'desktop client authorization required'); return }
        const input = await readJson(request)
        if (input.username !== MOCK_EMAIL || typeof input.password !== 'string'
          || !equalSecret(input.password, MOCK_PASSWORD)) {
          reject(401, 'invalid demo credentials'); return
        }
        const token = randomBytes(32).toString('hex')
        sessions.add(token)
        json(response, 200, { access_token: token, token_type: 'Bearer', expires_in: 3600,
          user: { id: 'demo-user-001', email: MOCK_EMAIL, name: '贸号演示用户', roles: ['demo'] } })
        return
      }
      if (route.pathname === '/auth/me' && method === 'GET') {
        if (!user) { reject(401, 'unauthenticated'); return }
        json(response, 200, { id: 'demo-user-001', email: MOCK_EMAIL, name: '贸号演示用户', roles: ['demo'] })
        return
      }
      if (route.pathname === '/auth/logout' && method === 'POST') {
        sessions.delete(bearer)
        json(response, 200, { success: true })
        return
      }
      if (route.pathname === '/v1/models' && method === 'GET') {
        if (!permitted) { reject(401, 'unauthenticated'); return }
        json(response, 200, { object: 'list', data: IMAOHAO_DEMO_MODELS.map(model => ({
          id: model.id, object: 'model', owned_by: 'imaohao-mock', name: model.name,
          capabilities: { text: true, streaming: true, tools: false },
        })) })
        return
      }
      if (route.pathname === '/v1/chat/completions' && method === 'POST') {
        if (!permitted) { reject(401, 'unauthenticated'); return }
        const input = await readJson(request)
        if (!incomingModel(input.model)) { reject(404, 'unknown model'); return }
        const entries = Array.isArray(input.messages) ? input.messages : []
        const latest = [...entries].reverse().find(item =>
          typeof item === 'object' && item !== null && 'role' in item && item.role === 'user') as
          { content?: unknown } | undefined
        const prompt = typeof latest?.content === 'string' ? latest.content.slice(0, 160) : ''
        const content = `【贸号 Mock】你正在使用 ${input.model}。这是本地演示回复，不是实际 AI 推理。`
          + (prompt ? `\n你刚才说：${prompt}` : '')
        const reply = { id: 'chatcmpl-' + randomUUID(), object: 'chat.completion',
          created: Math.floor(Date.now() / 1000), model: input.model,
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: Math.max(1, Math.ceil(content.length / 3)), total_tokens: 1 + Math.max(1, Math.ceil(content.length / 3)) } }
        if (input.stream !== true) { json(response, 200, reply); return }
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' })
        const chunk = (delta: object, finish_reason: string | null): string => 'data: ' + JSON.stringify({
          id: reply.id, object: 'chat.completion.chunk', created: reply.created, model: reply.model,
          choices: [{ index: 0, delta, finish_reason }],
        }) + '\n\n'
        response.write(chunk({ role: 'assistant' }, null))
        for (const text of content.match(/.{1,24}/gsu) ?? []) response.write(chunk({ content: text }, null))
        response.write(chunk({}, 'stop'))
        response.end('data: [DONE]\n\n')
        return
      }
      reject(404, 'route not found')
    })().catch((error: unknown) => {
      if (!response.headersSent) reject(error instanceof SyntaxError ? 400 : 413, 'invalid demo request')
      else response.end()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  return {
    url: 'http://127.0.0.1:' + String(address.port),
    internalToken,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => { if (error) reject(error); else resolve() })
      server.closeAllConnections()
    }),
  }
}

/**
 * Use exactly the same catalog and chat request contract as a real iMaoHao
 * gateway. The production adapter replaces the baseURL + authorization only.
 */
export class MaoHaoDemoAdapter extends LlmAdapter {
  constructor(private readonly endpoint: string, private readonly internalToken: string) { super() }

  override providerInfo(provider: string) {
    return { id: provider, name: '贸号模型（Mock）' }
  }
  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const response = await fetch(this.endpoint + '/v1/models', {
      headers: { Authorization: 'Bearer ' + this.internalToken },
    })
    if (!response.ok) throw new LlmError('iMaoHao mock catalog failed', 'CATALOG_FAILED')
    const json = await response.json() as { data: { id: string; name: string }[] }
    return json.data.map(model => ({ provider, id: model.id, name: model.name, inputModalities: ['text'] }))
  }
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const found = IMAOHAO_DEMO_MODELS.find(item => item.id === model)
    if (!found) throw new LlmError('Unknown iMaoHao model ' + model, 'MODEL_NOT_FOUND')
    return { provider, id: model, name: found.name, context: { contextWindow: 32768 } }
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (!incomingModel(options.model)) throw new LlmError('Unknown iMaoHao model ' + options.model, 'MODEL_NOT_FOUND')
    const messages = options.messages.map(item => ({
      role: item.role,
      content: ('content' in item && Array.isArray(item.content))
        ? item.content.filter(block => block.type === 'text').map(block => 'text' in block ? block.text : '').join('\n')
        : '',
    }))
    const response = await fetch(this.endpoint + '/v1/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + this.internalToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: options.model, stream: false, messages }), signal: options.signal,
    })
    if (!response.ok) throw new LlmError('iMaoHao mock request failed', 'MOCK_REQUEST_FAILED')
    const data = await response.json() as { choices: { message: { content: string } }[]; usage: { prompt_tokens: number; completion_tokens: number } }
    const content = data.choices[0]?.message.content ?? '【贸号 Mock】空响应'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: content }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: content } }
    yield { type: 'usage', usage: { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
