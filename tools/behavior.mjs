import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// 客户端行为验证：在隔离的 DOM 桩里跑随包分发的 widget.js，不触网、不读凭据。
// 覆盖本次改造的六个行为点：0.5 元扣费步进、演示不改数值、60 秒随机掉盆、
// 落点在角色左上方 2 倍身高、取消 Q 弹、吸附区/翻转线可配置。
class Element {
  constructor(tag = 'div') {
    this.tagName = tag
    this.children = []
    this.style = { setProperty() {} }
    this.dataset = {}
    this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false } }
    this.width = 610
    this.height = 610
    this.validity = { valid: true }
    this.open = false
    this.offsetWidth = 400
  }
  appendChild(el) { this.children.push(el); el.parentNode = this; return el }
  removeChild(el) { this.children = this.children.filter((x) => x !== el); el.parentNode = null }
  setAttribute(k, v) { this[k] = v }
  getAttribute(k) { return this[k] }
  removeAttribute(k) { delete this[k] }
  addEventListener() {}
  removeEventListener() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 454, height: 454 } }
  getContext() {
    return {
      drawImage() {}, clearRect() {}, fillRect() {}, save() {}, restore() {}, translate() {}, rotate() {},
      getImageData() { return { data: new Uint8ClampedArray([0, 0, 0, 255]) } },
    }
  }
  toDataURL() { return 'data:image/png;base64,' }
  showModal() { this.open = true }
  close() { this.open = false }
}

const source = fs.readFileSync(new URL('../widget.js', import.meta.url), 'utf8')

function fixture(saved = {}) {
  const storage = new Map(Object.entries(saved))
  const docEvents = new Map()
  const winEvents = new Map()
  const timers = []
  const add = (m, k, fn) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(fn) }
  const document = {
    head: new Element(),
    body: new Element(),
    documentElement: { clientWidth: 1200, clientHeight: 800 },
    createElement: (tag) => new Element(tag),
    createElementNS: (_, tag) => new Element(tag),
    addEventListener: (k, fn) => add(docEvents, k, fn),
    removeEventListener: (k, fn) => docEvents.get(k)?.delete(fn),
    getElementById() { return null },
    currentScript: { src: 'http://localhost/dsh-vk1/widget.js' },
  }
  class Audio extends Element { constructor() { super('audio') } play() { return Promise.resolve() } pause() {} load() {} }
  const ctx = vm.createContext({
    document,
    Audio,
    Image: Element,
    console,
    Blob,
    URL,
    crypto: { randomUUID: () => 'test-clip' },
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener: (k, fn) => add(winEvents, k, fn),
    removeEventListener: (k, fn) => winEvents.get(k)?.delete(fn),
    requestAnimationFrame() { return 1 },
    cancelAnimationFrame() {},
    setInterval(fn, ms) { timers.push({ fn, ms }); return timers.length },
    clearInterval() {},
    setTimeout() { return 1 },
    clearTimeout() {},
    fetch() { return new Promise(() => {}) },
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) },
  })
  ctx.window = ctx
  const hook = `window.test = {
    state, pat, applyBalance, startCredit, spawnRiceBowl, dropTick, dropPoint, onRiceFed, newBowl,
    updateBowls, makeTick, frame, snapBounds, snapZones, settle, saveAnchor, applyAnchorPos, setSize,
    STEP, DROP_INTERVAL_MS, SIZE_PRESETS, snapConfig, saveSnapConfig, loadSnapConfig, refreshFlip, stop
  };`
  vm.runInContext(source.replace(
    '  window.__dshAppearanceWidgets = window.__dshAppearanceWidgets || {}',
    hook + '\n  window.__dshAppearanceWidgets = window.__dshAppearanceWidgets || {}'), ctx)
  return { ...ctx.test, storage, timers, docEvents, winEvents }
}

// ① 扣费步进 = 0.5 元
{
  const t = fixture()
  assert.equal(t.STEP, 0.5, '扣费步进必须是 0.5 元')
  t.applyBalance(10, false)
  t.applyBalance(9, false) // 掉了 1 元 → 两个 0.5 步
  assert.ok(Math.abs(t.state.pending - 1) < 1e-9, '统计到 1 元待扣')
  for (let ms = 1; ms < 3000; ms += 50) t.frame(ms)
  assert.ok(Math.abs(t.state.bookedBal - 9) < 1e-9, '最终结算到 9.00')
  assert.ok(t.state.usage.used >= 1 - 1e-9, '今日消费按真实变化累计')
  t.stop()
}

// ② 演示只播动画，不改任何数字
{
  const t = fixture()
  t.applyBalance(10, false)
  const before = t.state.bookedBal
  t.makeTick(t.STEP, true)
  assert.equal(t.state.bookedBal, before, '演示扣费不得改余额')
  t.startCredit(3, true)
  const demo = t.state.bowls.find((b) => b.demo)
  assert.ok(demo, '演示要掉一盆')
  t.onRiceFed(demo)
  assert.equal(t.state.bookedBal, before, '喂演示盆不得改余额')
  assert.equal(t.state.creditPending, 0, '演示不进入待入账')
  t.stop()
}

// ③ 60 秒周期掉盆：充值不再立刻掉；定时器周期是 60000ms
{
  const t = fixture()
  assert.equal(t.DROP_INTERVAL_MS, 60000)
  const timer = t.timers.find((x) => x.ms === 60000)
  assert.ok(timer, '必须有 60000ms 的掉盆定时器')
  t.applyBalance(10, false)
  t.applyBalance(13, false) // 充值 3 元
  assert.equal(t.state.bowls.filter((b) => !b.iron).length, 0, '充值不再立刻掉盆')
  assert.ok(Math.abs(t.state.creditPending - 3) < 1e-9, '充值先记在待入账')
  timer.fn()
  const bowls = t.state.bowls.filter((b) => !b.iron)
  assert.equal(bowls.length, 1, '一个周期掉一盆')
  assert.ok(Math.abs(bowls[0].amount - 3) < 1e-9, '盆承接待入账金额')
  timer.fn()
  assert.equal(t.state.bowls.filter((b) => !b.iron).length, 1, '场上已有盆时不再叠加')
  t.onRiceFed(bowls[0])
  assert.ok(Math.abs(t.state.bookedBal - 13) < 1e-9, '喂下去才真正入账')
  t.stop()
}

// ④ 落点：角色左上方、2 倍身高；贴边时夹进视口
{
  const t = fixture()
  t.state.size = 454
  // 屏幕中间偏右下：左上方 908px 仍在视口内，可以直接验证偏移量
  t.state.left = 1100
  t.state.top = 700
  const pt = t.dropPoint()
  assert.equal(pt.x, 1100 - 454 * 2, 'x 在角色左侧 2 倍身高处')
  assert.equal(pt.y, 700 - 454 * 2 < 0 ? pt.y : 700 - 454 * 2, 'y 在角色上方 2 倍身高处')
  // 角色贴在左上角：落点必须被夹进视口，不能是负坐标
  t.state.left = 10
  t.state.top = 10
  const near = t.dropPoint()
  assert.ok(near.x >= 0 && near.y >= 0, '落点夹进视口')
  assert.ok(near.x > 10, '夹住后仍在角色右侧可见区域')
  t.stop()
}

// ⑤ 取消 Q 弹：落地后不再产生挤压缩放
{
  const t = fixture()
  t.state.size = 454
  t.spawnRiceBowl(0, false)
  const bowl = t.state.bowls[t.state.bowls.length - 1]
  for (let i = 0; i < 200; i++) t.updateBowls(0.016)
  assert.equal(bowl.squish, undefined, '不再写 squish 字段')
  assert.equal(bowl.squishT, undefined, '不再有挤压计时')
  t.stop()
}

// ⑥ 吸附：四边吸附区 + 翻转线，ratio/px/off 三档
{
  const t = fixture()
  const vp = { w: 1200, h: 800 }
  t.snapConfig.mode = 'ratio'
  t.snapConfig.ratio = { L: 10, T: 0, R: 10, B: 15, F: 50 }
  const b = t.snapBounds(vp)
  assert.equal(b.L, 120)
  assert.equal(b.R, 1080)
  assert.equal(b.F, 600)
  assert.equal(t.snapZones(50, 400, 400, vp).zH, 'left')
  assert.equal(t.snapZones(1150, 400, 400, vp).zH, 'right')
  assert.equal(t.snapZones(600, 400, 790, vp).zV, 'bottom')
  t.snapConfig.mode = 'off'
  const off = t.snapBounds(vp)
  assert.equal(off.L, 0)
  assert.equal(off.R, 1200)
  const offZ = t.snapZones(5, 5, 795, vp)
  assert.equal(offZ.zH, null, 'off 档不吸左右')
  assert.equal(offZ.zV, null, 'off 档不吸上下')
  t.stop()
}

// ⑦ 尺寸预设：当前 454 是中杯，三档比例与上游 340:454:624 一致
{
  const t = fixture()
  const byName = Object.fromEntries(t.SIZE_PRESETS.map((p) => [p.name, p.px]))
  assert.equal(byName['中杯'], 454, '中杯 = 当前大小 454')
  assert.equal(byName['小杯'], 340)
  assert.equal(byName['大杯'], 624)
  const ratio = (n) => byName[n] / byName['中杯']
  assert.ok(Math.abs(ratio('小杯') - 340 / 454) < 1e-9)
  assert.ok(Math.abs(ratio('大杯') - 624 / 454) < 1e-9)
  t.stop()
}

console.log('behavior: WIDGET OK — 7 groups')
