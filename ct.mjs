import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildHeaders } from './lib/signer.mjs'
const require = createRequire('C:/Users/DingDZS/Desktop/teleagent-proxy-v3/lib/x.js')
const { scan } = require('C:/Users/DingDZS/Desktop/teleagent-proxy-v3/lib/account-manager/scanner.js')
const r = scan({})
const a = (r.accounts || r)[0]
const clientToken = a.token
const dir = path.join(os.homedir(), '.config', 'magpie-teleagent', 'accounts')
const f = fs.readdirSync(dir).filter(x => x.endsWith('.json') && !x.includes('checkin'))[0]
const acc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))

async function usageRow(token) {
  const res = await fetch('https://agent.teleai.com.cn/meter/super-agent/user/portal/usage/detail?page=1&pageSize=20', { headers: { 'X-Token': token } })
  const j = await res.json()
  return (j.data?.list || []).filter(x => x.date.startsWith('2026-11-24')).map(x => `${x.scene || '(空)'}:${x.callCount}/${x.modelUsage}`).join(' | ')
}
async function call(token, label) {
  const body = JSON.stringify({ model: 'chat-flagship', messages: [{ role: 'user', content: 'say ok' }], max_tokens: 20 })
  const headers = buildHeaders({ token, channelKey: acc.channelKey, deviceId: acc.deviceId, installId: acc.installId, appVersion: '3.1.0', method: 'POST', path: '/superCowork/sapi/api/v1/chat/completions', body })
  headers.Accept = 'application/json'
  const res = await fetch('https://agent.teleai.com.cn/superCowork/sapi/api/v1/chat/completions', { method: 'POST', headers, body })
  console.log(label, res.status)
}
console.log('BEFORE:', await usageRow(clientToken))
await call(clientToken, 'client-token call')
for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 30000)); console.log(i, await usageRow(clientToken)) }
