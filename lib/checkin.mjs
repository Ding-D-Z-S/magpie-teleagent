/**
 * lib/checkin.mjs — 积分福利社自动签到
 *
 *   状态：GET /meter/super-agent/user/portal/companyStore/homePage?scene=web
 *         → data.tasks[]，其中 task_code=daily_login 的 claimed 表示今天是否已领
 *   领取：GET /meter/super-agent/user/portal/companyStore/checkTask?type=daily_login
 *
 * 说明：领取是幂等的——已领过时返回 data: []，不会重复发分。
 * 为避免每次 usage 都打接口，这里按 stateFile 里的 lastCheck 做节流（默认 6 小时）。
 */
import fs from 'node:fs'
import path from 'node:path'

const GATEWAY = 'https://agent.teleai.com.cn'
const P_HOME = '/meter/super-agent/user/portal/companyStore/homePage'
const P_CLAIM = '/meter/super-agent/user/portal/companyStore/checkTask'

async function getJSON(path, token, signal, timeoutMs = 15000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  const onAbort = () => ac.abort()
  if (signal) signal.addEventListener('abort', onAbort, { once: true })
  try {
    const r = await fetch(GATEWAY + path, { headers: { 'X-Token': token, Accept: 'application/json' }, signal: ac.signal })
    const text = await r.text()
    if (!r.ok) throw new Error(`HTTP ${r.status} ${text.slice(0, 120)}`)
    return JSON.parse(text)
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return {} }
}
function writeState(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
  } catch {}
  try { fs.writeFileSync(file, JSON.stringify(obj, null, 2), { mode: 0o600 }) } catch {}
}

/** 查今天的任务列表 */
export async function fetchTasks(acc, { signal } = {}) {
  const j = await getJSON(P_HOME + '?scene=web', acc.token, signal)
  return {
    tasks: j?.data?.tasks || [],
    balance: j?.data?.current_points_balance ?? null,
  }
}

/**
 * 自动签到（幂等 + 节流）
 * @returns {{skipped?:boolean, already?:boolean, claimed?:boolean, tasks?:Array, error?:string}}
 */
export async function checkIn(acc, { stateFile, minIntervalMs = 6 * 3600 * 1000, signal, force = false } = {}) {
  try {
    if (stateFile && !force) {
      const st = readState(stateFile)
      if (st.lastCheck && Date.now() - st.lastCheck < minIntervalMs) return { skipped: true }
    }
    const { tasks } = await fetchTasks(acc, { signal })
    const daily = tasks.find((t) => t.task_code === 'daily_login')
    let claimed = false
    let already = true
    if (daily && daily.claimed === false) {
      await getJSON(P_CLAIM + '?type=daily_login', acc.token, signal)
      claimed = true
      already = false
    }
    if (stateFile) writeState(stateFile, { lastCheck: Date.now(), lastClaimed: claimed ? Date.now() : readState(stateFile).lastClaimed || null })
    return { claimed, already, tasks: tasks.map((t) => ({ code: t.task_code, name: t.task_name, claimed: t.claimed, points: t.points_amount })) }
  } catch (e) {
    return { error: String(e?.message ?? e).slice(0, 200) }
  }
}
