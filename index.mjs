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
  fetchCredits, usageFromCredits,
} from './lib/account.mjs'
import { LOGIN_URL, PORTAL_URL, INSTRUCTIONS, extractToken } from './lib/web-login.mjs'
import { checkIn } from './lib/checkin.mjs'
import { withUsageChunk, normalizeUsage } from './lib/stream-usage.mjs'

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

  function makeFetch() {
    return async function teleagentFetch(input, init = {}) {
      const bodyText = typeof init.body === 'string' ? init.body : ''
      let body = {}
      try { body = JSON.parse(bodyText || '{}') } catch { body = {} }

      const acc = loadAccount(accountFile)
      if (!acc?.token) {
        return jsonResponse({ error: { message: '未登录 TeleAgent：请在 magpie 里添加账号', type: 'auth_error' } }, 401)
      }
      // 每次真正发请求时顺带跑一次自动签到（内部 6 小时节流，失败不影响对话）
      if (opts.autoCheckIn !== false) {
        try { await checkIn(acc, { stateFile: accountFile + '.checkin.json' }) } catch {}
      }

      const gwBody = openaiToGateway(body)
      const model = body.model
      const wantStream = body.stream === true
      gwBody.stream = wantStream

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
        up = await fetch(BASE + '/chat/completions', { method: 'POST', headers, body: payload, signal: init.signal })
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
      return jsonResponse(out)
    }
  }

  /** 校验一个 token 是否可用，并把它写成账号 */
  async function adoptToken(token, mode) {
    const channelKey = opts.channelKey || DEFAULT_CHANNEL_KEY
    const prev = loadAccount(accountFile)
    const acc = {
      token,
      channelKey,
      // 同账号重复登录保留原 device/install id，避免服务端把设备看成新的
      deviceId: prev?.deviceId || randomUUID(),
      installId: prev?.installId || randomUUID(),
    }
    const c = await fetchCredits(acc)
    acc.accountId = c.account?.id || null
    acc.accountName = c.account?.name || null
    acc.phone = c.account?.phone || null
    saveAccount(acc, accountFile)
    return {
      type: 'success',
      key: acc.accountId || 'teleagent-local',
      metadata: { mode, account: acc.accountName || '', plan: c.plan || '', points: c.points ?? null },
    }
  }

  return {
    config: async (cfg) => {
      cfg.provider ??= {}
      cfg.provider[PROVIDER] ??= {
        name: 'TeleAgent',
        npm: '@ai-sdk/openai-compatible',
        api: BASE,
        icon: ICON,
        models: {},
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
              return {
                type: 'success',
                key: c.account?.id || acc.accountId || 'teleagent-local',
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
        if (!auth?.key) return {}
        return { baseURL: BASE, apiKey: 'teleagent-local', fetch: makeFetch() }
      },

      async usage(getAuth, _provider, ctx) {
        const acc = loadAccount(accountFile)
        if (!acc?.token) return { error: '未登录 TeleAgent 账号', signIn: 'expired' }
        let checkin = null
        if (opts.autoCheckIn !== false) {
          try { checkin = await checkIn(acc, { stateFile: accountFile + '.checkin.json', signal: ctx?.signal }) } catch {}
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
        const context = Number(opts.contextWindow) > 0 ? Number(opts.contextWindow) : 131072
        const output = Number(opts.maxOutputTokens) > 0 ? Number(opts.maxOutputTokens) : 131072
        const out = {}
        for (const id of MODELS) out[id] = { limit: { context, output } }
        return out
      },
    },
  }
}

export const _internal = { PROVIDER, BASE, MODELS, PORTAL_URL, extractToken }
