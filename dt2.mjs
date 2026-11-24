import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildHeaders } from './lib/signer.mjs'
const dir = path.join(os.homedir(), '.config', 'magpie-teleagent', 'accounts')
const f = fs.readdirSync(dir).filter(x => x.endsWith('.json') && !x.includes('checkin'))[0]
const acc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
const DESKTOP_ID = 'ceb6413c-e1ae-11ee-a4f6-40c2ba408789'

async function csv() {
  const r = await fetch('https://agent.teleai.com.cn/meter/super-agent/user/portal/usage/detail/download', { headers: { 'X-Token': acc.token } })
  return (await r.text()).split('\n').filter(l => l.includes('2026-11-24'))
}
async function call(deviceId, installId, extra = {}) {
  const body = JSON.stringify({ model: 'chat-nano', messages: [{ role: 'user', content: 'hi' }], max_tokens: 8 })
  const headers = buildHeaders({ token: acc.token, channelKey: acc.channelKey, deviceId, installId, appVersion: '3.1.0', method: 'POST', path: '/superCowork/sapi/api/v1/chat/completions', body })
  headers.Accept = 'application/json'
  Object.assign(headers, extra)
  const r = await fetch('https://agent.teleai.com.cn/superCowork/sapi/api/v1/chat/completions', { method: 'POST', headers, body })
  return r.status
}
console.log('BEFORE:', (await csv()).join(' || '))
console.log('desktop deviceId ->', await call(DESKTOP_ID, acc.installId))
await new Promise(r => setTimeout(r, 6000))
console.log('AFTER1:', (await csv()).join(' || '))
console.log('desktop + X-User-Id ->', await call(DESKTOP_ID, acc.installId, { 'X-User-Id': String(acc.accountId || ''), 'X-Requested-With': 'XMLHttpRequest' }))
await new Promise(r => setTimeout(r, 6000))
console.log('AFTER2:', (await csv()).join(' || '))
