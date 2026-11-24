import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const dir = path.join(os.homedir(), '.config', 'magpie-teleagent', 'accounts')
const f = fs.readdirSync(dir).filter(x => x.endsWith('.json') && !x.includes('checkin'))[0]
const acc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
for (const q of ['', '?startDate=2026-11-01&endDate=2026-11-24']) {
  const r = await fetch('https://agent.teleai.com.cn/meter/super-agent/user/portal/usage/detail/download' + q, { headers: { 'X-Token': acc.token } })
  const ct = r.headers.get('content-type') || ''
  const t = await r.text()
  console.log('DL', q || '(no query)', r.status, ct.slice(0, 40), '| len', t.length)
  console.log(t.slice(0, 300).replace(/\s+/g, ' '))
}
