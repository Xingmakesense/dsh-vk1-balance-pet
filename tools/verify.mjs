import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

// 宿主侧验证：不触网、不读真实凭据（凭据服务用桩），只验证路由注册、注入行、
// 去重、素材可服务与余额失败时的结构化返回。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
assert.equal(pkg.exports['.'], './index-v2.js')
assert.ok(fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8').includes('name: ./index-v2.js'))

// 语法检查交给 node --check（ESM 才能收 import.meta）
for (const file of ['index-v2.js', 'widget.js']) {
  const src = fs.readFileSync(path.join(root, file), 'utf8')
  assert.ok(src.length > 1000, file)
  const tmp = path.join(root, '.syntax-' + file)
  fs.writeFileSync(tmp, src)
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' })
  fs.rmSync(tmp, { force: true })
  assert.equal(r.status, 0, file + ': ' + r.stderr)
}

// 素材与登记表一致（尺寸经过压缩，sha 以随包登记为准）
const provenance = JSON.parse(fs.readFileSync(path.join(root, 'asset-sources.json'), 'utf8'))
assert.ok(Array.isArray(provenance.assets) && provenance.assets.length >= 15)
for (const asset of provenance.assets) {
  const file = path.join(root, 'assets', asset.file)
  const bytes = fs.readFileSync(file)
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), asset.sha256, 'sha: ' + asset.file)
  assert.ok(bytes.length < 5 * 1024 * 1024, '单个素材不得超过 5 MB: ' + asset.file)
  if (asset.file.endsWith('.png')) {
    assert.equal(bytes.readUInt32BE(16), asset.width, 'width: ' + asset.file)
    assert.equal(bytes.readUInt32BE(20), asset.height, 'height: ' + asset.file)
  }
}
// 不再分发自更新检查器与多余宿主入口
assert.equal(fs.existsSync(path.join(root, 'update-checker-v1.js')), false)
assert.equal(fs.existsSync(path.join(root, 'index.js')), false)

const mod = await import(pathToFileURL(path.join(root, 'index-v2.js')).href)
assert.equal(mod.name, 'dsh-vk1-balance-pet')
assert.equal(typeof mod.apply, 'function')

const routes = new Map()
const injected = []
let tapIndexFn = null
let resolveCalls = 0
const rootApi = {
  on(event, cb) { injected.push({ event, cb }); return () => {} },
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  inject(services, cb) {
    assert.deepEqual(services, ['webServer', 'credentials'])
    cb({
      get() { return null }, // 没有账号服务 → 走兜底路径
      credentials: { async resolve() { resolveCalls++; return null } },
      webServer: {
        register(route) { routes.set(route.path, route); return () => {} },
        tapIndex(fn) { tapIndexFn = fn; return () => {} },
      },
      effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
    })
  },
}
mod.apply(rootApi)

// ① 桌面端注入行：必须是内联 script 行，且去重
assert.equal(injected.length, 1)
assert.equal(injected[0].event, 'webserver/index-inject')
const table = []
injected[0].cb(table)
assert.equal(table.length, 1)
assert.equal(table[0].kind, 'script', '桌面端只能用内联 script 行')
assert.equal(table[0].placement, 'body')
assert.ok(table[0].text.includes('/dsh-vk1-balance-pet/widget.js'))
injected[0].cb(table)
assert.equal(table.length, 1, '注入行必须去重')

// ② 路由清单
function fakeRes() {
  return {
    statusCode: 0, headers: {}, body: null,
    writeHead(code, h) { this.statusCode = code; this.headers = h || {} },
    end(b) { this.body = b },
  }
}
// 资源：新命名空间必须齐全；旧前缀作为过渡别名也存在（不用于新代码）
for (const name of [
  'expression_11.png', 'expression_12.png', 'expression_21.png', 'expression_22.png',
  'rice.png', 'iron_bowl.png', 'hit.mp3', 'feed.mp3', 'pot_land.mp3', 'pot_off.mp3',
  'duck_press.mp3', 'duck_release.mp3', 'orb.wav', 'cost.wav', 'task_end.wav',
  'fx1_press.mp3', 'fx1_release.mp3', 'rua.gif', 'bubble_petpet.gif', 'bubble_money.gif',
  'skin_dsniang1.png', 'pat_hand_0.png', 'pat_hand_4.png',
]) {
  const route = routes.get('/dsh-vk1-balance-pet/' + name)
  assert.ok(route, 'missing resource route ' + name)
  const res = fakeRes()
  await route.handler({ url: '/dsh-vk1-balance-pet/' + name }, res)
  assert.equal(res.statusCode, 200, 'resource ' + name)
  assert.ok(res.body && res.body.length > 500, 'resource body ' + name)
}
// 未登记的名字不会被路由（exact 路由天然不匹配）
for (const bad of ['nope.png', 'index-v2.js', '../package.json']) {
  assert.equal(routes.has('/dsh-vk1-balance-pet/' + bad), false, 'must not route ' + bad)
}


// ③ 素材可服务（exact 路由）
for (const name of ['expression_11.png', 'iron_bowl.png', 'hit.mp3']) {
  const res = fakeRes()
  await routes.get('/dsh-vk1-balance-pet/' + name).handler({ url: '/dsh-vk1-balance-pet/' + name }, res)
  assert.equal(res.statusCode, 200, name)
  assert.ok(res.body.length > 1000, name)
}
{
  const res = fakeRes()
  await routes.get('/dsh-vk1-balance-pet/widget.js').handler({}, res)
  assert.equal(res.statusCode, 200, 'widget.js')
  assert.ok(res.body.length > 1000)
}

// ③b 旧前缀只是素材/脚本的过渡别名；数据接口不得出现在旧前缀下
for (const name of ['expression_11.png', 'rice.png', 'bubble_petpet.gif']) {
  assert.ok(routes.has('/dsh-vk1/' + name), 'legacy alias must serve ' + name)
}
assert.ok(routes.has('/dsh-vk1/widget.js'), 'legacy alias must serve widget.js')
for (const bad of ['/dsh-vk1/balance.json', '/dsh-vk1/defaults.json', '/dsh-vk1/last-turn.json', '/dsh-vk1/resources.json']) {
  assert.equal(routes.has(bad), false, 'data route must NOT live under legacy prefix: ' + bad)
}

// ④ 余额失败：结构化错误 + 版本号，绝无 5xx
{
  const res = fakeRes()
  await routes.get('/dsh-vk1-balance-pet/balance.json').handler({}, res)
  const payload = JSON.parse(res.body)
  assert.equal(res.statusCode, 200)
  assert.equal(payload.ok, false)
  assert.equal(payload.version, pkg.version)
  assert.ok(payload.code, '失败必须带 code')
  assert.ok(payload.error.includes('账号路'))
  assert.equal(resolveCalls > 0, true, '账号路失败后要尝试凭据兜底')
}

// ⑤ tapIndex：插入 + 去重
{
  const html = '<html><body><div id="app"></div></body></html>'
  const out = tapIndexFn(html)
  assert.ok(out.includes('/dsh-vk1-balance-pet/widget.js'))
  assert.equal(tapIndexFn(out), out, 'tapIndex 必须去重')
  const noBody = '<html><div id="app"></div></html>'
  assert.ok(tapIndexFn(noBody).endsWith('</script>'))
}

// ⑤b 每轮消耗接口与资源清单
{
  const res = fakeRes()
  await routes.get('/dsh-vk1-balance-pet/last-turn.json').handler({}, res)
  const payload = JSON.parse(res.body)
  assert.equal(payload.ok, true)
  assert.equal(typeof payload.seq, 'number')
  assert.equal(typeof payload.amount, 'number')

  const rres = fakeRes()
  await routes.get('/dsh-vk1-balance-pet/resources.json').handler({}, rres)
  const rp = JSON.parse(rres.body)
  assert.equal(rp.ok, true)
  assert.ok(rp.count >= 26, '资源清单应覆盖随包素材，实际 ' + rp.count)
  assert.ok(rp.totalBytes > 1000)
  const files = rp.items.map((it) => it.file)
  for (const f of ['duck_press.mp3', 'orb.wav', 'expression_11.png', 'task_end.wav', 'bubble_money.gif', 'skin_dsniang1.png']) assert.ok(files.includes(f), '资源缺 ' + f)
}

// ⑥ 响应头安全：不带 CORS 通配
{
  const res = fakeRes()
  await routes.get('/dsh-vk1-balance-pet/balance.json').handler({}, res)
  assert.equal(res.headers['Access-Control-Allow-Origin'], undefined, '不允许 CORS 通配')
}

console.log('verify: HOST OK —', routes.size, 'routes,', injected.length, 'injection channel')
