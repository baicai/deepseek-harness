/** Per-user, authenticated Windows named-pipe protocol for Maohao's independent mouse agent. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Stable per-installation endpoint; no serial number or device identifiers enter its name. */
export function mouseAgentEndpoint(userData: string): string {
  const id = createHash('sha256').update(userData.toLowerCase()).digest('hex').slice(0, 24)
  return '\\\\.\\pipe\\dsh-maohao-' + id
}

export function mouseAgentTokenFile(userData: string): string {
  return join(userData, 'maohao-mouse-agent', 'auth.token')
}

/** The serving agent creates one stable random secret; only the current user should read it. */
export function createMouseAgentToken(userData: string): string {
  const file = mouseAgentTokenFile(userData)
  mkdirSync(join(userData, 'maohao-mouse-agent'), { recursive: true, mode: 0o700 })
  if (!existsSync(file)) {
    try { writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  return readMouseAgentToken(userData)
}

export function readMouseAgentToken(userData: string): string {
  const value = readFileSync(mouseAgentTokenFile(userData), 'utf8').trim()
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error('Invalid mouse agent token')
  return value
}

export function isMouseAgentTokenMatch(expected: string, incoming: unknown): boolean {
  if (typeof incoming !== 'string' || !/^[0-9a-f]{64}$/u.test(incoming)) return false
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(incoming, 'hex'))
}

export const MAOHAO_AGENT_FLAG = '--maohao-agent'
