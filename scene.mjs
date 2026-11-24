import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildHeaders } from './lib/signer.mjs'
const dir = path.join(os.homedir(), '.config', 'magpie-teleagent', 'accounts')
const f = fs.readdirSync(dir).filter(x => x.endsWith('.json') && !x.includes('checkin'))[0]
const acc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))

async function detail() {
  const r = await fetch('https://agent.teleai.com.cn/meter/super-agent/user/portal/usage/detail?page=1&pageSize=20', { headers: { 'X-Token': acc.token } })
  const j = await r.json()
  return (j.data?.list || []).map(x => `${x.date.slice(0,10)} scene=${x.scene || '(空)'} calls=${x.callCount}`)
}
async function call(extra) {
  const body = JSON.stringify({ model: 'chat-nano', messages: [{ role: 'user', content: 'hi' }], max_tokens: 8 })
  const headers = buildHeaders({ token: acc.token, channelKey: acc.channelKey, deviceId: acc.deviceId, installId: acc.installId, appVersion: '3.1.0', method: 'POST', path: '/superCowork/sapi/api/v1/chat/completions', body })
  headers.Accept = 'application/json'
  Object.assign(headers, extra)
  const r = await fetch('https://agent.teleai.com.cn/superCowork/sapi/api/v1/chat/completions', { method: 'POST', headers, body })
  return r.status
}
console.log('BEFORE:', (await detail()).join(' | '))
const trials = [
  ['A os+ver', { 'X-OS-Type': 'win32', 'X-App-Version': '3.1.0' }],
  ['B channel', { 'X-Channel-Id': 'official', 'X-OS-Type': 'win32', 'X-App-Version': '3.1.0' }],
  ['C scheduler', { 'X-Scheduler-Client': 'desktop', 'X-OS-Type': 'win32', 'X-App-Version': '3.1.0' }],
]
for (const [name, extra] of trials) {
  const st = await call(extra)
  await new Promise(r => setTimeout(r, 4000))
  console.log(name, '->', st, '|', (await detail()).join(' | '))
}
