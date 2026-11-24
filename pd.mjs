import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const dir = path.join(os.homedir(), '.config', 'magpie-teleagent', 'accounts')
const f = fs.readdirSync(dir).filter(x => x.endsWith('.json') && !x.includes('checkin'))[0]
const acc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
const r = await fetch('https://agent.teleai.com.cn/meter/super-agent/user/portal/points/detail', { headers: { 'X-Token': acc.token } })
const j = await r.json()
console.log('top keys:', Object.keys(j.data || {}))
const s = JSON.stringify(j.data)
console.log('len', s.length)
// 找消耗记录类字段
for (const k of ['records','list','consumeRecords','usageRecords','details','items']) {
  if (j.data?.[k]) console.log(k, '->', JSON.stringify(j.data[k]).slice(0, 400))
}
