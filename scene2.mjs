import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildHeaders } from './lib/signer.mjs'
const dir = path.join(os.homedir(), '.config', 'magpie-teleagent', 'accounts')
const f = fs.readdirSync(dir).filter(x => x.endsWith('.json') && !x.includes('checkin'))[0]
const acc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
async function call(label, bodyExtra, headersExtra) {
  const body = JSON.stringify({ model: 'chat-nano', messages: [{ role: 'user', content: 'hi' }], max_tokens: 8, ...bodyExtra })
  const headers = buildHeaders({ token: acc.token, channelKey: acc.channelKey, deviceId: acc.deviceId, installId: acc.installId, appVersion: '3.1.0', method: 'POST', path: '/superCowork/sapi/api/v1/chat/completions', body })
  headers.Accept = 'application/json'
  Object.assign(headers, headersExtra)
  const r = await fetch('https://agent.teleai.com.cn/superCowork/sapi/api/v1/chat/completions', { method: 'POST', headers, body })
  const t = await r.text()
  console.log(label, r.status, t.slice(0, 120).replace(/\s+/g, ' '))
}
await call('body scene=desktop', { scene: 'desktop' }, {})
await call('header X-Scene', {}, { 'X-Scene': 'desktop' })
await call('both + os/ver', { scene: 'desktop', device: 'pc' }, { 'X-Scene': 'desktop', 'X-OS-Type': 'win32', 'X-App-Version': '3.1.0' })
