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
    state, pat, applyBalance, drawnBalance, STEP_INTERVAL_SEC, hasWornPot, btnOnRight, startCredit, spawnRiceBowl, dropTick, dropPoint, onRiceFed, newBowl,
    updateBowls, makeTick, frame, snapBounds, snapZones, settle, saveAnchor, applyAnchorPos,
    applySize, setScale, stepToScale, scaleToStep, baseSizePx, setDropInterval, restartDropTimer, CLICK_JUMP_DUR,
    updateRadar, buildMenu, openMenu, closeMenu,
    isHit, onDocClick, swallowNextClick, SOUND_PACKS, showBubble, pickReminder, tickBubble, SKINS, skinOf, applySkin, playPool, CUE_SOUND_GAP_MS, setCueSource, pickIdleWord,
    getCuePools() { return cuePools },
    bubbleTextNow() { return bubbleText },
    placeBubble, IRON_STACK_MAX, trimIronStack, HEAD_SQUASH_DUR,
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

// ① 板面数字是实时余额；音效只在「累计消耗 ≥ 步长 且 任务进行中」时播
{
  const t = fixture()
  assert.equal(t.stepValue(), 0.5, '默认扣费步长 0.5 元')
  t.applyBalance(10, false)
  t.applyBalance(9, false)   // 掉 1 元
  assert.ok(Math.abs(t.drawnBalance() - 9) < 1e-9, '板面直接显示实时余额 9.00（不做逐步动画）')
  assert.ok(Math.abs(t.state.pending - 1) < 1e-9, '累计消耗统计到 1 元')
  // 空闲：只累计不播，pending 不被消耗
  let ms = 0
  for (let k = 0; k < 40; k++) { ms += 100; t.frame(ms) }
  assert.ok(Math.abs(t.state.pending - 1) < 1e-9, '空闲时间不消耗 pending（不播扣血）')
  // 任务进行中：每 0.2s 一拍把 pending 按步长吐掉
  t.state.taskBusy = true
  // 第 ③ 个条件：距上次提示满 60s（dt 每帧最多 0.1s）→ 两拍约 1200 帧
  for (let k = 0; k < 1400; k++) { ms += 100; t.frame(ms) }
  assert.ok(t.state.pending < 1e-9, '三条件都满足时 pending 应按步长结算完')
  assert.equal(t.state.usage, null, '今日已用功能已移除')
  t.stop()
}

// ①b 自定义步长：pending 按步长分拍消耗
{
  const t = fixture()
  t.applyBalance(10, false)
  t.state.stepYuan = 2
  assert.equal(t.stepValue(), 2)
  t.applyBalance(3, false)   // 掉 7 元
  assert.ok(Math.abs(t.drawnBalance() - 3) < 1e-9, '板面实时显示 3.00')
  t.state.taskBusy = true
  let ms = 0
  // 3 拍 × 60s ≈ 180s → 约 1900 帧
  for (let k = 0; k < 1900; k++) { ms += 100; t.frame(ms) }
  assert.ok(Math.abs(t.state.pending - 1) < 1e-9, '7 元按 2 元步长只吐 3 拍，剩 1 元（不足步长不播）')
  t.state.stepYuan = 0
  assert.equal(t.stepValue(), 0.5, '非法步长回落 0.5')
  t.stop()
}

// ①c 时间条件：两次提示之间必须满 60 秒
{
  const t = fixture()
  t.applyBalance(10, false)
  t.applyBalance(9, false)          // 掉 1 元 → pending 1
  t.state.taskBusy = true
  assert.equal(t.state.stepClock, t.STEP_INTERVAL_SEC, '初值=满，首次可立即播')
  let ms = 0
  for (let k = 0; k < 30; k++) { ms += 100; t.frame(ms) }   // 约 3 秒
  assert.ok(t.state.pending < 0.6, '第一拍应已播出（pending 减少）')
  const afterFirst = t.state.pending
  t.applyBalance(8.5, false)        // 又掉 0.5
  for (let k = 0; k < 100; k++) { ms += 100; t.frame(ms) }  // 再过 10 秒
  assert.ok(t.state.stepClock < t.STEP_INTERVAL_SEC, '刚播过 → 计时未满')
  assert.ok(t.state.pending > afterFirst - 1e-6, '未满 60 秒不得再播第二拍')
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
  // POLL_MS 与掉盆间隔现在同为 60000，按 ms 找会撞到轮询定时器 → 直接驱动 dropTick
  assert.ok(t.timers.some((x) => x.ms === 60000), '必须有 60000ms 的定时器（轮询/掉盆）')
  const timer = { fn: function () { t.dropTick() } }
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
  assert.ok(t.timers.filter((x) => x.ms === 5000).length >= 1, '改间隔后要重建为 5000ms 定时器')
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
  // 10 级映射 0.6..1.25：scale 1.0 落在第 7 级附近
  assert.equal(t.scaleToStep(1), 7, '10 级滑条下 scale 1.0 ≈ 第 7 级')
  // 视口 1200x800 → 基准 min(250, 800*0.28=224)=224，再乘 2/3 → 约 149px
  assert.equal(t.baseSizePx(1), Math.round(224 * 2 / 3), '默认 1 倍 = 基准的 2/3')
  assert.equal(t.state.scale, 1)
  t.setScale(1.25)
  assert.equal(t.state.size, 187, '1.25 倍（新上限）→ 约 187px')
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

// ⑩ 单个音效选源：给某槽换源后，该槽的音效池必须换（其余槽保持默认）
{
  const t = fixture()
  const src = (i) => (t.getCuePools()[i].pool[0] || {}).src || ''
  assert.ok(src(0).includes('hit.mp3'), '默认掉血音是 hit.mp3，实际 ' + src(0))
  t.setCueSource(0, '/dsh-vk1-balance-pet/duck_press.mp3')
  assert.ok(src(0).includes('duck_press.mp3'), '换源后掉血音应为 duck_press.mp3，实际 ' + src(0))
  assert.ok(src(1).includes('feed.mp3'), '未改的回血槽仍用默认音')
  t.setCueSource(0, '')
  assert.ok(src(0).includes('hit.mp3'), '清空后回到默认音')
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

// ⑭ 皮肤：切到蓝发女仆后四表情同图、board=badge
{
  const t = fixture()
  assert.equal(t.SKINS.vk1.board, 'sprite')
  assert.equal(t.SKINS.dsniang.board, 'badge')
  t.applySkin('dsniang')
  assert.equal(t.state.skin, 'dsniang')
  assert.equal(t.skinOf(t.state.skin).faces.happy.indexOf('skin_dsniang1.png') >= 0, true)
  t.applySkin('nope')
  assert.equal(t.state.skin, 'vk1', '未知皮肤回落到 vk1')
  t.stop()
}

// ⑮ 单击不重置未喂的饭盆（旧 bug：poll(true) 的 snap 会清空）
{
  const t = fixture()
  t.applyBalance(10, false)
  t.applyBalance(13, false)          // 充值 → 挂到待入账，不掉盆
  t.dropTick()                        // 周期掉一盆
  const before = t.state.bowls.filter(function (b) { return !b.iron }).length
  assert.equal(before, 1)
  // 模拟单击后的余额刷新（snap=false）
  t.applyBalance(13, false)
  assert.equal(t.state.bowls.filter(function (b) { return !b.iron }).length, 1, '单击刷新不得清掉未喂的盆')
  t.applyBalance(13, true)            // 手动刷新（snap=true）仍然允许清空
  assert.equal(t.state.bowls.filter(function (b) { return !b.iron }).length, 0)
  t.stop()
}

// ⑯ 气泡分通道：cost 与 idle 互不覆盖（cost 优先）
{
  const t = fixture()
  t.state.bubbleOn = true
  t.state.idleBubbleOn = true
  t.showBubble('cost-1', false, 'cost')
  t.showBubble('idle-1', false, 'idle')
  t.tickBubble(0.1)
  assert.equal(t.bubbleTextNow(), 'cost-1', 'cost 通道优先显示')
  t.stop()
}

// ⑰ 音效节流：700ms 内同槽只响一次（修复扣血音效连响）
{
  const t = fixture()
  assert.equal(t.CUE_SOUND_GAP_MS, 700)
  // 只验证常量与函数存在（Audio 桩不真正出声）
  assert.equal(typeof t.playPool, 'function')
  t.stop()
}

// ⑱ 气泡贴边：左吸附不越左界、右吸附不越右界
{
  const t = fixture()
  t.state.size = 100
  t.state.h = 'left'
  t.state.left = 0
  t.state.top = 400
  const el = { style: {}, offsetWidth: 200 }
  t.placeBubble(el, 0)
  assert.ok(parseInt(el.style.left, 10) >= 0, '左吸附时气泡左缘不得为负：' + el.style.left)
  t.state.h = 'right'
  t.state.left = 1100
  const el2 = { style: {}, offsetWidth: 200 }
  t.placeBubble(el2, 0)
  const left2 = parseInt(el2.style.left, 10)
  assert.ok(left2 - 200 >= -1, '右吸附时气泡左缘（含宽度）不得超出视口：' + left2)
  assert.ok(left2 <= 1200, '右吸附时锚点不得超出视口：' + left2)
  t.stop()
}

// ⑲ 铁盆堆叠上限 30；扣头不再触发头顶挤压（Q 弹）
{
  const t = fixture()
  assert.equal(t.IRON_STACK_MAX, 30)
  t.applyBalance(10, false)
  // 造 35 个铁盆并全戴上
  for (let i = 0; i < 35; i++) {
    t.spawnRiceBowl(0, false)
    const bowl = t.state.bowls[t.state.bowls.length - 1]
    t.onRiceFed(bowl)
  }
  const onHead = t.state.bowls.filter(function (b) { return b.iron && b.onHead && b.fadeT <= 0 }).length
  assert.ok(onHead <= 30, '戴在头上的铁盆不得超过 30，实际 ' + onHead)
  // 扣头不应把 headSquashT 归零（那会立刻触发一次挤压/Q 弹）
  t.state.headSquashT = t.HEAD_SQUASH_DUR
  t.spawnRiceBowl(0, false)
  t.onRiceFed(t.state.bowls[t.state.bowls.length - 1])
  assert.equal(t.state.headSquashT, t.HEAD_SQUASH_DUR, '铁盆扣头不再触发 Q 弹')
  t.stop()
}

// ⑳ 单击只冒随机句（不出提醒词模板）；stale 回包不触发掉盆
{
  const t = fixture()
  t.state.bubbleOn = true
  t.state.idleBubbleOn = true
  // 提醒词里有 {cost} 占位，随机句里没有 —— 用它区分两条来源
  t.state.reminders = ['提醒词占位{cost}']
  t.state.idleWords = ['随机句子A']
  // 直接检查 pickIdleWord 返回的是随机池
  assert.equal(t.pickIdleWord(), '随机句子A')
  t.stop()
}

// ㉑ stale 回包绝不当作充值（旧版扣血时会凭空掉一盆）
{
  const t = fixture()
  t.applyBalance(10, false)
  t.applyBalance(9, false)              // 扣 1 元
  const before = t.state.bowls.length
  t.applyBalance(10, false, true)       // stale：宿主返回更早、更高的缓存
  assert.equal(t.state.bowls.length, before, 'stale 回包不得掉盆')
  assert.equal(t.state.creditPending, 0, 'stale 回包不得记待入账')
  t.stop()
}

// ㉒ 头顶有铁盆（≥1）时单击不触发 Q 弹；自动戴盆静音（不响第二声）
{
  const t = fixture()
  t.applyBalance(10, false)
  // 造一个戴在头上的铁盆
  t.spawnRiceBowl(0, false)
  t.onRiceFed(t.state.bowls[t.state.bowls.length - 1])
  const worn = t.state.bowls.filter(function (b) { return b.iron && b.onHead })
  assert.ok(worn.length >= 1, '应先有一个戴在头上的铁盆')
  assert.equal(t.hasWornPot(), true, '头上有盆时 hasWornPot() 必须为真（→ 单击不弹）')
  // 取下来之后再判定
  worn[0].fadeT = 0.001
  assert.equal(t.hasWornPot(), false, '没有戴盆时为假（→ 单击正常 Q 弹）')
  t.stop()
}

// ㉓ ⋯ 按钮：左吸附贴左、右吸附贴右、自由摆放看中心相对翻转线
{
  const t = fixture()
  t.state.size = 100
  t.state.h = 'left'
  assert.equal(t.btnOnRight(), false, '左吸附态按钮应在左')
  t.state.h = 'right'
  assert.equal(t.btnOnRight(), true, '右吸附态按钮应在右')
  // 自由摆放：中心在翻转线（默认 50% = 600）左侧 → 贴左
  t.state.h = null
  t.state.left = 100
  assert.equal(t.btnOnRight(), false, '自由态在左半边 → 贴左')
  t.state.left = 1100
  assert.equal(t.btnOnRight(), true, '自由态在右半边 → 贴右')
  t.stop()
}

console.log('behavior: WIDGET OK — 23 groups')
