/**
 * lib/account.mjs — TeleAgent 账号文件与积分读取
 *
 * 账号文件（默认 ~/.config/magpie-teleagent/account.json）：
 *   { token, channelKey, deviceId, installId, accountId, accountName, phone }
 *
 * token 由 TeleAgent 客户端 token.json（safe_storage / DPAPI）解出；
 * channelKey 是所有客户端共用的渠道密钥，可从 app.asar 里提取。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const GATEWAY = 'https://agent.teleai.com.cn'
export const CHAT_PATH = '/superCowork/sapi/api/v1/chat/completions'
export const BASE = GATEWAY + '/superCowork/sapi/api/v1'

const P_POINTS = '/meter/super-agent/user/portal/points/detail'
const P_CENTER = '/meter/super-agent/user/portal/companyStore/userCenter'
const P_INFO = '/meter/cowork/user_info'

export function defaultAccountFile() {
  return path.join(os.homedir(), '.config', 'magpie-teleagent', 'account.json')
}

export function loadAccount(file = defaultAccountFile()) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!j || !j.token) return null
    return j
  } catch {
    return null
  }
}

export function saveAccount(obj, file = defaultAccountFile()) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), { mode: 0o600 })
  return file
}

async function getJSON(p, token, signal, timeoutMs = 15000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  const onAbort = () => ac.abort()
  if (signal) signal.addEventListener('abort', onAbort, { once: true })
  try {
    const r = await fetch(GATEWAY + p, {
      headers: { 'X-Token': token, Accept: 'application/json' },
      signal: ac.signal,
    })
    const text = await r.text()
    if (!r.ok) throw new Error(`HTTP ${r.status} ${text.slice(0, 120)}`)
    return JSON.parse(text)
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** 拉取积分 / 套餐 / 权益明细 */
export async function fetchCredits(acc, { signal } = {}) {
  if (!acc?.token) throw new Error('没有 token')
  const [info, pts, center] = await Promise.all([
    getJSON(P_INFO, acc.token, signal).catch(() => null),
    getJSON(P_POINTS, acc.token, signal),
    getJSON(P_CENTER, acc.token, signal).catch(() => null),
  ])
  const activities = []
  for (const g of (pts?.data?.groups || [])) {
    for (const x of (g.active || [])) {
      const push = (it) => activities.push({
        group: g.typeName || g.type || '',
        name: it.name || '',
        status: it.statusName || it.status || '',
        total: it.totalQuota ?? null,
        used: it.usedQuota ?? null,
        remaining: it.balance ?? null,
        usedRate: it.usedRate ?? null,
        start: it.effectiveStart || null,
        end: it.effectiveEnd || null,
      })
      push(x)
      for (const sub of (x.subItems || [])) push(sub)
    }
  }
  return {
    account: {
      id: info?.data?.accountId || acc.accountId || null,
      name: info?.data?.accountName || acc.accountName || null,
      phone: info?.data?.phone || acc.phone || null,
    },
    points: pts?.data?.pointsBalance ?? null,
    userRole: pts?.data?.userRole ?? null,
    plan: center?.data?.plan_display_name ?? null,
    maxConcurrentTasks: center?.data?.max_concurrent_tasks ?? null,
    activities,
  }
}

/** 积分 → magpie auth.usage 的结构 */
export function usageFromCredits(c) {
  const windows = []
  const seen = new Set()
  for (const a of c.activities || []) {
    if (!a.name) continue
    if (seen.has(a.name)) continue
    seen.add(a.name)
    const total = num(a.total)
    const remaining = num(a.remaining)
    if (total <= 0) {
      windows.push({ name: a.name, balance: remaining, unit: '积分' })
      continue
    }
    windows.push({
      name: a.name,
      used: Math.min(100, Math.round(((total - remaining) / total) * 10000) / 100),
      amount: num(a.used),
      limit: total,
      unit: '积分',
      resetsAt: a.end || undefined,
    })
  }
  // 总积分余额单独一条 balance 窗口，magpie 可据此算单次请求的积分差值
  if (c.points != null) {
    windows.unshift({ name: '积分总余额', balance: num(c.points), unit: '积分' })
  }
  return {
    plan: c.plan || undefined,
    user: c.account?.name || undefined,
    signIn: 'kept',
    windows,
  }
}

// ---- 多账号存储 ----------------------------------------------------------
// 每个账号一个文件：~/.config/magpie-teleagent/accounts/<accountId>.json
// 早期的单文件 account.json 只作为迁移来源。

export function accountsDir() {
  return path.join(os.homedir(), '.config', 'magpie-teleagent', 'accounts')
}

export function accountFileFor(id) {
  const safe = String(id || 'default').replace(/[^\w.-]/g, '_')
  return path.join(accountsDir(), safe + '.json')
}

export function loadAccountById(id) {
  try {
    return JSON.parse(fs.readFileSync(accountFileFor(id), 'utf8'))
  } catch {
    return null
  }
}

export function saveAccountById(id, obj) {
  const f = accountFileFor(id)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify(obj, null, 2), { mode: 0o600 })
  return f
}

export function listAccountIds() {
  try {
    return fs.readdirSync(accountsDir())
      .filter((f) => f.endsWith('.json') && !f.endsWith('.checkin.json'))
      .map((f) => f.slice(0, -5))
  } catch {
    return []
  }
}

/** 把老的 account.json 迁进 accounts/<accountId>.json，返回 id（无则 null） */
export function migrateLegacyAccount(file = defaultAccountFile()) {
  const legacy = loadAccount(file)
  if (!legacy) return null
  const id = legacy.accountId || legacy.accountName || legacy.deviceId || 'default'
  if (!loadAccountById(id)) saveAccountById(id, legacy)
  return id
}

export function checkinStateFileFor(id) {
  return accountFileFor(id).replace(/\.json$/, '.checkin.json')
}
