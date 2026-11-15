import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 本地预览服务器（仅开发用）：把 bundle 以 /dsh-vk1-balance-pet/* 暴露给浏览器，并提供一个
// 演示页 —— 页面与脚本同源，命中画布不会被跨域污染，行为与 DSH 页面里一致。
//
//   node tools/preview.mjs [port]      # 默认 4319
//   → 打开 http://127.0.0.1:4319/
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.argv[2] || 4319)

const TYPES = {
  '.png': 'image/png', '.mp3': 'audio/mpeg', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.html': 'text/html; charset=utf-8',
}

const PAGE = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>dsh-vk1-balance-pet preview</title>
<style>html,body{margin:0;height:100%;background:#1b2030;color:#cfd8ea;font:14px system-ui}
.hint{padding:12px}</style>
<body><div class="hint">预览页：拖动角色、右键打开菜单。余额接口在本页会走 mock。</div>
<script src="/dsh-vk1-balance-pet/widget.js"></script></body></html>`

// mock 余额：预览时不访问任何真实凭据
function mockBalance() {
  return JSON.stringify({
    ok: true, totalBalance: 2.63, rechargeBalance: 2.63, bonusBalance: 0,
    currency: 'CNY', balanceSource: 'mock', updatedAt: new Date().toISOString(),
    serverTime: new Date().toUTCString(), version: 'preview',
  })
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname === '/' || url.pathname === '/dsh-vk1-balance-pet/' || url.pathname === '/dsh-vk1/') {
    res.writeHead(200, { 'Content-Type': TYPES['.html'] })
    res.end(PAGE)
    return
  }
  if (url.pathname === '/dsh-vk1-balance-pet/balance.json') {
    res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' })
    res.end(mockBalance())
    return
  }
  if (url.pathname === '/dsh-vk1-balance-pet/resources.json') {
    try {
      const prov = JSON.parse(fs.readFileSync(path.join(root, 'asset-sources.json'), 'utf8'))
      const items = prov.assets.map((a) => ({
        file: a.file, bytes: a.bytes, source: a.source || '', processing: a.processing || '',
        mime: a.mime || 'application/octet-stream', width: a.width || null, height: a.height || null,
      }))
      const totalBytes = items.reduce((n, it) => n + (it.bytes || 0), 0)
      res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ ok: true, count: items.length, totalBytes, items }))
    } catch (err) {
      res.writeHead(200, { 'Content-Type': TYPES['.json'] })
      res.end(JSON.stringify({ ok: false, error: String(err && err.message) }))
    }
    return
  }
  if (url.pathname === '/dsh-vk1-balance-pet/last-turn.json') {
    res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ ok: true, seq: 0, amount: 0, tokens: 0, ts: 0 }))
    return
  }
  let rel = url.pathname
if (rel.startsWith('/dsh-vk1-balance-pet/')) rel = rel.slice('/dsh-vk1-balance-pet/'.length)
else if (rel.startsWith('/dsh-vk1/')) rel = rel.slice('/dsh-vk1/'.length)
else rel = rel.replace(/^\//, '')
  const candidates = [path.join(root, 'assets', rel), path.join(root, rel)]
  const file = candidates.find((f) => f.startsWith(root) && fs.existsSync(f))
  if (!file) { res.writeHead(404); res.end('not found'); return }
  fs.readFile(file, (err, bytes) => {
    if (err) { res.writeHead(404); res.end('not found'); return }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    res.end(bytes)
  })
}).listen(port, '127.0.0.1', () => {
  console.log('preview: http://127.0.0.1:' + port + '/')
})
