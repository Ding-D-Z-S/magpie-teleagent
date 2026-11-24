import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const dir = path.join(os.homedir(),'.config','magpie-teleagent','accounts')
const f = fs.readdirSync(dir).filter(x=>x.endsWith('.json')&&!x.includes('checkin'))[0]
const acc = JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'))
const r = await fetch('https://agent.teleai.com.cn/meter/super-agent/user/portal/usage/detail?page=1&pageSize=10', { headers: { 'X-Token': acc.token } })
const t = await r.text()
console.log('status', r.status)
console.log(t.slice(0, 900))
