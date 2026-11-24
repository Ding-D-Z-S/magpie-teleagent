import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildHeaders } from './lib/signer.mjs'
const dir = path.join(os.homedir(), '.config', 'magpie-teleagent', 'accounts')
const f = fs.readdirSync(dir).filter(x => x.endsWith('.json') && !x.includes('checkin'))[0]
const acc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
const body = JSON.stringify({ model: 'chat-flash', messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 })
const headers = buildHeaders({ token: acc.token, channelKey: acc.channelKey, deviceId: acc.deviceId, installId: acc.installId, appVersion: '3.1.0', method: 'POST', path: '/superCowork/sapi/api/v1/chat/completions', body })
headers.Accept = 'application/json'
const r = await fetch('https://agent.teleai.com.cn/superCowork/sapi/api/v1/chat/completions', { method: 'POST', headers, body })
console.log('=== response headers ===')
for (const [k, v] of r.headers) console.log(' ', k, '=', v.slice(0, 60))
const j = await r.json()
console.log('=== body top keys ===', Object.keys(j).join(','))
console.log('=== usage ===', JSON.stringify(j.usage))
for (const k of Object.keys(j)) {
  const s = JSON.stringify(j[k])
  if (/point|credit|cost|积分|price/i.test(k + s.slice(0, 100))) console.log('  candidate', k, '=', s.slice(0, 120))
}
