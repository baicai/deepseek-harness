import { describe, expect, it } from 'vitest'
import { MaoHaoDemoAdapter, IMAOHAO_DEMO_MODELS, startMaoHaoDemoGateway } from '../src/imaohao-mock.ts'

describe('iMaoHao replaceable mock identity + model gateway', () => {
  it('requires demo login, exposes two models and returns mock completions', async () => {
    const gateway = await startMaoHaoDemoGateway()
    try {
      const unauth = await fetch(gateway.url + '/v1/models')
      expect(unauth.status).toBe(401)
      const login = await fetch(gateway.url + '/auth/login', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + gateway.internalToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'demo@imaohao.com', password: 'demo123456' }),
      })
      expect(login.status).toBe(200)
      const session = await login.json() as { access_token: string; user: { name: string } }
      expect(session.user.name).toBe('贸号演示用户')
      const me = await fetch(gateway.url + '/auth/me', {
        headers: { Authorization: 'Bearer ' + session.access_token },
      })
      expect(me.status).toBe(200)
      const adapter = new MaoHaoDemoAdapter(gateway.url, gateway.internalToken)
      const models = await adapter.listModels('imaohao')
      expect(models.map(model => [model.id, model.name])).toEqual(
        IMAOHAO_DEMO_MODELS.map(model => [model.id, model.name]),
      )
      const chunks = []
      for await (const chunk of adapter.stream({
        provider: 'imaohao', model: 'iMaoHao-V6.1-Astra',
        messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }],
      })) chunks.push(chunk)
      expect(chunks.find(chunk => chunk.type === 'text-delta')).toMatchObject({
        type: 'text-delta', text: expect.stringContaining('不是实际 AI 推理'),
      })
      expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
      const streamed = await fetch(gateway.url + '/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'default', messages: [{ role: 'user', content: '你好' }], stream: true }),
      })
      expect(streamed.headers.get('content-type')).toContain('text/event-stream')
      const body = await streamed.text()
      expect(body).toContain('data: [DONE]')
      const logout = await fetch(gateway.url + '/auth/logout', {
        method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token },
      })
      expect(logout.status).toBe(200)
      const after = await fetch(gateway.url + '/auth/me', {
        headers: { Authorization: 'Bearer ' + session.access_token },
      })
      expect(after.status).toBe(401)
    } finally {
      await gateway.close()
    }
  })
})
