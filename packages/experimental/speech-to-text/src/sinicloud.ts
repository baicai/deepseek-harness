/** Sonicloud hosted ASR, matching the official mouse-mcp token and stream protocol.
 * The provider receives a complete validated WAV from the DSH speech controller.
 * Secrets stay in the Host environment and are never included in errors.
 */
import { createHash } from 'node:crypto'
import type { SpeechProvider, SpeechProviderId, Transcript } from './types.ts'

export interface SinicloudOptions {
  readonly appId?: string
  readonly apiKey?: string
  readonly apiSecret?: string
  readonly tokenUrl?: string
  readonly streamUrl?: string
  readonly userId?: string
  readonly languageId?: number
}

function recognizeFrames(audio: Uint8Array, token: string, options: SinicloudOptions, signal: AbortSignal): Promise<string> {
  const endpoint = new URL(options.streamUrl ?? 'wss://openapi.sinicloud.com/talentStreamAsr')
  // Never send tokens or speech over unencrypted transport.
  if (endpoint.protocol !== 'wss:') throw new Error('sinicloud_secure_websocket_required')
  endpoint.searchParams.set('X-SC-Authorization', token)
  endpoint.searchParams.set('X-SC-User-Id', options.userId ?? 'dsh-maohao')
  endpoint.searchParams.set('lanid', String(options.languageId ?? 0))
  return new Promise<string>((resolve, reject) => {
    signal.throwIfAborted()
    const ws = new WebSocket(endpoint.href)
    let ready = false
    let done = false
    let finalText = ''
    let previewText = ''
    let offset = 44
    let sender: ReturnType<typeof setInterval> | undefined
    const timeout = setTimeout(() => fail('sinicloud_timeout'), Math.min(180_000, 30_000 + (audio.byteLength - 44) / 32))
    const cleanup = () => {
      clearTimeout(timeout)
      if (sender) clearInterval(sender)
      signal.removeEventListener('abort', aborted)
      try { ws.close() } catch { /* already closed */ }
    }
    const succeed = () => {
      if (done) return
      done = true
      cleanup()
      resolve(finalText || previewText)
    }
    const fail = (reason: string) => {
      if (done) return
      done = true
      cleanup()
      reject(new Error(reason))
    }
    const aborted = () => fail('sinicloud_cancelled')
    signal.addEventListener('abort', aborted, { once: true })
    // Native 16kHz mono PCM16: approximately 100 ms per 3200-byte frame.
    const sendChunk = () => {
      if (ws.readyState !== WebSocket.OPEN || done) return
      if (offset >= audio.byteLength) {
        if (sender) clearInterval(sender)
        sender = undefined
        ws.send('end')
        return
      }
      const end = Math.min(offset + 3200, audio.byteLength)
      const chunk = Buffer.from(audio.subarray(offset, end))
      offset = end
      if (chunk.length < 81) ws.send(Buffer.concat([chunk, Buffer.alloc(81 - chunk.length)]))
      else ws.send(chunk)
    }
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string' || done) return
      let message: { errCode?: unknown; result?: unknown; End?: unknown }
      try { message = JSON.parse(event.data) as typeof message } catch { return }
      const code = Number(message.errCode)
      const text = typeof message.result === 'string' ? message.result : ''
      if (code === 1000 && !ready) {
        ready = true
        sendChunk()
        if (sender === undefined && offset < audio.byteLength) sender = setInterval(sendChunk, 100)
        return
      }
      if (code === 1 || code === 2 || code === 3 || (code === 0 && Number(message.End) === 0)) {
        if (text) previewText = text
        return
      }
      if (code === 0 && Number(message.End) > 0) { if (text) finalText = text; return }
      if (code === 10) { if (text) finalText = text; succeed(); return }
      if (code === 1001) return // low balance warning; request may still complete
      if (code < 0 || (code >= 4000 && code <= 5999)) fail('sinicloud_service_error')
    }
    ws.onclose = () => { if (ready && offset >= audio.byteLength) succeed(); else fail('sinicloud_connection_closed') }
    ws.onerror = () => fail('sinicloud_connection_failed')
  })
}

/** No preparation or downloaded model. Credential failures affect transcription only. */
export function createSinicloudProvider(options: SinicloudOptions = {}): SpeechProvider {
  return {
    info: { id: 'sinicloud-cloud' as SpeechProviderId, name: '声云在线语音识别', location: 'cloud', languages: ['auto'] },
    async transcribe(input, signal): Promise<Transcript> {
      signal.throwIfAborted()
      const appId = options.appId ?? process.env.SINICLOUD_APP_ID
      const apiKey = options.apiKey ?? process.env.SINICLOUD_API_KEY
      const apiSecret = options.apiSecret ?? process.env.SINICLOUD_API_SECRET
      if (!appId || !apiKey || !apiSecret) throw new Error('sinicloud_credentials_missing')
      const started = performance.now()
      const timeStamp = Math.floor(Date.now() / 1000)
      const sign = createHash('md5').update(appId + apiKey + timeStamp + apiSecret).digest('hex')
      const tokenEndpoint = options.tokenUrl ?? 'https://openapi.sinicloud.com/api/auth/get_token'
      if (new URL(tokenEndpoint).protocol !== 'https:') throw new Error('sinicloud_secure_token_endpoint_required')
      let response: Response
      try {
        response = await fetch(tokenEndpoint, {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal,
          body: JSON.stringify({ appId, apiKey, timeStamp, sign }),
        })
      } catch {
        signal.throwIfAborted()
        throw new Error('sinicloud_token_network_error')
      }
      if (!response.ok) throw new Error('sinicloud_token_http_error')
      let payload: { code?: unknown; data?: { token?: unknown } }
      try { payload = await response.json() as typeof payload } catch { throw new Error('sinicloud_token_invalid_response') }
      if (Number(payload.code) !== 0 || typeof payload.data?.token !== 'string' || !payload.data.token) {
        throw new Error('sinicloud_token_denied')
      }
      const text = await recognizeFrames(input.audio, payload.data.token, options, signal)
      signal.throwIfAborted()
      return { text: text.trim(), audioSeconds: (input.audio.byteLength - 44) / 32000,
        inferenceSeconds: (performance.now() - started) / 1000 }
    },
  }
}
