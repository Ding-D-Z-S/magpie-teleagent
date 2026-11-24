/**
 * magpie-teleagent — 把 TeleAgent（星辰超级智能体）账号接成 magpie provider。
 *
 * 直接签名调用 TeleAgent 云网关并把结果翻译回 OpenAI Chat Completions，
 * 不需要 teleagent-proxy 那种独立反代进程。
 *
 * 两种登录方式：
 *   1. 网页登录（浏览器授权）—— 打开门户登录页，登录后粘贴 operationToken；
 *      插件校验积分后写入 account.json（channelKey 已内置）。
 *   2. 本地账号 —— 直接读已有的 ~/.config/magpie-teleagent/account.json
 *      （含 token + channelKey + deviceId + installId）。
 *
 * 额度：auth.usage 调 /meter/super-agent/user/portal/points/detail 显示积分。
 */
import { randomUUID } from 'node:crypto'
import { buildHeaders } from './lib/signer.mjs'
import { MODELS, openaiToGateway, gatewayToOpenai, extractError } from './lib/api.mjs'
import {
  BASE, CHAT_PATH, defaultAccountFile, loadAccount, saveAccount,
  loadAccountById, saveAccountById, migrateLegacyAccount, checkinStateFileFor, listAccountIds,
  fetchCredits, usageFromCredits,
} from './lib/account.mjs'
import { LOGIN_URL, PORTAL_URL, INSTRUCTIONS, extractToken } from './lib/web-login.mjs'
import { checkIn } from './lib/checkin.mjs'
import { withUsageChunk, normalizeUsage, setPointsRate } from './lib/stream-usage.mjs'

const PROVIDER = 'teleagent'
const ICON = 'https://agent.teleai.com.cn/meter/teleagent/user/portal/assets/logo-mark-BHRWrah4.png'

/** 所有 TeleAgent 客户端共用的渠道密钥（从 app.asar 提取） */
const DEFAULT_CHANNEL_KEY = 'sk-qvp4m6h9g20uM6PgYP7E'

const jsonResponse = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })

export const TeleagentAuthPlugin = async (_input, options) => {
  const opts = options && typeof options === 'object' ? options : {}
  const appVersion = opts.appVersion || '3.1.0'
  const accountFile = opts.accountFile || defaultAccountFile()
  setPointsRate(opts.pointsRate)
  // 老的单文件账号自动迁进多账号目录（只迁一次）
  try { migrateLegacyAccount(accountFile) } catch {}

  function makeFetch(acc) {
    return async function teleagentFetch(input, init = {}) {
      const bodyText = typeof init.body === 'string' ? init.body : ''
      let body = {}
      try { body = JSON.parse(bodyText || '{}') } catch { body = {} }

      if (!acc?.token) {
        return jsonResponse({ error: { message: '未登录 TeleAgent：请在 magpie 里添加账号', type: 'auth_error' } }, 401)
      }
      // 每次真正发请求时顺带跑一次自动签到（内部 6 小时节流，失败不影响对话）
      if (opts.autoCheckIn !== false) {
        // 不等待，避免签到拖慢对话（内部有 6 小时节流）
        checkIn(acc, { stateFile: checkinStateFileFor(acc.accountId || acc.accountName) }).catch(() => {})
      }

      const gwBody = openaiToGateway(body)
      const model = body.model
      const wantStream = body.stream === true
      if (gwBody.max_tokens == null && gwBody.max_completion_tokens == null) gwBody.max_tokens = Number(opts.maxOutputTokens) > 0 ? Number(opts.maxOutputTokens) : 131072
      gwBody.stream = wantStream
      if (wantStream) gwBody.stream_options = { include_usage: true }

      const payload = JSON.stringify(gwBody)
      const headers = buildHeaders({
        token: acc.token,
        channelKey: acc.channelKey || opts.channelKey || DEFAULT_CHANNEL_KEY,
        deviceId: acc.deviceId,
        installId: acc.installId,
        appVersion,
        method: 'POST',
        path: CHAT_PATH,
        body: payload,
      })
      headers.Accept = wantStream ? 'text/event-stream' : 'application/json'

      let up
      try {
        up = await fetch(BASE + '/chat/completions', { method: 'POST', headers, body: payload, signal: init.signal || AbortSignal.timeout(600000) })
      } catch (e) {
        return jsonResponse({ error: { message: '连接 TeleAgent 网关失败: ' + String(e?.message ?? e).slice(0, 200), type: 'upstream_error' } }, 502)
      }

      if (!up.ok) {
        const text = await up.text().catch(() => '')
        const err = extractError(text, up.status)
        return jsonResponse({ error: { message: String(err.message || text).slice(0, 400), code: err.code, type: 'upstream_error' } }, up.status === 401 ? 401 : 502)
      }

      if (wantStream) {
        return new Response(withUsageChunk(up.body, model), {
          status: 200,
          headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' },
        })
      }

      const j = await up.json().catch(() => null)
      if (!j) return jsonResponse({ error: { message: '网关返回了非 JSON 响应', type: 'upstream_error' } }, 502)
      if (j.error || (j.code && j.code !== 200)) {
        const err = extractError(JSON.stringify(j), 502)
        return jsonResponse({ error: { message: String(err.message || '').slice(0, 400), type: 'upstream_error' } }, 502)
      }
      const out = gatewayToOpenai(j, model)
      out.usage = normalizeUsage(out.usage)
      if (out.usage) out.credits = out.usage.credits
      return jsonResponse(out)
    }
  }

  /** 校验一个 token 是否可用，并按 accountId 存成独立账号文件 */
  async function adoptToken(token, mode) {
    const channelKey = opts.channelKey || DEFAULT_CHANNEL_KEY
    const probe = { token, channelKey, deviceId: randomUUID(), installId: randomUUID() }
    const c = await fetchCredits(probe)
    const id = c.account?.id || 'teleagent-local'
    const prev = loadAccountById(id) || {}
    const acc = {
      token,
      channelKey,
      // 同账号重复登录保留原 device/install id，避免服务端把设备看成新的
      deviceId: prev.deviceId || probe.deviceId,
      installId: prev.installId || probe.installId,
      accountId: id,
      accountName: c.account?.name || null,
      phone: c.account?.phone || null,
    }
    saveAccountById(id, acc)
    return {
      type: 'success',
      key: id,
      metadata: { mode, account: acc.accountName || '', plan: c.plan || '', points: c.points ?? null },
    }
  }

  /** 按 magpie 给的 auth.key 找对应账号（多账号互不覆盖） */
  function resolveAccount(auth) {
    const raw = auth?.key != null ? String(auth.key) : ''
    const candidates = []
    if (raw) {
      candidates.push(raw)
      const noHash = raw.split('#')[0]
      if (noHash && noHash !== raw) candidates.push(noHash)
    }
    for (const id of candidates) {
      const a = loadAccountById(id)
      if (a?.token) return a
    }
    // 兼容：按 metadata.account（账号名/手机号）匹配
    const name = auth?.metadata?.account
    if (name) {
      for (const id of listAccountIds()) {
        const a = loadAccountById(id)
        if (a?.token && (a.accountName === name || a.phone === name || a.accountId === name)) return a
      }
    }
    // 只有一个账号时直接用（老版本单账号场景）
    const ids = listAccountIds()
    if (ids.length === 1) {
      const only = loadAccountById(ids[0])
      if (only?.token) return only
    }
    const legacy = loadAccount(accountFile)
    if (legacy?.token && (!raw || legacy.accountId === raw || ids.length === 0)) return legacy
    return null
  }

  return {
    config: async (cfg) => {
      cfg.provider ??= {}
      cfg.provider[PROVIDER] = {
        ...(cfg.provider[PROVIDER] || {}),
        name: 'TeleAgent',
        npm: '@ai-sdk/openai-compatible',
        api: BASE,
        icon: ICON,
        models: cfg.provider[PROVIDER]?.models || {},
      }
    },

    auth: {
      provider: PROVIDER,
      maxConcurrency: 1,
      methods: [
        {
          type: 'oauth',
          label: '网页登录（浏览器授权）',
          labels: {
            zh: '网页登录（浏览器授权）',
            'zh-TW': '網頁登錄（瀏覽器授權）',
            en: 'Web sign-in (browser)',
          },
          authorize: async () => ({
            url: LOGIN_URL,
            method: 'code',
            opened: true,
            instructions: INSTRUCTIONS,
            callback: async (code) => {
              const token = extractToken(code)
              if (!token) {
                return { type: 'failed', error: '没识别出 operationToken：请复制 cookies 里 operationToken 的完整值（形如 xxxx:eyJ…）' }
              }
              try {
                return await adoptToken(token, 'web')
              } catch (e) {
                return { type: 'failed', error: '登录校验失败：' + String(e?.message ?? e).slice(0, 200) }
              }
            },
          }),
        },
        {
          type: 'api',
          keyless: true,
          label: '本地账号（读 account.json）',
          labels: {
            zh: '本地账号（读 account.json）',
            'zh-TW': '本機帳號（讀 account.json）',
            en: 'Local account (account.json)',
          },
          authorize: async () => {
            const acc = loadAccount(accountFile)
            if (!acc?.token) {
              return { type: 'failed', error: `没找到账号文件 ${accountFile}` }
            }
            try {
              const c = await fetchCredits(acc)
              const id = c.account?.id || acc.accountId || 'teleagent-local'
              // 迁进多账号目录，后续按 key 读取，互不覆盖
              saveAccountById(id, {
                ...acc,
                accountId: id,
                accountName: c.account?.name || acc.accountName || null,
                phone: c.account?.phone || acc.phone || null,
              })
              return {
                type: 'success',
                key: id,
                metadata: { mode: 'local', account: c.account?.name || acc.accountName || '', points: c.points ?? null },
              }
            } catch (e) {
              return { type: 'failed', error: '账号校验失败：' + String(e?.message ?? e).slice(0, 200) }
            }
          },
        },
      ],

      async loader(getAuth) {
        const auth = await getAuth()
        const acc = resolveAccount(auth)
        if (!acc?.token) return {}
        return { baseURL: BASE, apiKey: 'teleagent-local', fetch: makeFetch(acc) }
      },

      async usage(getAuth, _provider, ctx) {
        const acc = resolveAccount(await getAuth())
        if (!acc?.token) return { error: '未登录 TeleAgent 账号', signIn: 'expired' }
        let checkin = null
        if (opts.autoCheckIn !== false) {
          try { checkin = await checkIn(acc, { stateFile: checkinStateFileFor(acc.accountId || acc.accountName), signal: ctx?.signal }) } catch {}
        }
        try {
          const c = await fetchCredits(acc, { signal: ctx?.signal })
          return usageFromCredits(c)
        } catch (e) {
          return { error: '积分查询失败：' + String(e?.message ?? e).slice(0, 200) }
        }
      },
    },

    provider: {
      id: PROVIDER,
      async models(provider, { auth } = {}) {
        if (auth?.type !== 'api' || !auth.key) return provider.models
        const context = Number(opts.contextWindow) > 0 ? Number(opts.contextWindow) : 1048576
        const output = Number(opts.maxOutputTokens) > 0 ? Number(opts.maxOutputTokens) : 131072
        const out = {}
        for (const id of MODELS) out[id] = { limit: { context, output } }
        return out
      },
    },
  }
}

export const _internal = { PROVIDER, BASE, MODELS, PORTAL_URL, extractToken }
