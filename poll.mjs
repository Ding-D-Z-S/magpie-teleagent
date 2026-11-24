import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const dir = path.join(os.homedir(), '.config', 'magpie-teleagent', 'accounts')
const f = fs.readdirSync(dir).filter(x => x.endsWith('.json') && !x.includes('checkin'))[0]
const acc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
async function row() {
  const r = await fetch('https://agent.teleai.com.cn/meter/super-agent/user/portal/usage/detail?page=1&pageSize=20', { headers: { 'X-Token': acc.token } })
  const j = await r.json()
  return (j.data?.list || []).filter(x => x.date.startsWith('2026-11-24')).map(x => `${x.scene || '(空)'}:${x.callCount}通/${x.modelUsage}`).join(' | ')
}
for (let i = 0; i < 6; i++) {
  console.log(i, await row())
  await new Promise(r => setTimeout(r, 20000))
}
