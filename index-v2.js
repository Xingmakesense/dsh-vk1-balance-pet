import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

// ============================================================================
// dsh-vk1-balance-pet —— Host half
//
// 桌宠「大肥鱼」的 DSH 网页插件版。角色、平板余额、掉饭盆、铁盆、四表情都在
// widget.js 里用 DOM/CSS 实现；宿主侧只做四件事：
//   1. 静态素材 + widget.js 路由（同源、无 CORS 通配）
//   2. 余额：**官方账号路优先**（ctx.get('deepseekAccount')），API key 只作兜底
//      —— 不做任何 API key 输入界面，密钥由 DSH 自己管理
//   3. 页面注入：tapIndex（Web 形态）+ webserver/index-inject（桌面端唯一通道）
//   4. 无更新检查、无出网请求：除余额接口外不联任何域
// ============================================================================

const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url))
const ASSETS = path.join(PACKAGE_ROOT, 'assets')
const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const BALANCE_TTL_MS = 8000
const ACCOUNT_TIMEOUT_MS = 5000
// 本插件**独占**的路径命名空间：只属于 dsh-vk1-balance-pet，不和任何其它插件共享。
const NS = '/dsh-vk1-balance-pet'
// 旧前缀只作为「已加载页面」的过渡别名（缓存里的 widget.js 可能还在请求它），
// 不用于新代码；数据接口不提供旧别名，避免双写。
const LEGACY_NS = '/dsh-vk1'
const WIDGET_PATH = NS + '/widget.js'
const VERSION = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

// ============================================================================
// 每轮消耗（turn cost）—— 与 dsh-whale-widget 同一口径
//   · assistant/message 携带真实 usage，按 (session, turn) 聚合 token
//   · turn/end 结算该轮：token × 单价 → 人民币，写进 lastTurn
//   · 客户端轮询 /dsh-vk1/last-turn.json：seq 变了才播「任务结束音」+ 弹本轮消耗气泡
// 只按**平价**计费（本插件不做峰谷：峰谷显示已按需求移除）。
// ============================================================================
const PRICE_FLASH = { hit: 0.02, miss: 1, out: 4 }
const PRICE_PRO = { hit: 0.15, miss: 4.5, out: 13.5 }
const PRICING = {
  'deepseek-v4-pro': PRICE_PRO,
  'deepseek-v4-flash': PRICE_FLASH,
  'deepseek-flash': PRICE_FLASH,
  _default: PRICE_FLASH,
}
function priceFor(model) {
  const m = String(model || '').toLowerCase()
  for (const key of Object.keys(PRICING)) {
    if (key === '_default') continue
    if (m.indexOf(key) !== -1) return PRICING[key]
  }
  return PRICING._default
}
// 按百万 token 计价的金额，最多 6 位小数
function costOf(usage, model) {
  const p = priceFor(model)
  const input = Number(usage.inputTokens) || 0
  const cache = Number(usage.cacheReadTokens) || 0
  const output = Number(usage.outputTokens) || 0
  const yuan = (cache / 1e6) * p.hit + (input / 1e6) * p.miss + (output / 1e6) * p.out
  return Math.round(yuan * 1e6) / 1e6
}

// ── 资源声明表（唯一来源）────────────────────────────────────────────
// key = 对外文件名（<NS>/<name>），value = 磁盘文件名 + MIME。
// 新增素材只改这一张表；/resources.json 也直接由它生成，不会两边漂移。
const RESOURCES = {
  'expression_11.png': ['expression_11.png', 'image/png'],
  'expression_12.png': ['expression_12.png', 'image/png'],
  'expression_21.png': ['expression_21.png', 'image/png'],
  'expression_22.png': ['expression_22.png', 'image/png'],
  'rice.png': ['rice.png', 'image/png'],
  'iron_bowl.png': ['iron_bowl.png', 'image/png'],
  'hit.mp3': ['hit.mp3', 'audio/mpeg'],
  'feed.mp3': ['feed.mp3', 'audio/mpeg'],
  'pot_land.mp3': ['pot_land.mp3', 'audio/mpeg'],
  'pot_off.mp3': ['pot_off.mp3', 'audio/mpeg'],
  'duck_press.mp3': ['duck_press.mp3', 'audio/mpeg'],
  'duck_release.mp3': ['duck_release.mp3', 'audio/mpeg'],
  'orb.wav': ['orb.wav', 'audio/wav'],
  'cost.wav': ['cost.wav', 'audio/wav'],
  'task_end.wav': ['task_end.wav', 'audio/wav'],
  'fx1_press.mp3': ['fx1_press.mp3', 'audio/mpeg'],
  'fx1_release.mp3': ['fx1_release.mp3', 'audio/mpeg'],
  'rua.gif': ['rua.gif', 'image/gif'],
  'bubble_petpet.gif': ['bubble_petpet.gif', 'image/gif'],
  'bubble_money.gif': ['bubble_money.gif', 'image/gif'],
  'skin_dsniang1.png': ['skin_dsniang1.png', 'image/png'],
}
for (let i = 0; i < 5; i++) RESOURCES['pat_hand_' + i + '.png'] = ['pat_hand_' + i + '.png', 'image/png']
// 兼容旧变量名（外部只读，不用于注册路由）
const ASSET_ROUTES = RESOURCES

// 桌面端（Electron）结构化注入行：必须是**内联** script 行。桌面壳从静态 dist 直出，
// tapIndex 永远不生效；而 `script-src` 行在加载失败时会 reject 掉 __DSH_BOOT_READY__，
// 把整个应用拖死。内联行自己建 <script src> 并吞掉 onerror，路由不在时静默失败。
const DESKTOP_ROW_TEXT =
  '(function(){try{var d=document.body||document.head||document.documentElement;if(!d)return;' +
  'var s=document.createElement("script");s.src="' + WIDGET_PATH + '";' +
  's.onerror=function(){};d.appendChild(s)}catch(e){}})()'

const name = 'dsh-vk1-balance-pet'

function apply(root) {
  // ① 注入行先注册：桌面端注入表是宿主启动时一次性收集的，订阅晚于收集就永远进不了表。
  root.effect(() => () => {})
  const rows = []
  rows.push(root.on('webserver/index-inject', (table) => {
    try {
      if (!Array.isArray(table)) return
      for (const row of table) {
        if (!row) continue
        if (row.kind === 'script-src' && String(row.src || '').indexOf(WIDGET_PATH) >= 0) return
        if (row.kind === 'script' && typeof row.text === 'string' && row.text.indexOf(WIDGET_PATH) >= 0) return
      }
      table.push({ kind: 'script', placement: 'body', text: DESKTOP_ROW_TEXT })
    } catch (err) {}
  }))
  root.effect(() => () => { for (const d of rows) { try { d() } catch (err) {} } })

  // ② 路由与余额：等 webServer / credentials 就绪。
  root.inject(['webServer', 'credentials'], (ctx) => {
    const disposers = []
    const assetCache = new Map()
    let widgetSource = null
    let widgetMtime = 0
    let balanceCache = null
    let balanceInFlight = null

    function readWidget() {
      // 按修改时间缓存：改 widget.js 后刷新页面即可生效，不必重启 DSH。
      const file = path.join(PACKAGE_ROOT, 'widget.js')
      try {
        const st = fs.statSync(file)
        if (widgetSource === null || st.mtimeMs !== widgetMtime) {
          widgetSource = fs.readFileSync(file, 'utf8')
          widgetMtime = st.mtimeMs
        }
      } catch (err) {
        if (widgetSource === null) throw err
      }
      return widgetSource
    }
    function readAsset(file) {
      if (!assetCache.has(file)) assetCache.set(file, fs.readFileSync(path.join(ASSETS, file)))
      return assetCache.get(file)
    }

    let turnAggs = new Map()   // sessionId -> { turn, cost, tokens, lastTs }
    // 任务是否在跑：任一会话收到 assistant/message 就置忙，turn/end 后置闲。
    // （用户要的就是「只有任务进行中才按步长扣血，空闲时间不触发」）
    let busySessions = new Set()
    let lastBusyTs = 0
    let lastTurn = null
    let lastTurnSeq = 0
    function finalizeTurn(sessionId) {
      busySessions.delete(String(sessionId || ''))
      const agg = turnAggs.get(sessionId)
      if (agg && (agg.cost > 0 || agg.tokens > 0)) {
        lastTurn = { turn: agg.turn, amount: agg.cost, tokens: agg.tokens, ts: agg.lastTs }
        lastTurnSeq++
      }
      turnAggs.delete(sessionId)
    }
    function handleSessionEvent(sessionId, event) {
      try {
        const type = event && event.type
        const d = event && event.data
        if (!d || typeof d !== 'object') return
        if (type === 'turn/end') { finalizeTurn(sessionId); return }
        if (type !== 'assistant/message') return
        // 任何一步 assistant 输出都算「任务进行中」
        busySessions.add(String(sessionId || ''))
        lastBusyTs = Date.now()
        const turn = Number(d.turn)
        const usage = d.usage
        if (!usage || !isFinite(turn)) return
        let agg = turnAggs.get(sessionId)
        if (!agg || agg.turn !== turn) {
          if (agg) finalizeTurn(sessionId)
          agg = { turn, cost: 0, tokens: 0, lastTs: Date.now() }
          turnAggs.set(sessionId, agg)
        }
        const model = d.message && d.message.source ? d.message.source.model : ''
        const input = Number(usage.inputTokens) || 0
        const cache = Number(usage.cacheReadTokens) || 0
        const output = Number(usage.outputTokens) || 0
        agg.tokens += input + cache + output
        agg.cost += costOf(usage, model)
        agg.lastTs = Date.now()
      } catch (err) {}
    }
    try {
      if (typeof ctx.on === 'function') {
        // 签名与 dsh-whale-widget 一致：ctx.on('session/event', (session, event) => …)
        disposers.push(ctx.on('session/event', (session, event) => {
          const sid = session && session.id ? String(session.id) : 'default'
          handleSessionEvent(sid, event)
        }))
        // 会话销毁时清掉残留聚合，避免内存泄漏
        disposers.push(ctx.on('session/disposed', (session) => {
          if (session && session.id) turnAggs.delete(String(session.id))
        }))
      }
    } catch (err) {}

    function accountService() {
      try { return typeof ctx.get === 'function' ? ctx.get('deepseekAccount') : null } catch (err) { return null }
    }
    function pickBalanceInfo(infos) {
      if (!Array.isArray(infos) || infos.length === 0) return null
      const num = (x) => (x && x.total_balance !== undefined ? Number(x.total_balance) : NaN)
      return infos.find((x) => x && x.currency === 'CNY' && num(x) > 0)
        || infos.find((x) => num(x) > 0)
        || infos.find((x) => x && x.currency === 'CNY')
        || infos[0]
    }

    // —— 官方账号路（主路）——
    // 钱包分 normal_wallets（充值，result.value）与 bonus_wallets（赠金，result.bonusWallets），
    // 与 DSH 自己的「账号与余额」卡片同口径合计；只有赠金也算成功。
    let accountDiag = ''
    async function fetchAccountBalance() {
      accountDiag = ''
      const account = accountService()
      if (!account || typeof account.getBalance !== 'function') { accountDiag = '当前 DSH 没有账号服务'; return null }
      let result
      try {
        result = await Promise.race([
          account.getBalance({
            version: String(process.env.DSH_CLIENT_VERSION || process.env.DSH_VERSION || '') || 'unknown',
            locale: String(process.env.DSH_LOCALE || '') || 'zh_CN',
            timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
          }),
          new Promise((resolve) => setTimeout(() => resolve(null), ACCOUNT_TIMEOUT_MS)),
        ])
      } catch (err) {
        accountDiag = '账号余额接口调用失败: ' + String((err && err.message) || err).slice(0, 120)
        return null
      }
      if (!result) { accountDiag = '账号余额接口无响应或未登录'; return null }
      if (result.status && result.status !== 'ready') { accountDiag = '账号余额未就绪（' + String(result.status) + '）'; return null }
      const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
      const list = (raw) => (Array.isArray(raw) ? raw : []).filter((w) => w && num(w.balance) !== null)
      const normal = list(result.value)
      const bonus = list(result.bonusWallets)
      const all = normal.concat(bonus)
      if (all.length === 0) { accountDiag = '账号没有可用的余额钱包'; return null }
      const curOf = (w) => String((w && w.currency) || 'CNY').toUpperCase()
      const nonzero = all.filter((w) => Number(w.balance) > 0)
      const pick = nonzero.find((w) => curOf(w) === 'CNY') || nonzero[0]
        || all.find((w) => curOf(w) === 'CNY') || all[0]
      const currency = curOf(pick)
      const sum = (arr) => arr.filter((w) => curOf(w) === currency).reduce((s, w) => s + Number(w.balance), 0)
      const recharge = sum(normal)
      const granted = sum(bonus)
      return {
        ok: true,
        totalBalance: Number((recharge + granted).toFixed(6)),
        rechargeBalance: Number(recharge.toFixed(6)),
        bonusBalance: Number(granted.toFixed(6)),
        currency,
        balanceSource: 'account',
        updatedAt: new Date().toISOString(),
      }
    }

    // —— API key 兜底（无 UI，只读 DSH 已有凭据）——
    async function fetchKeyBalance() {
      let cred
      try {
        cred = await ctx.credentials.resolve('DEEPSEEK_API_KEY')
      } catch (err) {
        return { ok: false, code: 'NO_KEY', error: '凭据读取失败: ' + String((err && err.message) || err).slice(0, 160) }
      }
      if (!cred || !cred.value) return { ok: false, code: 'NO_KEY', error: '未配置 DEEPSEEK_API_KEY' }
      let lastErr = null
      for (let attempt = 0; attempt < 2; attempt++) {
        let res
        try {
          res = await fetch(BALANCE_URL, {
            headers: { Authorization: 'Bearer ' + cred.value },
            signal: AbortSignal.timeout(8000),
          })
        } catch (err) {
          lastErr = err
          if (attempt === 0) await new Promise((r) => setTimeout(r, 500))
          continue
        }
        if (!res.ok) {
          lastErr = new Error('HTTP ' + res.status)
          if (res.status < 500) break
          if (attempt === 0) await new Promise((r) => setTimeout(r, 500))
          continue
        }
        let data
        try { data = await res.json() } catch (err) { return { ok: false, code: 'PARSE', error: '余额接口返回不是合法 JSON' } }
        const info = pickBalanceInfo(data && data.balance_infos)
        if (!info || info.total_balance === undefined) return { ok: false, code: 'SHAPE', error: '余额接口返回结构异常' }
        return {
          ok: true,
          totalBalance: Number(info.total_balance),
          rechargeBalance: info.topped_up_balance === undefined ? null : Number(info.topped_up_balance),
          bonusBalance: info.granted_balance === undefined ? null : Number(info.granted_balance),
          currency: String(info.currency || 'CNY'),
          balanceSource: 'apikey',
          updatedAt: new Date().toISOString(),
          serverTime: res.headers.get('date') || null,
        }
      }
      return {
        ok: false,
        code: 'HTTP',
        transient: !(lastErr && /^HTTP 4\d\d/.test(String(lastErr.message))),
        error: '余额接口请求失败: ' + String((lastErr && lastErr.message) || lastErr).slice(0, 200),
      }
    }

    async function fetchBalance() {
      const account = await fetchAccountBalance()
      if (account) return account
      const key = await fetchKeyBalance()
      if (key.ok) return key
      return {
        ok: false,
        code: key.code === 'NO_KEY' ? 'NO_CREDENTIAL' : 'BOTH_FAILED',
        error: '账号路：' + (accountDiag || '拿不到余额') + '；API key 路：' + String(key.error || key.code || '失败').slice(0, 160),
      }
    }

    function getBalance() {
      const now = Date.now()
      if (balanceCache && now - balanceCache.at < BALANCE_TTL_MS) return Promise.resolve(balanceCache.payload)
      if (balanceInFlight) return balanceInFlight
      balanceInFlight = fetchBalance()
        .then((payload) => {
          if (payload.ok) { balanceCache = { at: now, payload }; return payload }
          if (payload.transient && balanceCache) return { ...balanceCache.payload, stale: true, error: payload.error }
          return payload
        })
        .catch((err) => ({ ok: false, code: 'ERROR', error: '余额服务异常: ' + String((err && err.message) || err).slice(0, 200) }))
        .finally(() => { balanceInFlight = null })
      return balanceInFlight
    }

    // 资源：**每个文件一条 exact 路由**（外部接口保持 v2.3.0 的形态；
    // 文件名与 MIME 仍来自同一张 RESOURCES 表，新增素材只改表即可）。
    function registerResource(name, prefix) {
      const [file, type] = RESOURCES[name]
      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: prefix + '/' + name,
        handler: (req, res) => {
          try {
            const bytes = readAsset(file)
            res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': String(bytes.length) })
            res.end(bytes)
          } catch (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end(file + ' unavailable')
          }
        },
      }))
    }
    for (const name of Object.keys(RESOURCES)) {
      registerResource(name, NS)
      registerResource(name, LEGACY_NS)   // 过渡别名（已加载页面用）
    }
    // 余额：账号路优先、API key 兜底；恒 200，错误放在 body 里
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: NS + '/balance.json',
      handler: async (req, res) => {
        try {
          const payload = await getBalance()
          const stamp = Date.parse(payload.serverTime)
          const age = Math.max(0, Date.now() - Date.parse(payload.updatedAt))
          const body = payload.ok && Number.isFinite(stamp) && Number.isFinite(age)
            ? { ...payload, serverTime: new Date(stamp + age).toISOString(), version: VERSION }
            : { ...payload, version: VERSION }
          res.writeHead(200, JSON_HEADERS)
          res.end(JSON.stringify(body))
        } catch (err) {
          res.writeHead(200, JSON_HEADERS)
          res.end(JSON.stringify({ ok: false, code: 'ERROR', error: String((err && err.message) || err).slice(0, 200), version: VERSION }))
        }
      },
    }))

    // 默认配置：客户端把「当前生效的设置」POST 上来，落盘 defaults.json；
    // 新装（或清了 localStorage）时 GET 拿回这份作为初始值。
    const DEFAULTS_FILE = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'storages', 'dsh-vk1-balance-pet', 'defaults.json')
    // 随包的出厂默认（与插件同版本分发）；用户点过「存为默认」后被 DEFAULTS_FILE 覆盖
    const SHIPPED_DEFAULTS = path.join(PACKAGE_ROOT, 'defaults.json')
    function readDefaults() {
      try { return JSON.parse(fs.readFileSync(DEFAULTS_FILE, 'utf8')) } catch (err) {}
      try { return JSON.parse(fs.readFileSync(SHIPPED_DEFAULTS, 'utf8')) } catch (err) { return null }
    }
    function writeDefaults(body) {
      try {
        fs.mkdirSync(path.dirname(DEFAULTS_FILE), { recursive: true })
        const tmp = DEFAULTS_FILE + '.' + process.pid + '.tmp'
        fs.writeFileSync(tmp, JSON.stringify(body, null, 2) + '\n', 'utf8')
        fs.renameSync(tmp, DEFAULTS_FILE)
        return true
      } catch (err) { return false }
    }
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: NS + '/defaults.json',
      handler: async (req, res) => {
        if (req.method === 'GET' || req.method === 'HEAD') {
          res.writeHead(200, JSON_HEADERS)
          res.end(JSON.stringify({ ok: true, defaults: readDefaults() }))
          return
        }
        if (req.method !== 'POST') { res.writeHead(405, JSON_HEADERS); res.end('{}'); return }
        try {
          const chunks = []
          let size = 0
          for await (const chunk of req) {
            size += chunk.length
            if (size > 64 * 1024) { res.writeHead(413, JSON_HEADERS); res.end(JSON.stringify({ ok: false, error: 'payload too large' })); return }
            chunks.push(chunk)
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (!body || typeof body !== 'object') throw new Error('bad body')
          const ok = writeDefaults(body)
          res.writeHead(ok ? 200 : 500, JSON_HEADERS)
          res.end(JSON.stringify({ ok }))
        } catch (err) {
          res.writeHead(400, JSON_HEADERS)
          res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err) }))
        }
      },
    }))

    // 每轮消耗：客户端轮询这个接口，seq 递增即「刚结束一轮」
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: NS + '/last-turn.json',
      handler: (req, res) => {
        // busy = 有会话正在跑（或最近 15 秒内有输出，避免两轮之间的空隙把状态抖成闲置）
        const busy = busySessions.size > 0 || (Date.now() - lastBusyTs < 15000)
        const payload = lastTurn
          ? { ok: true, seq: lastTurnSeq, turn: lastTurn.turn, amount: lastTurn.amount, tokens: lastTurn.tokens, ts: lastTurn.ts, busy }
          : { ok: true, seq: 0, amount: 0, tokens: 0, ts: 0, busy }
        res.writeHead(200, JSON_HEADERS)
        res.end(JSON.stringify(payload))
      },
    }))

    // 资源管理：列出随包分发的素材与体积（只读，不发文件）
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: NS + '/resources.json',
      handler: (req, res) => {
        try {
          const provenance = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'asset-sources.json'), 'utf8'))
          const meta = new Map(provenance.assets.map((a) => [a.file, a]))
          // 清单以 RESOURCES（实际分发的唯一来源）为准；asset-sources 只补来源/尺寸元数据
          const items = Object.keys(RESOURCES).map((name) => {
            const [file, mime] = RESOURCES[name]
            const a = meta.get(file) || {}
            let bytes = a.bytes || 0
            if (!bytes) { try { bytes = fs.statSync(path.join(ASSETS, file)).size } catch (err) {} }
            return {
              file: name, bytes, source: a.source || '', processing: a.processing || '',
              mime: a.mime || mime,
              width: a.width || null, height: a.height || null,
            }
          })
          const total = items.reduce((sum, it) => sum + (it.bytes || 0), 0)
          res.writeHead(200, JSON_HEADERS)
          res.end(JSON.stringify({ ok: true, count: items.length, totalBytes: total, items }))
        } catch (err) {
          res.writeHead(200, JSON_HEADERS)
          res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err) }))
        }
      },
    }))

    function registerWidget(prefix) {
      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: prefix + '/widget.js',
        handler: (req, res) => {
          try {
            const src = readWidget()
            res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
            res.end(src)
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('widget unavailable')
          }
        },
      }))
    }
    registerWidget(NS)
    registerWidget(LEGACY_NS)   // 过渡别名：已加载页面里的旧 <script src> 仍能拿到脚本

    // ③ Web 形态注入（与桌面端的内联行并存，各自去重）
    if (typeof ctx.webServer.tapIndex === 'function') {
      disposers.push(ctx.webServer.tapIndex((html) => {
        if (html.indexOf(WIDGET_PATH) !== -1) return html
        const tag = '<script defer src="' + WIDGET_PATH + '"></script>'
        return html.indexOf('</body>') !== -1 ? html.replace('</body>', tag + '</body>') : html + tag
      }))
    }

    ctx.effect(() => () => {
      for (const d of disposers) { try { d() } catch (err) {} }
    })
  })
}

export { name, apply }
