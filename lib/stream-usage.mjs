/**
 * lib/stream-usage.mjs — 流式响应里的 usage 规整
 *
 * TeleAgent 网关把 usage 塞在**最后一个带 choices 的 chunk** 里：
 *   data: {"choices":[{"delta":{"content":"…"},"finish_reason":"stop"}],"usage":{…}}
 *
 * 而 OpenAI 语义要求 usage 单独一个 chunk（`choices: []`），magpie 也是按这个
 * 规范统计 in/out/cache 的——否则面板里 token 数、速度、缓存全是空的。
 *
 * 这个 TransformStream 做两件事：
 *   1. 把带 usage 的 chunk 拆成「内容 chunk（去掉 usage）」+「usage chunk（choices:[]）」
 *   2. 顺手补上 prompt_tokens_details（网关不给时补 0），让缓存字段有值
 */
export function withUsageChunk(stream, fallbackModel = '') {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buf = ''

  return new ReadableStream({
    async start(controller) {
      const reader = stream.getReader()
      const emit = (s) => controller.enqueue(encoder.encode(s))
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let idx
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, idx + 2)
            buf = buf.slice(idx + 2)
            emit(handleBlock(block, emit, fallbackModel))
          }
        }
        if (buf) emit(handleBlock(buf, emit, fallbackModel))
        controller.close()
      } catch (e) {
        controller.error(e)
      }
    },
  })
}

function handleBlock(block, emit, fallbackModel) {
  const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
  if (!dataLine) return block
  const payload = dataLine.slice(5).trim()
  if (!payload || payload === '[DONE]') return block

  let json
  try { json = JSON.parse(payload) } catch { return block }

  if (!json.usage) return block

  const usage = { ...json.usage }
  if (!usage.prompt_tokens_details) {
    usage.prompt_tokens_details = { cached_tokens: 0, cache_write_tokens: 0 }
  }
  delete json.usage
  const head = 'data: ' + JSON.stringify(json) + '\n\n'
  const usageChunk = {
    id: json.id || 'chatcmpl-' + Date.now().toString(36),
    object: 'chat.completion.chunk',
    created: json.created || Math.floor(Date.now() / 1000),
    model: json.model || fallbackModel,
    choices: [],
    usage,
  }
  return head + 'data: ' + JSON.stringify(usageChunk) + '\n\n'
}

/**
 * 补齐 usage 的 OpenAI 标准字段。
 * 网关对不同模型返回的结构不一样：chat-pro/chat-lite 只给
 * `reasoning_tokens`，没有 completion_tokens_details / prompt_tokens_details，
 * magpie 解析不到就会把 in/out 记成 0。
 */
export function normalizeUsage(u) {
  if (!u || typeof u !== 'object') return u
  const out = { ...u }
  if (!out.prompt_tokens_details) out.prompt_tokens_details = { cached_tokens: 0, cache_write_tokens: 0 }
  if (!out.completion_tokens_details) {
    out.completion_tokens_details = { reasoning_tokens: Number(out.reasoning_tokens) || 0 }
  }
  if (out.reasoning_tokens != null) delete out.reasoning_tokens
  return out
}
