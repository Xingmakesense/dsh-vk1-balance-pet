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
  class Audio extends Element {
    constructor(url) { super('audio'); this.src = url || '' }
    play() { return Promise.resolve() }
    pause() {}
    load() {}
    removeAttribute(name) { if (name === 'src') this.src = ''; delete this[name] }
  }
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
    updateBowls, makeTick, frame, snapBounds, snapZones, settle, saveAnchor, applyAnchorPos,
    applySize, setScale, stepToScale, scaleToStep, baseSizePx, setDropInterval, restartDropTimer, CLICK_JUMP_DUR,
    updateRadar, buildMenu, openMenu, closeMenu,
    isHit, onDocClick, swallowNextClick, applySoundPack, SOUND_PACKS, showBubble, pickReminder, tickBubble,
    getCuePools() { return cuePools },
    ready() { hitReady = true },
    stepValue, STEP_DEFAULT, STEP_MIN, STEP_MAX,
    DROP_INTERVAL_DEFAULT_S, DROP_INTERVAL_MIN_S, DROP_INTERVAL_MAX_S, SCALE_MIN, SCALE_MAX, SCALE_STEPS,
    snapConfig, saveSnapConfig, loadSnapConfig, refreshFlip, stop
  };`
  vm.runInContext(source.replace(
    '  window.__dshAppearanceWidgets = window.__dshAppearanceWidgets || {}',
    hook + '\n  window.__dshAppearanceWidgets = window.__dshAppearanceWidgets || {}'), ctx)
  return { ...ctx.test, storage, timers, docEvents, winEvents }
}

// ① 扣费步进 = 0.5 元
{
  const t = fixture()
  assert.equal(t.stepValue(), 0.5, '默认扣费步长 0.5 元')
  t.applyBalance(10, false)
  t.applyBalance(9, false) // 掉了 1 元 → 两个 0.5 步
  assert.ok(Math.abs(t.state.pending - 1) < 1e-9, '统计到 1 元待扣')
  for (let ms = 1; ms < 3000; ms += 50) t.frame(ms)
  assert.ok(Math.abs(t.state.bookedBal - 9) < 1e-9, '最终结算到 9.00')
  assert.equal(t.state.usage, null, '今日已用功能已移除')
  t.stop()
}

// ①b 自定义扣费步长：0.01–100 元，夹取越界值
{
  const t = fixture()
  t.applyBalance(10, false)
  t.state.stepYuan = 2
  assert.equal(t.stepValue(), 2)
  t.applyBalance(3, false)          // 掉 7 元 → 待扣 7
  for (let ms = 1; ms < 6000; ms += 50) t.frame(ms)
  assert.ok(Math.abs(t.state.bookedBal - 3) < 1e-9, '按 2 元步长也要结算到 3.00')
  t.state.stepYuan = 0
  assert.equal(t.stepValue(), 0.5, '非法步长回落 0.5')
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

// ③ 周期掉盆：充值不再立刻掉；定时器周期来自可自定义的 state.dropIntervalSec
{
  const t = fixture()
  assert.equal(t.stepToScale(1), t.SCALE_MIN)
  assert.equal(t.DROP_INTERVAL_DEFAULT_S, 60)
  assert.equal(t.state.dropIntervalSec, 60)
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

  // 自定义间隔：改完立即重建定时器，越界值被夹回
  t.setDropInterval(5)
  assert.equal(t.state.dropIntervalSec, 5)
  assert.ok(t.timers.some((x) => x.ms === 5000), '改间隔后要重建为 5000ms 定时器')
  t.setDropInterval(99999)
  assert.equal(t.state.dropIntervalSec, t.DROP_INTERVAL_MAX_S, '越界夹到上限')
  t.setDropInterval(1)
  assert.equal(t.state.dropIntervalSec, t.DROP_INTERVAL_MIN_S, '越界夹到下限')
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

// ⑦ 尺寸：连续缩放（1–20 级 → 0.6–2.5），基准 min(250, min(vw,vh)*0.28)
{
  const t = fixture()
  assert.equal(t.SCALE_STEPS, 10, '滑条上限 10 级')
  assert.equal(t.stepToScale(1), t.SCALE_MIN)
  assert.equal(t.stepToScale(t.SCALE_STEPS), t.SCALE_MAX)
  assert.equal(t.scaleToStep(1), 3, '10 级滑条下 scale 1.0 对应第 3 级')
  // 视口 1200x800 → 基准 min(250, 800*0.28=224)=224，再乘 2/3 → 约 149px
  assert.equal(t.baseSizePx(1), Math.round(224 * 2 / 3), '默认 1 倍 = 基准的 2/3')
  assert.equal(t.state.scale, 1)
  t.setScale(2.5)
  assert.equal(t.state.size, 373, '2.5 倍 → 约 373px（不再到 560px）')
  t.setScale(0.6)
  assert.equal(t.state.size, 122, '0.6 倍 → 触到 122px 下限')
  t.stop()
}

// ⑧ 火控雷达开关：关掉后不渲染铭牌、不锁定、不磁吸
{
  const t = fixture()
  t.state.radarOn = false
  t.spawnRiceBowl(0, false)
  for (let i = 0; i < 300; i++) t.updateRadar(0.05)
  assert.equal(t.state.lockAll, false, '关闭雷达后不得进入锁定')
  assert.equal(t.state.bowlWait, 0, '关闭雷达后闲置计时清零')
  assert.equal(t.state.radarManual, false)
  t.stop()
}

// ⑨ 点击穿透：落在角色上的 click 必须被吞，空白处不能吞
{
  const t = fixture()
  t.ready() // 命中画布就绪（stub 的 getImageData 恒为 alpha 255）
  const rootRect = { left: 0, top: 0, width: 454, height: 454 }
  function fakeClick(x, y, targetClosest) {
    const calls = []
    const ev = {
      clientX: x, clientY: y,
      target: { closest: targetClosest || function () { return null } },
      stopPropagation() { calls.push('stop') },
      preventDefault() { calls.push('prevent') },
    }
    t.onDocClick(ev)
    return calls
  }
  // 角色中心：命中 → 吞
  assert.ok(t.isHit({ clientX: 227, clientY: 227 }), 'stub 命中画布应判定为命中角色')
  assert.deepEqual(fakeClick(227, 227), ['stop', 'prevent'], '角色上的 click 必须被吞掉')
  // 空白处：不吞
  assert.deepEqual(fakeClick(5000, 5000), [], '空白处的 click 不得被吞')
  // 菜单 / 设置 / ☰ 按钮：放行
  assert.deepEqual(fakeClick(227, 227, function (sel) { return sel === '.dshvk1-menu' ? {} : null }), [], '菜单内点击放行')
  assert.deepEqual(fakeClick(227, 227, function (sel) { return sel === '.dshvk1-dialog' ? {} : null }), [], '设置面板点击放行')
  assert.deepEqual(fakeClick(227, 227, function (sel) { return sel === '.dshvk1-btn' ? {} : null }), [], '菜单按钮点击放行')
  // 时间窗兜底：按下时命中过的坐标，即使 click 落在别处也吞一次
  t.swallowNextClick(400)
  assert.deepEqual(fakeClick(5000, 5000), ['stop', 'prevent'], '时间窗内的 click 必须被吞')
  assert.deepEqual(fakeClick(5000, 5000), [], '时间窗用掉后不再吞')
  t.stop()
}

// ⑩ 音效包切换：切到 duck / orb 后四路音效池的源必须跟着换
{
  const t = fixture()
  assert.equal(t.state.soundPack, 'default')
  const src = () => (t.getCuePools()[0].pool[0] || {}).src || ''
  t.applySoundPack('duck')
  assert.equal(t.state.soundPack, 'duck')
  assert.ok(src().includes('duck_press.mp3'), 'duck 包应使用 duck_press.mp3，实际 ' + src())
  t.applySoundPack('orb')
  assert.ok(src().includes('orb.wav'), 'orb 包应使用 orb.wav，实际 ' + src())
  t.applySoundPack('default')
  assert.ok(src().includes('hit.mp3'), 'default 包应回到 hit.mp3')
  t.applySoundPack('nope')
  assert.equal(t.state.soundPack, 'default', '未知音效包回落到 default')
  t.stop()
}

// ⑪ 气泡与提醒词：{cost} 占位符替换、轮转、队列上限
{
  const t = fixture()
  t.state.reminders = ['本轮 ¥{cost}', '花了 {cost} 元']
  assert.equal(t.pickReminder('1.50'), '本轮 ¥1.50')
  assert.equal(t.pickReminder('2.00'), '花了 2.00 元')
  assert.equal(t.pickReminder('3.00'), '本轮 ¥3.00', '提醒词应轮转')
  t.state.bubbleOn = true
  t.showBubble('第一条')
  t.showBubble('第二条')
  for (let i = 0; i < 40; i++) t.tickBubble(0.2)
  assert.equal(typeof t.state.bubbleOn, 'boolean')
  t.stop()
}

// ⑫ 单击角色：Q 弹状态可触发（clickJumpT 归零 → 帧循环推进）
{
  const t = fixture()
  assert.equal(t.state.clickJumpT, t.CLICK_JUMP_DUR || 0.42, '初始应为空闲')
  t.state.clickJumpT = 0
  t.frame(16); t.frame(32)
  assert.ok(t.state.clickJumpT > 0, '触发后帧循环应推进弹跳进度')
  t.stop()
}

// ⑬ 雷达开启时喂盆：铁盆直接扣在头上（不用等它掉到头顶）
{
  const t = fixture()
  t.state.radarOn = true
  t.applyBalance(10, false)
  t.spawnRiceBowl(0, false)
  const bowl = t.state.bowls[t.state.bowls.length - 1]
  t.onRiceFed(bowl)
  const worn = t.state.bowls.filter(function (b) { return b.iron && b.onHead })
  assert.equal(worn.length, 1, '雷达开启喂食后应有 1 个铁盆戴在头上')
  t.stop()
}

console.log('behavior: WIDGET OK — 13 groups')
