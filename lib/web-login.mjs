/**
 * lib/web-login.mjs — 网页登录（浏览器授权）支持
 *
 * TeleAgent 的门户登录走 UPMS SSO，登录成功后服务端把会话写进 cookie
 * `operationToken`。实测它与客户端 token.json 里的 token 等价：都能作为
 * 签名请求的 X-Token（chat 与 /meter/* 都返回 200）。
 *
 * 所以网页登录的落地方式是：打开门户登录页 → 用户登录 → 复制 operationToken
 * → 插件拿它做一次积分校验 → 写入 account.json。
 */
export const PORTAL_URL = 'https://agent.teleai.com.cn/meter/teleagent/user/portal/star-bill'

export const LOGIN_URL =
  'https://agent.teleai.com.cn/meter/teleagent-login/login?redirect_url=' +
  encodeURIComponent(PORTAL_URL)

/**
 * 从用户粘贴的内容里取出 token。宽容地接受：
 *   - 裸 token（JWT，或 `xxxx:JWT`）
 *   - `operationToken=…` 这样的 cookie 片段
 *   - 整段 document.cookie
 */
export function extractToken(text) {
  let s = String(text || '').trim()
  if (!s) return ''

  const cookieMatch = /operationToken=([^;,\s]+)/i.exec(s)
  if (cookieMatch) s = safeDecode(cookieMatch[1])

  // 去掉包裹的引号 / 反引号
  s = s.replace(/^["'`]+|["'`]+$/g, '').trim()

  // 1) 标准 JWT（base64url，两段点）
  const jwt = /(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,})/.exec(s)
  if (jwt) return jwt[1]

  // 2) `xxxx:JWT…` 形式
  const prefixed = /([A-Za-z0-9_-]{2,}:eyJ[A-Za-z0-9_.-]{20,})/.exec(s)
  if (prefixed) return prefixed[1]

  // 3) 其他长串：无空白、长度足够，就当成 token
  const compact = s.split(/\s+/).find((w) => w.length >= 60)
  if (compact) return compact.replace(/^["'`]+|["'`]+$/g, '')

  return ''
}

function safeDecode(v) {
  try { return decodeURIComponent(v) } catch { return v }
}

export const INSTRUCTIONS =
  '在打开的页面完成 TeleAgent 登录，成功后停在「我的积分」页。' +
  '然后按 F12 → Application（应用）→ Cookies → https://agent.teleai.com.cn ，' +
  '复制 operationToken 的值粘贴到下面；也可以在控制台执行 ' +
  "copy(document.cookie.match(/operationToken=([^;]+)/)[1]) 直接复制。"
