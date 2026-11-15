import fs from 'node:fs'
import path from 'node:path'
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
const WIDGET_PATH = '/dsh-vk1/widget.js'
const VERSION = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

// path -> [file, content-type]
const ASSET_ROUTES = {
  '/dsh-vk1/expression_11.png': ['expression_11.png', 'image/png'],
  '/dsh-vk1/expression_12.png': ['expression_12.png', 'image/png'],
  '/dsh-vk1/expression_21.png': ['expression_21.png', 'image/png'],
  '/dsh-vk1/expression_22.png': ['expression_22.png', 'image/png'],
  '/dsh-vk1/rice.png': ['rice.png', 'image/png'],
  '/dsh-vk1/iron_bowl.png': ['iron_bowl.png', 'image/png'],
  '/dsh-vk1/hit.mp3': ['hit.mp3', 'audio/mpeg'],
  '/dsh-vk1/feed.mp3': ['feed.mp3', 'audio/mpeg'],
  '/dsh-vk1/pot_land.mp3': ['pot_land.mp3', 'audio/mpeg'],
  '/dsh-vk1/pot_off.mp3': ['pot_off.mp3', 'audio/mpeg'],
  ...Object.fromEntries(Array.from({ length: 5 }, (_, i) =>
    [`/dsh-vk1/pat_hand_${i}.png`, [`pat_hand_${i}.png`, 'image/png']])),
}

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

    for (const [routePath, [file, type]] of Object.entries(ASSET_ROUTES)) {
      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: routePath,
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

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-vk1/balance.json',
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

    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: WIDGET_PATH,
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
