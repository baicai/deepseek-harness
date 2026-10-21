import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const program = fileURLToPath(new URL('./server.mjs', import.meta.url))
const child = spawn(process.execPath, [program], { env: { ...process.env, IMAOHAO_DEMO_PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] })
try {
  const base = await Promise.race([
    new Promise((resolve, reject) => {
      child.stdout.on('data', data => {
        const url = /IMAOHAO_INTEGRATION_READY=(\S+)/.exec(data.toString())?.[1]
        if (url) resolve(url)
      })
      child.on('exit', code => reject(new Error('Service exited: ' + code)))
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Service timeout')), 10000)),
  ])
  const headers = { Authorization: 'Bearer dev-only-change-me-123456', 'Content-Type': 'application/json' }
  const models = await fetch(base + '/v1/models', { headers }).then(x => x.json())
  if (models.data?.map(x => x.id).join(',') !== 'default,iMaoHao-V6.1-Astra') throw new Error('model ids mismatch')
  const login = await fetch(base + '/auth/login', { method: 'POST', headers,
    body: JSON.stringify({ username: 'demo@imaohao.com', password: 'demo123456' }) }).then(x => x.json())
  if (!login.access_token) throw new Error('login mismatch')
  const completion = await fetch(base + '/v1/chat/completions', { method: 'POST', headers,
    body: JSON.stringify({ model: 'default', stream: true, messages: [{ role: 'user', content: 'hi' }] }) })
  const stream = await completion.text()
  if (!completion.ok || !stream.includes('data: [DONE]')) throw new Error('stream mismatch')
  console.log('PASS: iMaoHao external gateway contract')
} finally {
  child.kill()
}
