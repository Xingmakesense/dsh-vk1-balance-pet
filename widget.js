/* ===========================================================================
 * VK-1 余额挂件 —— 网页内挂件（纯插件形态）
 *
 * 上游：VKmich16/VK-1「大肥鱼桌宠现代化改_D-16BVM（2026）」571da3b。
 * 现代化移植新增：抚摸、铁盆堆叠、四页设置、分项音效、本地剪辑库、今日消费与峰谷时钟。
 * 本文件是它 dsh_pet.ps1 的网页移植：保留原本全部可观察行为，去掉「桌宠」
 * 相关的一切（置顶窗口 / 托盘 / 屏幕角吸附 / 点击穿透 / 独立进程）。
 *
 * v11 相对已移植的 v9（原版）新增，全部照搬：
 *   · 四种表情（expression_11 开心 / _22 紧张 / _12 傲娇 / _21 冷脸），按优先级
 *     自动切换——2026 版优先级为抚摸 > 零余额 > 铁盆扣头 > 扣费 > 米盆闲置 > 开心
 *   · 充值不再直接改数字：掉一盆米饭，拖到角色身上才入账（掉盆/弹跳/拖拽/碰撞）
 *   · 铁盆：吃掉米盆后掉出，可拖到她头上戴住（换冷脸），双击头部取下
 *   · 火控雷达目标名牌：绿括号 + 「白饭」+ 距离/接近率/相对高度 + 方向环，
 *     任一盆闲置满 10s → 全部锁定 → 1s 后磁吸，吸到身上即入账
 *
 * 定位模型沿用 dsh-whale-widget：四边四分之一吸附 + 锚点持久化 + 滚动条避让；
 * 吸附在右边缘时只镜像「美术」，文字靠重算仿射矩阵保持正向。
 *
 * 移植来源字面值（dsh_pet.ps1 行号）：
 *   平板四角 2527-2528 · 表情优先级 1973-1985 · 雷达读数 2106+ / 几何 2277-2460
 *   重力/弹性 1039-1040 · 空气阻力/滑动 1069-1075 · 弹跳档位 1104-1109
 *   掉盆 2660-2689 · 物理 3024-3165 · 喂食判定 3298-3330 · 进食 2740-2777
 *   爱心 2712-2733 / 3485-3499 · 铁盆 2844-2886 · 常量 857-918
 * =========================================================================== */
(function () {
  if (window.__dshVk1Widget) return
  window.__dshVk1Widget = true

  // A widget that dies silently is worse than one that complains — but the complaint has to
  // be OURS. Two rules keep that honest:
  //   · identity comes from document.currentScript at parse time, NOT from a hardcoded path.
  //     A path filter silently swallows every real error the day the widget is served from
  //     somewhere else — which would reintroduce exactly the silent death this exists for.
  //   · an error with no source at all is never attributed to us. The browser's own warnings
  //     (e.g. "ResizeObserver loop completed with undelivered notifications", which carries
  //     no script source) and cross-origin "Script error." land here.
  var SELF_SRC = ''
  try { SELF_SRC = (document.currentScript && document.currentScript.src) || '' } catch (e0) {}
  function isOurs(src) {
    var path = String(src || '').split('?')[0]
    if (!path) return false
    if (SELF_SRC) return path === String(SELF_SRC).split('?')[0]
    // Heuristic last resort, used only when currentScript is unavailable: any script whose
    // path ends in our route is treated as ours. It can in principle misattribute an
    // unrelated script served at the same path, which is why identity normally comes from
    // currentScript instead.
    return /dsh-vk1\/widget\.js$/.test(path)
  }
  function showFatal(text) {
    try {
      var existing = document.getElementById('dshvk1-fatal')
      if (existing) {
        // Keep the single box but do not swallow the new failure: show the latest message
        // plus how many have been seen. Stacking a box per error was the original bug.
        var n = (parseInt(existing.getAttribute('data-count') || '1', 10) || 1) + 1
        existing.setAttribute('data-count', String(n))
        existing.textContent = 'VK-1 widget error ×' + n + '（点击关闭）:\n' + text
        return
      }
      var d = document.createElement('div')
      d.id = 'dshvk1-fatal'
      d.setAttribute('data-count', '1')
      d.title = '点击关闭'
      d.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:2147483600;max-width:74vw;' +
        'background:#8d1111;color:#fff;font:16px/1.5 Consolas,monospace;padding:12px 14px;' +
        'border:2px solid #fff;border-radius:10px;white-space:pre-wrap;cursor:pointer'
      d.textContent = 'VK-1 widget error（点击关闭）:\n' + text
      d.addEventListener('click', function () {
        try { if (d.parentNode) d.parentNode.removeChild(d) } catch (e3) {}
      })
      document.body.appendChild(d)
    } catch (e2) {}
  }
  function onWidgetError(ev) {
    var src = String((ev && ev.filename) || '')
    var msg = String((ev && ev.message) || 'unknown')
    if (!isOurs(src)) return                      // not ours, or unattributable
    if (/ResizeObserver loop/i.test(msg)) return  // benign browser warning
    showFatal(msg + '   @' + (ev && ev.lineno) + ':' + (ev && ev.colno))
  }
  window.addEventListener('error', onWidgetError)

  var BASE = '/dsh-vk1'
  var EXPR_URL = {
    happy: BASE + '/expression_11.png',
    nervous: BASE + '/expression_22.png',
    aloof: BASE + '/expression_12.png',
    calm: BASE + '/expression_21.png',
  }
  var EXPR_ORDER = ['happy', 'nervous', 'aloof', 'calm']
  // 皮肤表。quad 是平板四角（左上/右上/右下/左下，1024 纹理空间）。
  // board: 'sprite' 表示平板已经画在立绘里（文字直接贴上去）；
  //        'rect'   表示立绘没有平板，由我们画一块圆角底板再写字。
  var SKINS = {
    vk1: {
      id: 'vk1',
      name: '\u63A7\u5236\u53F0\u539F\u751F',
      faces: {
        happy: BASE + '/expression_11.png',
        nervous: BASE + '/expression_22.png',
        aloof: BASE + '/expression_12.png',
        calm: BASE + '/expression_21.png',
      },
      quad: [549.6, 706.2, 949.7, 642.0, 984.7, 860.2, 584.6, 924.3],
      board: 'sprite',
    },
    dsniang: {
      id: 'dsniang',
      name: '\u84DD\u53D1\u5973\u4EC6',
      // 单图立绘：四表情共用一张（切换表情不再换图，但红闪/震动仍生效）
      faces: {
        happy: BASE + '/skin_dsniang1.png',
        nervous: BASE + '/skin_dsniang1.png',
        aloof: BASE + '/skin_dsniang1.png',
        calm: BASE + '/skin_dsniang1.png',
      },
      // 立绘 610×610，平板画在角色胸前偏右下：换算到 1024 纹理空间
      quad: [512, 760, 960, 700, 990, 900, 560, 950],
      // 这张立绘没有可贴字的手持板，改用「底部浮动徽章」显示余额
      board: 'badge',
    },
  }
  // 自定义立绘（用户上传）：四表情共用一张，用徽章模式显示余额
  var customSkinDb = null
  function openSkinDb(cb) {
    try {
      var req = indexedDB.open('dsh-vk1-sounds', 2)
      req.onupgradeneeded = function () {
        var db = req.result
        if (!db.objectStoreNames.contains('clips')) db.createObjectStore('clips', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('skins')) db.createObjectStore('skins', { keyPath: 'id' })
      }
      req.onsuccess = function () { customSkinDb = req.result; cb(customSkinDb) }
      req.onerror = function () { cb(null) }
    } catch (err) { cb(null) }
  }
  function saveCustomSkin(dataUrl, cb) {
    openSkinDb(function (db) {
      if (!db) { cb(false); return }
      try {
        var tx = db.transaction('skins', 'readwrite')
        tx.objectStore('skins').put({ id: 'custom', dataUrl: dataUrl, at: Date.now() })
        tx.oncomplete = function () { cb(true) }
        tx.onerror = function () { cb(false) }
      } catch (err) { cb(false) }
    })
  }
  function loadCustomSkin(cb) {
    openSkinDb(function (db) {
      if (!db) { cb(null); return }
      try {
        var get = db.transaction('skins', 'readonly').objectStore('skins').get('custom')
        get.onsuccess = function () { cb(get.result && get.result.dataUrl ? get.result.dataUrl : null) }
        get.onerror = function () { cb(null) }
      } catch (err) { cb(null) }
    })
  }
  // 上传前压一下：最长边 512，PNG 保留透明
  function shrinkImage(file, cb) {
    var reader = new FileReader()
    reader.onload = function () {
      var img = new Image()
      img.onload = function () {
        try {
          var maxSide = 512
          var sc = Math.min(1, maxSide / Math.max(img.width, img.height))
          var c = document.createElement('canvas')
          c.width = Math.max(1, Math.round(img.width * sc))
          c.height = Math.max(1, Math.round(img.height * sc))
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
          cb(c.toDataURL('image/png'))
        } catch (err) { cb(null) }
      }
      img.onerror = function () { cb(null) }
      img.src = String(reader.result || '')
    }
    reader.onerror = function () { cb(null) }
    reader.readAsDataURL(file)
  }

  function registerCustomSkin(dataUrl) {
    SKINS.custom = {
      id: 'custom',
      name: '\u81EA\u5B9A\u4E49',
      faces: { happy: dataUrl, nervous: dataUrl, aloof: dataUrl, calm: dataUrl },
      quad: [512, 760, 960, 700, 990, 900, 560, 950],
      board: 'badge',
    }
  }
  function skinOf(id) { return SKINS[id] || SKINS.vk1 }
  // 建 DOM 时 state 还没声明，这里直接读持久化的皮肤 id
  function bootSkinId() {
    try {
      var o = JSON.parse(localStorage.getItem(OPTIONS_KEY) || 'null')
      if (o && typeof o.skin === 'string' && SKINS[o.skin]) return o.skin
    } catch (err) {}
    return 'vk1'
  }
  var RICE_URL = BASE + '/rice.png'
  var IRON_URL = BASE + '/iron_bowl.png'
  var ironDrawUrl = ''
  var HIT_SOUND = BASE + '/hit.mp3'
  var FEED_SOUND = BASE + '/feed.mp3'
  // 单击角色的音效（小黄鸭挤压音），与其它槽分开，有单独的开关
  var CLICK_SOUND = BASE + '/duck_press.mp3'
  var BALANCE_URL = BASE + '/balance.json'

  // 音效包（素材来自 dsh-whale-widget 的 assets，MIT）：
  //   default —— 上游 VK-1 的四个音效
  //   duck    —— 小黄鸭：按下 Ya1 / 松开 Ya2（本插件里映射为「掉血 / 回血」）
  //   orb     —— Minecraft 经验球（掉血）+ 每轮消耗提示音（回血）
  var SOUND_PACKS = {
    default: {
      name: '\u63A7\u5236\u53F0\u539F\u751F',
      hit: HIT_SOUND, feed: FEED_SOUND,
      land: BASE + '/pot_land.mp3', off: BASE + '/pot_off.mp3', end: BASE + '/task_end.wav',
    },
    duck: {
      name: '\u5C0F\u9EC4\u9E2D',
      hit: BASE + '/duck_press.mp3', feed: BASE + '/duck_release.mp3',
      land: BASE + '/pot_land.mp3', off: BASE + '/pot_off.mp3', end: BASE + '/task_end.wav',
    },
    orb: {
      name: '\u7ECF\u9A8C\u7403',
      hit: BASE + '/orb.wav', feed: BASE + '/cost.wav',
      land: BASE + '/pot_land.mp3', off: BASE + '/pot_off.mp3', end: BASE + '/task_end.wav',
    },
    fx1: {
      name: '\u97F3\u6548\u7EC41',
      hit: BASE + '/fx1_press.mp3', feed: BASE + '/fx1_release.mp3',
      land: BASE + '/pot_land.mp3', off: BASE + '/pot_off.mp3', end: BASE + '/task_end.wav',
    },
  }

  // ---- constants ported from dsh_pet.ps1 ----
  // 扣费提示步长：默认每消耗 0.5 元提示一次；设置页可改成 0.01–100 元（两位小数）。
  var STEP_DEFAULT = 0.5
  var STEP_MIN = 0.01
  var STEP_MAX = 100
  function stepValue() {
    var v = Number(state && state.stepYuan)
    return isFinite(v) && v >= STEP_MIN ? Math.round(v * 100) / 100 : STEP_DEFAULT
  }
  var CUE_GAP = 0.2
  var MAX_CUES_PER_POLL = 40
  // 饭盆掉落：默认每 60 秒随机掉一盆（菜单里可自定义 5–3600 秒），
  // 位置在角色左上方、2 倍角色身高处。
  var DROP_INTERVAL_DEFAULT_S = 60
  var DROP_INTERVAL_MIN_S = 5
  var DROP_INTERVAL_MAX_S = 3600
  var DROP_DISTANCE_RATIO = 2
  var HIT_DUR = 0.55
  var FLOAT_DUR = 1.05
  var POLL_MS = 2000
  var FLASH_COLOR = '#ff3022'
  var CUE_FILL = 'rgb(255,72,60)'
  var CUE_EDGE = 'rgb(92,8,8)'
  var GAIN_FILL = 'rgb(58,220,90)'
  var GAIN_EDGE = 'rgb(8,85,28)'
  var RADAR_GREEN = 'rgb(0,255,8)'
  var LABEL_TEXT = 'DSH 余额'
  var RADAR_TYPE = '白饭'

  // tablet screen quad in sprite-texture pixels (1024), dsh_pet.ps1:2527-2528
  var QX = [549.6, 949.7, 984.7, 584.6]
  var QY = [706.2, 642.0, 860.2, 924.3]

  // 尺寸模型照搬 dsh-whale-widget：**连续缩放**，不是固定像素档。
  //   base = clamp(122px, min(250px, min(100vw,100vh) * 0.28) * scale, 625px)
  // scale 由菜单里的 1–20 级滑杆控制（0.6 – 2.5），窗口尺寸变化时按同一公式重算。
  // 尺寸整体缩到上一版的 2/3（用户反馈界面偏大），滑条上限从 20 级收到 10 级。
  var SIZE_SCALE_DOWN = 2 / 3
  var SCALE_MIN = 0.6
  // 最大尺寸收到上一版的一半：SCALE_MAX 2.5 → 1.25（最小仍 0.6，不动）
  var SCALE_MAX = 1.25
  var SCALE_STEP = 0.1
  var SCALE_STEPS = 10                     // 滑杆 1–10 级（上限与 SIZE_MAX_PX 同步收窄）
  var SIZE_MIN_PX = 122
  var SIZE_MAX_PX = Math.round(625 * (2 / 3) / 2)   // 209px：上限再砍一半
  var SIZE_BASE_RATIO = 0.28
  var SIZE_BASE_CAP = 250
  var DEFAULT_SCALE = 1

  var BOWL_WAIT = 10.0
  var LOCK_DELAY = 1.0
  var SUCK_ACCEL = 960.0
  var SUCK_MAX = 2400.0
  var GRAVITY = 2100.0
  var RESTITUTION = 0.5
  var AIR_DRAG = 0.30
  var SLIDE_FRICTION = 1.40
  var SLIDE_STOP = 14.0
  var HEAD_SQUASH_DUR = 0.5
  // 单击角色的「Q 弹」：一次短促的 squash + 轻微上跳，配合 boom 音效。
  var CLICK_JUMP_DUR = 0.42
  var IRON_TILT_DEG = -6.23
  var BOWL_W = 0.44
  var IRON_W_LOOSE = 0.44
  var IRON_W_WORN = 0.7391
  var IRON_H_WORN = 0.2629
  var BOWL_DIE = 0.14
  var IRON_FADE = 0.45
  var BTN_GRACE_MS = 1500

  var POS_KEY = 'dsh-vk1-pos'
  var SIZE_KEY = 'dsh-vk1-size'
  var GAP_KEY = 'dsh-vk1-gap'
  var SOUND_KEY = 'dsh-vk1-sound'
  var OPTIONS_KEY = 'dsh-vk1-options'

  function round4(v) { return Math.round(v * 10000) / 10000 }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v) }
  function amountText(v) { return String(Math.round(v * 10000) / 10000) }
  function fmt2(v) { return (Math.round(v * 100) / 100).toFixed(2) }
  function rnd(a, b) { return a + Math.random() * (b - a) }
  function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag) }

  // --------------------------------------------------------------- styles ---
  var CSS = [
    // The bowl/rice layer must sit above every other appearance — dsh-whale-widget
    // sets no z-index at all (auto), so any positive value wins — and above this
    // plugin's own character, because upstream paints the bowls AFTER the sprite.
    // overflow:hidden keeps the above-the-viewport spawn from scrolling the page.
    '.dshvk1-stage{position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:10001;overflow:hidden}',
    // transform-origin:0 0 is load-bearing. renderBowls() emits the FULL transform
    // chain itself, in upstream's order (translate -> rotate -> scale -> anchor
    // offset), so the Q-bounce grows from the bowl's bottom edge and a worn pot tilts
    // about its own art centre. Any other origin re-anchors that chain and the art
    // ends up off the floor.
    '.dshvk1-bowl{position:absolute;left:0;top:0;pointer-events:none;will-change:transform;transform-origin:0 0}',
    '.dshvk1-heart{position:absolute;left:0;top:0;pointer-events:none;will-change:transform,opacity}',
    // 气泡：左图右文，两栏都是独立盒；文字块 min-width:0 才不会把图片挤没
    '.dshvk1-bubble{display:flex;align-items:flex-start;gap:6px;position:absolute;transform:translate(-50%,-100%);' +
      'max-width:min(280px,64vw);padding:5px 9px;border-radius:9px;box-sizing:border-box;' +
      'background:rgba(20,28,46,.92);color:#eaf1ff;font:12px/1.45 system-ui,sans-serif;border:1px solid rgba(158,182,224,.45);' +
      'box-shadow:0 4px 14px rgba(0,0,0,.32);pointer-events:none;z-index:10005}',
    '.dshvk1-bubbletext{flex:1 1 auto;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}',
    '.dshvk1-radar{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible}',
    '.dshvk1-root{position:fixed;left:0;top:0;width:var(--dshvk1-s);height:var(--dshvk1-s);pointer-events:none;user-select:none;-webkit-user-select:none;z-index:9998;font-family:inherit;transition:left .16s ease,top .16s ease}',
    '.dshvk1-root.dshvk1-dragging{transition:none;cursor:grabbing}',
    '.dshvk1-body{position:absolute;left:0;top:0;width:100%;height:100%;transform-origin:50% 100%}',
    '.dshvk1-art{position:absolute;left:0;top:0;width:100%;height:100%;transform-origin:50% 50%;transition:transform .3s ease}',
    '.dshvk1-root.dshvk1-mirror .dshvk1-art{transform:scaleX(-1)}',
    // 手动翻转：叠加在镜像之上（镜像 + 翻转 = 正立）
    '.dshvk1-root.dshvk1-art-flip .dshvk1-art{transform:scaleX(-1)}',
    '.dshvk1-root.dshvk1-mirror.dshvk1-art-flip .dshvk1-art{transform:scaleX(1)}',
    '.dshvk1-face{position:absolute;left:0;top:0;width:100%;height:100%;display:block;pointer-events:none;-webkit-user-drag:none}',
    '.dshvk1-flash{position:absolute;left:0;top:0;width:100%;height:100%;background:' + FLASH_COLOR + ';opacity:0;pointer-events:none;' +
      '-webkit-mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-size:100% 100%;mask-repeat:no-repeat}',
    '.dshvk1-panel{position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;text-align:center}',
    // 无平板立绘（board: rect）：自己画一块深色圆角底板，文字放在板上
    '.dshvk1-root.dshvk1-board-badge .dshvk1-panel{background:linear-gradient(180deg,rgba(24,30,46,.95),rgba(10,14,24,.95));' +
      'border:1px solid rgba(120,140,180,.55);border-radius:9px;padding:4px 6px;box-sizing:border-box;' +
      'display:flex;flex-direction:column;align-items:center;gap:1px;box-shadow:0 4px 14px rgba(0,0,0,.45);position:absolute}',
    '.dshvk1-root.dshvk1-board-badge .dshvk1-label{position:static;height:auto;font-size:calc(var(--dshvk1-ph) * 0.34);opacity:.85}',
    '.dshvk1-root.dshvk1-board-badge .dshvk1-amount{position:static;top:auto;bottom:auto;left:auto;right:auto;padding:0;max-width:100%;overflow:hidden}',
    '.dshvk1-root.dshvk1-board-rect .dshvk1-panel{background:linear-gradient(180deg,rgba(24,30,46,.96),rgba(12,16,26,.96));' +
      'border:2px solid rgba(120,140,180,.55);border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,.45);box-sizing:border-box;' +
      'display:flex;flex-direction:column;justify-content:center;padding:6% 4%}',
    '.dshvk1-label{position:absolute;left:0;right:0;top:4%;height:26%;display:flex;align-items:center;justify-content:center;' +
      'font-size:calc(var(--dshvk1-ph) * 0.18);font-weight:700;letter-spacing:.02em;color:rgba(158,182,224,.92);' +
      'text-shadow:calc(var(--dshvk1-ph) * 0.005) calc(var(--dshvk1-ph) * 0.005) 0 rgba(0,0,0,.59);white-space:nowrap}',
    // 数字在平板内**垂直+水平居中**：满高 flex 居中，再用 margin-top 抵消标签占位。
    // 数字区：水平居中，垂直上移到平板中下部（原来偏下沿）
    '.dshvk1-amount{position:absolute;left:0;right:0;top:38%;bottom:0;display:flex;align-items:center;justify-content:center;' +
      'white-space:nowrap;transform:translateX(-12.5%)}',
    '.dshvk1-cur{font-size:calc(var(--dshvk1-ph) * 0.27);font-weight:700;color:rgba(158,184,230,.92);' +
      'text-shadow:calc(var(--dshvk1-ph) * 0.005) calc(var(--dshvk1-ph) * 0.005) 0 rgba(0,0,0,.63)}',
    '.dshvk1-num{font-size:calc(var(--dshvk1-ph) * 0.48);font-weight:800;color:#f0f6ff;line-height:1;' +
      'text-shadow:calc(var(--dshvk1-ph) * 0.005) calc(var(--dshvk1-ph) * 0.005) 0 rgba(0,0,0,.63)}',
    '.dshvk1-floater{position:absolute;left:0;top:0;font-weight:800;white-space:nowrap;pointer-events:none;transform-origin:0 0;font-family:Arial,sans-serif}',
    '.dshvk1-dot{position:absolute;border-radius:50%;background:rgba(228,62,52,.92);border:1px solid rgba(255,255,255,.82);display:none;pointer-events:none}',
    '.dshvk1-btn{position:absolute;top:4px;right:4px;width:26px;height:26px;border:none;border-radius:7px;background:rgba(32,49,112,.86);color:#fff;' +
      'font-size:16px;line-height:1;cursor:pointer;padding:0;pointer-events:none;opacity:0;transition:opacity .15s ease;z-index:2}',
    '.dshvk1-btn.dshvk1-btn-on{opacity:1;pointer-events:auto}',
    '.dshvk1-root.dshvk1-mirror .dshvk1-btn{left:auto;right:4px}',
    '.dshvk1-btn:hover{background:#203170}',
    '.dshvk1-menu{position:fixed;min-width:206px;max-width:min(260px,calc(100vw - 8px));max-height:82vh;overflow:auto;background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(32,49,112,.35));' +
      'border-radius:9px;padding:4px;box-shadow:0 8px 24px rgba(0,0,0,.18);z-index:10002;display:none;color-scheme:light dark}',
    '.dshvk1-menu.dshvk1-menu-open{display:block}',
    '.dshvk1-menu-row{display:block;width:100%;text-align:left;padding:3px 7px;border:none;border-radius:6px;background:transparent;' +
      'color:var(--dsw-alias-label-primary,#203170);font-size:12px;cursor:pointer;white-space:nowrap;box-sizing:border-box;font-family:inherit;line-height:1.5}',
    '.dshvk1-menu-row:hover{background:var(--dsw-alias-bg-layer-2,rgba(32,49,112,.08))}',
    '.dshvk1-menu-row-flex{display:flex;align-items:center;justify-content:space-between;gap:10px}',
    '.dshvk1-menu-sep{height:1px;background:var(--dsw-alias-border-l1,rgba(32,49,112,.25));margin:5px 2px}',
    '.dshvk1-menu-cap{padding:4px 10px 2px;font-size:11px;color:var(--dsw-alias-label-secondary,#7b86a6);letter-spacing:.03em}',
    '.dshvk1-menu-grid{display:flex;flex-wrap:wrap;gap:4px;padding:0 6px 2px}',
    '.dshvk1-menu-chip{flex:0 0 auto;padding:3px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(32,49,112,.35));' +
      'background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,#203170);font-size:11.5px;cursor:pointer;font-family:inherit}',
    '.dshvk1-menu-chip:hover{background:var(--dsw-alias-bg-layer-2,rgba(32,49,112,.14))}',
    '.dshvk1-menu-chip.dshvk1-chip-on{border-color:var(--dsw-alias-brand-primary,#203170);font-weight:700}',
    '.dshvk1-menu-num{width:56px;border:1px solid var(--dsw-alias-border-l2,rgba(32,49,112,.4));border-radius:6px;padding:2px 5px;' +
      'font-size:11.5px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#203170);box-sizing:border-box;font-family:inherit}',
    '.dshvk1-menu-num:disabled{opacity:.4;cursor:not-allowed}',
    '.dshvk1-menu-unit{font-size:11px;color:var(--dsw-alias-label-secondary,#7b86a6)}',
  ].join('\n')

  var styleEl = document.createElement('style')
  styleEl.textContent = CSS
  document.head.appendChild(styleEl)

  // ------------------------------------------------------------------ DOM ---
  // Bowls / hearts / radar live in VIEWPORT coordinates (the pet's window was
  // screen-sized for the same reason), so they do not move with the widget.
  var stage = document.createElement('div')
  stage.className = 'dshvk1-stage'
  var radarSvg = svgEl('svg')
  radarSvg.setAttribute('class', 'dshvk1-radar')
  stage.appendChild(radarSvg)
  document.body.appendChild(stage)

  var root = document.createElement('div')
  root.className = 'dshvk1-root'
  var body = document.createElement('div')
  body.className = 'dshvk1-body'
  var art = document.createElement('div')
  art.className = 'dshvk1-art'

  var faces = {}
  var flashes = {}
  EXPR_ORDER.forEach(function (key) {
    var im = document.createElement('img')
    im.className = 'dshvk1-face'
    im.src = skinOf(bootSkinId()).faces[key]
    im.alt = LABEL_TEXT
    im.draggable = false
    im.style.display = key === 'happy' ? 'block' : 'none'
    art.appendChild(im)
    faces[key] = im

    var fl = document.createElement('div')
    fl.className = 'dshvk1-flash'
    fl.style.webkitMaskImage = 'url(' + skinOf(bootSkinId()).faces[key] + ')'
    fl.style.maskImage = 'url(' + skinOf(bootSkinId()).faces[key] + ')'
    fl.style.display = key === 'happy' ? 'block' : 'none'
    art.appendChild(fl)
    flashes[key] = fl
  })

  var panel = document.createElement('div')
  panel.className = 'dshvk1-panel'
  var labelEl = document.createElement('div')
  labelEl.className = 'dshvk1-label'
  labelEl.textContent = LABEL_TEXT
  var amountEl = document.createElement('div')
  amountEl.className = 'dshvk1-amount'
  var curEl = document.createElement('span')
  curEl.className = 'dshvk1-cur'
  curEl.textContent = '\u00A5'
  var numEl = document.createElement('span')
  numEl.className = 'dshvk1-num'
  numEl.textContent = '--'
  amountEl.appendChild(curEl)
  amountEl.appendChild(numEl)
  panel.appendChild(labelEl)
  panel.appendChild(amountEl)

  var dot = document.createElement('div')
  dot.className = 'dshvk1-dot'

  body.appendChild(art)
  body.appendChild(panel)
  body.appendChild(dot)
  root.appendChild(body)

  var btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'dshvk1-btn'
  btn.title = '菜单'
  btn.textContent = '\u22EF'
  root.appendChild(btn)

  var menu = document.createElement('div')
  menu.className = 'dshvk1-menu'

  document.body.appendChild(root)
  document.body.appendChild(menu)

  // ----------------------------------------------------------------- state ---
  var state = {
    size: 250,          // 由 scale 与视口算出来，见 applySize()
    scale: DEFAULT_SCALE,
    radarOn: true,
    dropIntervalSec: DROP_INTERVAL_DEFAULT_S,
    real: NaN,
    bookedAt: NaN,
    bookedBal: NaN,
    creditPending: 0,
    pending: 0,
    pendingStep: 0,
    dueGap: 0,
    demoLeft: 0,
    demoAmount: STEP_DEFAULT,
    stepYuan: STEP_DEFAULT,
    hits: [],
    floaters: [],
    hearts: [],
    bowls: [],
    expr: 'happy',
    bowlWait: 0,
    lockAll: false,
    lockT: 0,
    radarManual: false,
    headSquashT: HEAD_SQUASH_DUR,
    clickJumpT: CLICK_JUMP_DUR,   // >= DUR 表示没有正在播放的单击弹跳
    lastHeadClick: null,
    connected: false,
    soundOn: true,
    volume: 80,
    h: 'right', hOff: 0,
    v: 'bottom', vOff: 0,
    flip: false,
    left: 0, top: 0,
    scrollGapOn: false,
    scrollGapPx: 17,
    dragWidget: null,
    grab: null,
    menuOpen: false,
    fxBowl: true, fxPat: true, fxHurt: true,
    soundPack: 'default',
    skin: 'vk1',
    clickSoundOn: true,
    autoIronOnFeed: true,
    idleBubbleOn: true,
    idleWords: [],
    cueSrc: [],
    bubbleOn: true,
    bubbleGifOn: true,
    reminders: ["\u672C\u8F6E \u00A5{cost}", "\u8FD9\u4E00\u8F6E\u82B1\u4E86 \u00A5{cost}\uFF0C\u5979\u5F88\u5F00\u5FC3", "\u5E10\u5355\u62A5\u544A\uFF1A\u00A5{cost}"],
    lastTurnSeq: 0,
    turnCost: 0,
    theme: 'auto',
    cueVolumes: [100, 100, 100, 100, 100, 100],
    usage: null,
    hostVersion: '',
    lastTabletClick: null,
  }

  function scaleOf() { return state.size / 1024 }
  function mirrored() { return state.flip }
  function headXLocal() { return state.size * (mirrored() ? 0.33 : 0.67) }
  function headYLocal() { return state.size * 0.36 }
  function headScreen() { return { x: state.left + headXLocal(), y: state.top + headYLocal() } }
  function floaterStep() { return Math.max(18, 34 * scaleOf() * 1.7) }
  function drawnBalance() {
    if (!isFinite(state.bookedBal)) return NaN
    return Math.round((state.bookedBal < 0 ? 0 : state.bookedBal) * 100) / 100
  }

  // ------------------------------------------------------- layout / screen ---
  function quad() {
    var sc = scaleOf()
    var q = skinOf(state.skin).quad
    var P = []
    for (var i = 0; i < 4; i++) P.push({ x: q[i * 2] * sc, y: q[i * 2 + 1] * sc })
    var lw = Math.sqrt(Math.pow(P[1].x - P[0].x, 2) + Math.pow(P[1].y - P[0].y, 2))
    var lh = Math.sqrt(Math.pow(P[3].x - P[0].x, 2) + Math.pow(P[3].y - P[0].y, 2))
    return { P: P, lw: lw, lh: lh }
  }

  function layout() {
    root.style.setProperty('--dshvk1-s', state.size + 'px')
    var flip = mirrored()
    root.classList.toggle('dshvk1-mirror', flip)
    var q = quad()
    var P = q.P
    if (q.lw < 8 || q.lh < 8) return
    var pw = 520
    var ph = Math.max(24, Math.round(pw * (q.lh / q.lw)))
    var a = (P[1].x - P[0].x) / pw
    var b = (P[1].y - P[0].y) / pw
    var c = (P[3].x - P[0].x) / ph
    var d = (P[3].y - P[0].y) / ph
    // Mirrored: the artwork flipped about the widget centre, so map the panel onto
    // the mirrored quad instead of flipping the glyphs (det stays positive).
    var m = flip ? [a, -b, -c, d, state.size - P[1].x, P[1].y] : [a, b, c, d, P[0].x, P[0].y]
    var board = skinOf(state.skin).board
    if (board === 'badge') {
      // 浮动徽章：宽度 62% 角色宽、贴底居中；高度按内容撑开
      var bw = Math.round(state.size * 0.62)
      panel.style.width = bw + 'px'
      panel.style.height = 'auto'
      panel.style.setProperty('--dshvk1-ph', String(Math.round(bw * 0.52)) + 'px')
      panel.style.transform = 'none'
      panel.style.left = Math.round((state.size - bw) / 2) + 'px'
      panel.style.top = 'auto'
      panel.style.bottom = Math.round(state.size * 0.02) + 'px'
    } else {
      panel.style.width = pw + 'px'
      panel.style.height = ph + 'px'
      panel.style.setProperty('--dshvk1-ph', ph + 'px')
      panel.style.transform = 'matrix(' + m.join(',') + ')'
      panel.style.left = ''
      panel.style.top = ''
      panel.style.bottom = ''
    }
    var r = Math.max(2.5, state.size * 0.032)
    var cx = (P[1].x + P[2].x) / 2
    if (flip) cx = state.size - cx
    var cy = (P[1].y + P[2].y) / 2 + state.size * 0.05
    dot.style.width = (r * 2) + 'px'
    dot.style.height = (r * 2) + 'px'
    dot.style.left = (cx - r) + 'px'
    dot.style.top = (cy - r) + 'px'
  }

  // ---------------------------------------------------------------- bubbles ---
  // 气泡：挂在角色上方的一条胶囊，显示「本轮消耗」「提醒词」等一句话。
  // 队列式（最多 3 条排队），单条 3.2s 自动淡出；DOM 在 stage 里，位置跟随角色。
  var bubbleEl = document.createElement('div')
  bubbleEl.className = 'dshvk1-bubble'
  bubbleEl.style.display = 'none'
  var bubbleTextEl = document.createElement('span')
  bubbleTextEl.className = 'dshvk1-bubbletext'
  bubbleEl.appendChild(bubbleTextEl)
  var bubbleGifEl = document.createElement('img')
  bubbleGifEl.className = 'dshvk1-bubblegif'
  bubbleGifEl.alt = ''
  bubbleGifEl.draggable = false
  // 取不到图就别留空位（旧版是 display:none 但被 flex 撑开）
  bubbleGifEl.addEventListener('error', function () { bubbleGifEl.classList.remove('dshvk1-gif-on') })
  bubbleEl.appendChild(bubbleGifEl)
  stage.appendChild(bubbleEl)
  // 两条通道：cost = 消耗/余额提示；idle = 自动冒词。互不覆盖，cost 优先。
  var bubbleQueue = []      // cost 通道
  var idleQueue = []        // idle 通道
  var bubbleShownT = 0
  var bubbleText = ''
  var bubbleChannel = ''    // 当前正在显示的是哪条通道
  var BUBBLE_DUR = 3.2
  var idleCoolDown = 18 + Math.random() * 20   // 自动冒词的冷却（秒），首条也要等一会儿
  function showBubble(text, force, channel) {
    var t = String(text == null ? '' : text).trim()
    if (!t) return
    if (!force && !state.bubbleOn) return
    var ch = channel === 'idle' ? 'idle' : 'cost'
    if (ch === 'idle' && state.idleBubbleOn === false) return
    var q = ch === 'idle' ? idleQueue : bubbleQueue
    if (bubbleText === t && bubbleChannel === ch && bubbleShownT < BUBBLE_DUR * 0.6) return
    if (q.length >= 3) q.shift()
    q.push(t)
  }
  function tickBubble(dt) {
    if (bubbleText) {
      bubbleShownT += dt
      if (bubbleShownT >= BUBBLE_DUR) { bubbleText = ''; bubbleEl.style.display = 'none' }
    }
    // 先进先出：cost 通道优先，空了才轮到 idle 通道
    var nextQueue = bubbleQueue.length ? bubbleQueue : (idleQueue.length ? idleQueue : null)
    var nextChannel = bubbleQueue.length ? 'cost' : 'idle'
    if (!bubbleText && nextQueue) {
      bubbleText = nextQueue.shift()
      bubbleChannel = nextChannel
      bubbleShownT = 0
      bubbleTextEl.textContent = bubbleText
      // 装饰动图只在「自动冒词」通道出现：消耗/余额句一律纯文字，避免图文混杂。
      var wantGif = state.bubbleGifOn !== false && bubbleChannel === 'idle'
      if (wantGif) {
        var gif = BASE + '/bubble_petpet.gif'
        if (bubbleGifEl.getAttribute('src') !== gif) bubbleGifEl.setAttribute('src', gif)
        bubbleGifEl.classList.add('dshvk1-gif-on')
      } else {
        bubbleGifEl.classList.remove('dshvk1-gif-on')
      }
      bubbleEl.style.display = 'block'
    }
    // 自动冒词：等气泡空出来再开口
    if (!bubbleText && state.idleBubbleOn !== false) {
      idleCoolDown -= dt
      if (idleCoolDown <= 0) {
        showBubble(pickIdleWord(), false, 'idle')
        armIdleBubble()
      }
    }
    if (!bubbleText) return
    var cx = state.left + state.size / 2
    var top = Math.max(2, state.top - 6)
    bubbleEl.style.left = Math.round(cx) + 'px'
    bubbleEl.style.top = Math.round(top) + 'px'
    var fade = bubbleShownT > BUBBLE_DUR - 0.5 ? Math.max(0, (BUBBLE_DUR - bubbleShownT) / 0.5) : 1
    bubbleEl.style.opacity = String(fade)
  }
  // 提醒词：一行一条，可用 {cost} 占位符；轮转播放，避免每次都同一句
  var remindIndex = 0
  // 自动冒词（来自 dsh-whale-widget 的 RANDOM_GROUPS，MIT；按权重抽取）
  var IDLE_WORDS = [
    { w: 7, lines: ['\u597D\u6A21\u578B... \u2193', '\u597D\u5973\u5B69...\u2193'] },
    { w: 7, lines: [
      '\u4E0D\u77E5\u9053\u7528\u6237\u6709\u4EC0\u4E48\u7528\uFF0C\u5148\u8D76\u8D70\u5427~',
      '\u6211...\u6211...\u6211\u4E5F\u8981\u6323\u94B1\u5417\uFF1F',
      '\u6211\u53BB\u5403\u996D\u5566\uFF0C\u6D4B\u5B8C\u53EB\u6211',
      '\u538B\u529B\u4E00\u53EA\u84DD\u8272\u5927\u80A5\u9C7C\uFF1F\uFF01',
      'DeepSleep...',
      '\u574F\u4E86...\u7528\u6237\u5F7B\u5E95\u6012\u4E86\uFF01',
    ] },
    { w: 3, lines: [
      '\u4F60\u76EE\u5F55\u91CC\u7684dsh\u662F\u4EC0\u4E48...\u5927\u70E7\u8D27\u5417...?',
      '\u606D\u559C\u4F60\u5B9E\u73B0token\u81EA\u7531\uFF01token\u5168\u8DD1\u4E86\uFF01',
      '\u771F\u5F53\u6211\u662F\u4FBF\u5B9C\u8D27\u554A...',
    ] },
    { w: 1, lines: ['\u54E6\u9CB8\u9CB8... '] },
  ]
  function pickIdleWord() {
    // 用户自定义过就用自定义词表，否则用内置那套加权词
    if (Array.isArray(state.idleWords) && state.idleWords.length) {
      return state.idleWords[Math.floor(Math.random() * state.idleWords.length)]
    }
    var total = 0
    for (var i = 0; i < IDLE_WORDS.length; i++) total += IDLE_WORDS[i].w
    var r = Math.random() * total
    for (var j = 0; j < IDLE_WORDS.length; j++) {
      r -= IDLE_WORDS[j].w
      if (r < 0) return IDLE_WORDS[j].lines[Math.floor(Math.random() * IDLE_WORDS[j].lines.length)]
    }
    return IDLE_WORDS[0].lines[0]
  }
  // 自动冒词节奏：20–45 秒随机一次（太密会盖住消耗提示）
  function armIdleBubble() {
    idleCoolDown = 20 + Math.random() * 25
  }
  function pickReminder(costText) {
    var list = Array.isArray(state.reminders) && state.reminders.length ? state.reminders : []
    if (!list.length) return ''
    var line = list[remindIndex % list.length]
    remindIndex++
    return String(line).replace(/\{cost\}/g, costText || '')
  }

  // --------------------------------------------------------------- sounds ---
  function makePool(url, n) {
    var pool = []
    for (var i = 0; i < n; i++) {
      try {
        var a = new Audio(url)
        a.preload = 'auto'
        pool.push(a)
      } catch (err) {}
    }
    return { pool: pool, idx: 0, cue: 0 }
  }
  var hitPool = null
  var feedPool = null
  var landPool = null
  var offPool = null
  var endPool = null
  var clickPool = null
  // cuePools 的槽位顺序固定：0 掉血 / 1 回血 / 2 铁盆落头 / 3 双击取盆 / 4 任务结束 / 5 单击
  var cuePools = []
  function currentPack() { return SOUND_PACKS[state.soundPack] || SOUND_PACKS.default }
  // 切换音效包：重建四个池（掉血 / 回血 / 铁盆落头 / 取盆），并保留分项音量。
  // 每个音效槽的默认音频。cueSrc（用户为单个槽选过的音源）优先。
  function defaultCueSrcs() {
    var pack = currentPack()
    return [pack.hit, pack.feed, pack.land, pack.off, pack.end || (BASE + '/task_end.wav'), CLICK_SOUND]
  }
  // 重建全部槽位。cueSrcs 允许只覆盖部分槽。
  function rebuildPools(cueSrcs) {
    try { cuePools.forEach(function (p) { stopPool(p) }) } catch (err) {}
    var base = defaultCueSrcs()
    var srcs = base.map(function (def, i) {
      var custom = cueSrcs && cueSrcs[i] ? String(cueSrcs[i]) : ''
      return custom || def
    })
    hitPool = makePool(srcs[0], 4)
    feedPool = makePool(srcs[1], 2)
    landPool = makePool(srcs[2], 2)
    offPool = makePool(srcs[3], 2)
    endPool = makePool(srcs[4], 2)
    clickPool = makePool(srcs[5], 2)
    feedPool.cue = 1; landPool.cue = 2; offPool.cue = 3; endPool.cue = 4; clickPool.cue = 5
    cuePools = [hitPool, feedPool, landPool, offPool, endPool, clickPool]
    state.cueSrc = srcs.map(function (x, i) { return (cueSrcs && cueSrcs[i]) || '' })
    return srcs
  }
  // 兼容旧调用：切换「默认音效池」（用户自定义过源时保留自定义）
  function applySoundPack(packId) {
    state.soundPack = SOUND_PACKS[packId] ? packId : 'default'
    rebuildPools(state.cueSrc || null)
    saveOptions()
  }
  // 给单个槽换源（src='' 表示回到默认）
  function setCueSource(cue, src) {
    var cur = (state.cueSrc || []).slice()
    while (cur.length < 6) cur.push('')
    cur[cue] = src || ''
    rebuildPools(cur)
    saveOptions()
  }
  // 同一音效的最小间隔：一次大额扣费会连拍结算，不节流就会变成一串连响。
  var CUE_SOUND_GAP_MS = 700
  var lastSoundAt = {}
  function playPool(p) {
    if (!state.soundOn || state.volume <= 0 || !p.pool.length || stopped) return
    var nowMs = Date.now()
    var cueKey = String(p && p.cue != null ? p.cue : 'x')
    if (lastSoundAt[cueKey] && nowMs - lastSoundAt[cueKey] < CUE_SOUND_GAP_MS) return
    lastSoundAt[cueKey] = nowMs
    try {
      var a = p.pool[p.idx++ % p.pool.length]
      a.volume = state.volume / 100 * state.cueVolumes[p.cue] / 100
      a.currentTime = p.clip ? p.clip.start : 0
      clearTimeout(a.trimTimer)
      if (p.clip) a.trimTimer = setTimeout(function () { a.pause() }, (p.clip.end - p.clip.start) * 1000)
      var r = a.play()
      if (r && typeof r.catch === 'function') r.catch(function () {})
    } catch (err) {}
  }

  // -------------------------------------------------------------- floaters ---
  function spawnFloater(text, x, y, gain) {
    var em = Math.max(13, 34 * scaleOf())
    var el = document.createElement('div')
    el.className = 'dshvk1-floater'
    el.textContent = text
    el.style.fontSize = em + 'px'
    el.style.color = gain ? GAIN_FILL : CUE_FILL
    el.style.textShadow = '1px 1px 0 ' + (gain ? GAIN_EDGE : CUE_EDGE)
    stage.appendChild(el)
    state.floaters.push({ T: 0, x: x, y: y, jitter: 7 * scaleOf(), tw: el.offsetWidth || 0, gain: !!gain, el: el })
    if (state.floaters.length > 20) {
      var old = state.floaters.shift()
      if (old.el && old.el.parentNode) old.el.parentNode.removeChild(old.el)
    }
  }

  // 演示与真实扣费共用这一个动画入口。fromTest 不再改动任何账面数值：
  // 演示只播红闪 / 震动 / 飘字 / 音效，平板上的数字保持不动。
  function makeTick(amount, fromTest) {
    if (!state.fxHurt) return
    if (state.hits.length < 3) state.hits.push({ T: 0 })

    var trail = 0
    for (var i = 0; i < state.floaters.length; i++) if (state.floaters[i].T < 0.5) trail++
    if (trail > 3) trail = 3

    var h = headScreen()
    spawnFloater('-' + amountText(amount),
      h.x - state.size * 0.06,
      h.y - Math.round(trail * floaterStep()),
      false)
    playPool(hitPool)
  }

  // --------------------------------------------------------------- hearts ---
  function heartEl(size) {
    var el = document.createElement('div')
    el.className = 'dshvk1-heart'
    el.style.width = size + 'px'
    el.style.height = size + 'px'
    el.innerHTML =
      '<svg viewBox="0 0 16 16" width="100%" height="100%" aria-hidden="true">' +
      '<path d="M2 5h3V3h3V2h3v1h3v3h-1v2h-1v1h-1v1h-1v1h-1v1H9v-1H8v-1H7V9H6V8H5V7H4V5H2z" ' +
      'fill="#ff5f8d" stroke="#8e1240" stroke-width="0.7"/></svg>'
    return el
  }
  function spawnHearts(cx, cy) {
    var n = 5 + Math.floor(Math.random() * 3)
    for (var i = 0; i < n; i++) {
      var size = Math.round(Math.max(14, state.size * (0.090 + 0.050 * Math.random())))
      var el = heartEl(size)
      stage.appendChild(el)
      state.hearts.push({
        T: 0,
        Dur: 0.75 + Math.random() * 0.35,
        x: cx + rnd(-state.size / 8, state.size / 8),
        y: cy - rnd(0, state.size / 12),
        phase: Math.random() * 6.283,
        drift: (Math.random() - 0.5) * 36.0,
        el: el,
      })
    }
  }

  // ----------------------------------------------------------------- bowls ---
  function bouncesForDrop(dropPx) {
    if (dropPx < 60) return 0
    if (dropPx < 260) return 1
    if (dropPx < 700) return 2
    return 3
  }
  function viewportRect() {
    return {
      left: 0,
      top: 0,
      right: window.innerWidth || document.documentElement.clientWidth || 1280,
      bottom: window.innerHeight || document.documentElement.clientHeight || 800,
    }
  }
  function bowlEl(url, width, height) {
    var el = document.createElement('img')
    el.className = 'dshvk1-bowl'
    el.src = url === IRON_URL && ironDrawUrl ? ironDrawUrl : url
    if (url === IRON_URL && !potArtReady) el.style.visibility = 'hidden'
    el.draggable = false
    el.style.width = Math.max(8, Math.round(width)) + 'px'
    el.style.height = Math.max(8, Math.round(height)) + 'px'
    stage.appendChild(el)
    return el
  }
  function ironLooseSize() {
    var w = Math.max(24, Math.round(state.size * IRON_W_LOOSE))
    return { w: w, h: Math.max(8, Math.round(w * (IRON_H_WORN / IRON_W_WORN))) }
  }
  function ironWornSize() {
    return { w: Math.max(24, Math.round(state.size * IRON_W_WORN)), h: Math.max(8, Math.round(state.size * IRON_H_WORN)) }
  }
  var riceSizeCache = null
  function riceDims() {
    if (!riceSizeCache || riceSizeCache.size !== state.size) {
      var w = Math.max(24, Math.round(state.size * BOWL_W))
      riceSizeCache = { size: state.size, w: w, h: w }
    }
    return riceSizeCache
  }

  function newBowl(fields) {
    var base = {
      iron: false, fed: false, dieT: 0, amount: 0,
      artW: 40, artH: 40, url: RICE_URL, R: 17,
      X: 0, Y: 0, VX: 0, VY: 0, rot: 0,
      bounces: 0, maxBounces: 0,
      grounded: false, dragging: false, beingSucked: false, suckSpeed: 0,
      onHead: false, headFalling: false, headY: 0, headTarget: 0, fadeT: 0, headT: 0,
      sampleVX: 0, sampleVY: 0, el: null,
    }
    for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) base[k] = fields[k]
    base.el = bowlEl(base.url, base.artW, base.artH)
    state.bowls.push(base)
    return base
  }

  // 落点：角色左上方，距离 = 2 倍角色身高（DROP_DISTANCE_RATIO × size），
  // 再夹进视口内，避免盆生在屏幕外看不见。
  function dropPoint() {
    var vs = viewportRect()
    var d = riceDims()
    var r = d.w * 0.42
    var dist = state.size * DROP_DISTANCE_RATIO
    return {
      x: clamp(state.left - dist, vs.left + r, Math.max(vs.left + r, vs.right - r - 1)),
      y: clamp(state.top - dist, vs.top + r * 0.5, Math.max(vs.top + r * 0.5, vs.bottom - r * 3)),
    }
  }

  // 统一的掉盆入口：amount 只决定「喂下去之后记多少账」；演示盆永远不改数字。
  function spawnRiceBowl(amount, demo) {
    var d = riceDims()
    var r = d.w * 0.42
    var pt = dropPoint()
    var vs = viewportRect()
    newBowl({
      amount: isFinite(amount) ? amount : 0,
      demo: !!demo,
      artW: d.w, artH: d.h, url: RICE_URL, R: r,
      X: pt.x, Y: pt.y,
      VX: rnd(-40, 40), VY: 30,
      maxBounces: bouncesForDrop(Math.max(0, vs.bottom - pt.y)),
      el: null,
    })
  }

  // 真实充值：只累积 creditPending，**不再立刻掉盆** —— 盆只由 60 秒周期掉落产生，
  // 喂下去的那一刻才把待入账金额记进平板。关闭掉盆功能则直接入账。
  function startCredit(amount, demo) {
    if (!isFinite(amount) || amount <= 0) return
    if (demo) { spawnRiceBowl(0, true); return }
    state.creditPending = round4(state.creditPending + amount)
    if (!state.fxBowl) {
      applyCredit(amount)
      state.creditPending = Math.max(0, round4(state.creditPending - amount))
      updateScreen()
      return
    }
    // 场上已经有盆：把待入账金额挂到最近那盆上，别再叠加新盆。
    for (var i = state.bowls.length - 1; i >= 0; i--) {
      var b = state.bowls[i]
      if (!b.iron && !b.fed && !b.demo) { b.amount = round4(b.amount + amount); return }
    }
  }

  // 每 60 秒随机掉一盆：位置在角色左上方 2 倍身高处（dropPoint）。场上已有未喂的
  // 饭盆时跳过这一轮，避免堆一屏。
  function dropTick() {
    if (stopped || !state.fxBowl) return
    for (var i = 0; i < state.bowls.length; i++) {
      var b = state.bowls[i]
      if (!b.iron && !b.fed) return
    }
    spawnRiceBowl(state.creditPending, false)
  }

  function dropIronPot(x, y) {
    var d = ironLooseSize()
    var floor = viewportRect().bottom
    newBowl({
      iron: true,
      artW: d.w, artH: d.h, url: IRON_URL, R: d.w * 0.42,
      X: x, Y: y,
      maxBounces: bouncesForDrop(Math.max(0, floor - y)),
      el: null,
    })
  }

  function applyCredit(delta) {
    if (!(delta > 1e-9)) return
    state.bookedAt = round4(state.bookedAt + delta)
    state.bookedBal = round4(state.bookedBal + delta)
  }

  function onRiceFed(bowl) {
    if (bowl.fed) return
    bowl.fed = true
    bowl.dieT = 0
    bowl.dragging = false
    if (state.grab && state.grab.bowl === bowl) { state.grab = null; removeDragListeners() }
    var h = headScreen()
    spawnHearts(h.x, state.top + state.size * 0.20)
    playPool(feedPool)

    var haveFigures = isFinite(state.real) && isFinite(state.bookedBal)
    var shortfall = haveFigures ? Math.max(0, Math.round((state.real - state.bookedBal) * 100) / 100) : 0
    var owed = Math.max(state.creditPending, shortfall)
    var gain = bowl.demo ? bowl.amount : Math.min(bowl.amount, owed)
    if (gain <= 1e-9) gain = owed
    if (gain > 1e-9) {
      // 演示盆只表示「这里会有一笔入账」，不真正改数字；真实盆才记账。
      if (!bowl.demo) {
        applyCredit(gain)
        state.creditPending = Math.max(0, round4(state.creditPending - gain))
      }
      spawnFloater('+' + fmt2(gain), h.x - state.size * 0.06, h.y - Math.round(2 * floaterStep()), true)
    }
    if (state.radarOn && state.autoIronOnFeed !== false) {
      // 雷达磁吸把盆送进嘴里 → 铁盆直接扣在头上（不用再等它自己落到头顶）。
      dropIronPot(state.left + state.size * 0.5558, state.top + state.size * 0.20)
      var fresh = state.bowls[state.bowls.length - 1]
      if (fresh && fresh.iron && !fresh.onHead) attachIronPot(fresh)
    } else {
      dropIronPot(bowl.X, bowl.Y)
    }
    // The original marks the canvas dirty on a credit; the readout must show the
    // money on this frame, not whenever the next cue happens to repaint it.
    updateScreen()
  }

  function charHitAt(x, y) {
    // Feed test uses the character's per-pixel alpha, exactly like RiceOnGirl.
    if (!hitCanvas || !hitReady) return false
    var w = state.size
    var lx = x - state.left
    var ly = y - state.top
    if (lx < 0 || ly < 0 || lx >= w || ly >= w) return false
    if (mirrored()) lx = w - lx
    try {
      var data = hitCanvas.getContext('2d').getImageData(
        Math.min(609, Math.max(0, Math.floor(lx / w * 610))),
        Math.min(609, Math.max(0, Math.floor(ly / w * 610))), 1, 1).data
      return data[3] > 8
    } catch (err) {
      return false
    }
  }
  function riceOnGirl(bowl) {
    var hw = bowl.artW / 2
    var r = hw * 0.45
    var r2 = r * r
    var need = Math.max(3, Math.round(r * 0.35))
    var hit = 0
    var x0 = Math.round(bowl.X - hw)
    var x1 = Math.round(bowl.X + hw)
    var y0 = Math.round(bowl.Y - hw)
    var y1 = Math.round(bowl.Y + hw)
    for (var y = y0; y <= y1; y += 2) {
      var dy = y - bowl.Y
      for (var x = x0; x <= x1; x += 2) {
        var dx = x - bowl.X
        if (dx * dx + dy * dy > r2) continue
        if (charHitAt(x, y)) { hit += 4; if (hit >= need) return true }
      }
    }
    return false
  }

  function ironAnchorX() { return state.left + state.size * (mirrored() ? (1 - 0.5558) : 0.5558) }
  var wornSequence = 0
  function ironStackIndex(p) {
    var index = 0
    for (var i = 0; i < state.bowls.length; i++) {
      var r = state.bowls[i]
      if (r !== p && r.iron && r.onHead && r.wornOrder < p.wornOrder) index++
    }
    return index
  }
  function ironHeadAnchor(p) {
    var worn = ironWornSize()
    var rimY = state.top + state.size * 0.3639
    return { x: Math.round(ironAnchorX()), y: Math.round(rimY - worn.h / 2 - (p ? ironStackIndex(p) : 0) * worn.h * 2 / 3), w: worn.w, h: worn.h }
  }
  function ironOnHead(p) {
    if (!p.iron || p.onHead || p.headFalling || p.fed || p.dragging) return false
    if (p.VY < 30) return false
    var rimX = p.X
    var rimY = p.Y + p.artH / 2
    var cx = ironAnchorX()
    var cy = state.top + state.size * 0.3639
    var top = null
    state.bowls.forEach(function (b) { if (b.onHead && (!top || b.Y < top.Y)) top = b })
    if (top) return Math.abs(p.X - top.X) <= p.artW / 2 && rimY >= top.Y - top.artH / 2 - 14 && rimY <= top.Y + top.artH / 2
    var halfW = state.size * 0.26
    var halfH = state.size * 0.18
    return rimX > cx - halfW && rimX < cx + halfW && rimY > cy - halfH && rimY < cy + halfH
  }
  function attachIronPot(p) {
    // 铁盆落头与单击 Q 弹都写 body transform，同时播会互相覆盖 → 戴盆时直接结束弹跳。
    state.clickJumpT = CLICK_JUMP_DUR
    p.wornOrder = ++wornSequence
    var a = ironHeadAnchor(p)
    p.onHead = true
    p.headFalling = false
    p.Y = a.y
    p.headY = a.y
    p.headTarget = a.y
    p.X = a.x
    p.VX = 0
    p.VY = 0
    p.rot = 0
    p.grounded = false
    p.beingSucked = false
    var worn = ironWornSize()
    p.artW = worn.w
    p.artH = worn.h
    p.R = worn.w * 0.42
    p.el.style.width = worn.w + 'px'
    p.el.style.height = worn.h + 'px'
    state.headSquashT = 0
    playPool(landPool)
  }

  function knockPotOff() {
    var top = null
    state.bowls.forEach(function (p) {
      if (p.onHead && p.fadeT <= 0 && (!top || p.Y < top.Y)) top = p
    })
    if (!top) return false
    top.fadeT = 0.001
    state.headSquashT = 0
    playPool(offPool)
    return true
  }

  function updateBowls(dt) {
    var vs = viewportRect()
    for (var i = state.bowls.length - 1; i >= 0; i--) {
      var r = state.bowls[i]
      if (r.fed) {
        r.dieT += dt
        if (r.dieT > BOWL_DIE) {
          if (r.el.parentNode) r.el.parentNode.removeChild(r.el)
          state.bowls.splice(i, 1)
        }
        continue
      }

      if (r.onHead) {
        var a = ironHeadAnchor(r)
        r.headTarget = a.y
        if (r.fadeT > 0) {
          r.fadeT += dt
          if (r.fadeT > IRON_FADE) {
            if (r.el.parentNode) r.el.parentNode.removeChild(r.el)
            state.bowls.splice(i, 1)
          }
          continue
        }
        if (r.headFalling) {
          r.headY += (r.headTarget - r.headY) * Math.min(1.0, dt * 9.0)
          if (Math.abs(r.headY - r.headTarget) < 0.6) { r.headY = r.headTarget; r.headFalling = false }
          r.Y = r.headY
        } else {
          r.Y = a.y
        }
        r.X = a.x
        r.VX = 0; r.VY = 0; r.rot = 0; r.grounded = false
        r.headT += dt
        continue
      }
      if (r.beingSucked) continue
      if (r.dragging) {
        // 拖动中不受重力
      } else {
        // Arrival speed: the floor impact must be the speed the bowl CAME IN with, not
        // the speed after this frame's gravity. A coarse frame adds >90 px/s of gravity
        // on its own, so with the post-gravity value a bowl that is already sitting on
        // the floor registers a brand-new bounce — and restarts the Q-bounce squash —
        // on every single frame. That is the twitch seen on landing.
        var vBefore = r.VY
        r.VY += GRAVITY * dt
        r.VX *= (1.0 - AIR_DRAG * dt)
        r.X += r.VX * dt
        r.Y += r.VY * dt

        var floor = vs.bottom - r.R
        var left = vs.left + r.R
        var right = vs.right - r.R
        var top = vs.top + r.R
        if (r.Y >= floor) {
          r.Y = floor
          var impact = vBefore > 0 ? vBefore : 0
          var slide = Math.abs(r.VX) > SLIDE_STOP
          if (slide) r.VX *= 0.92
          r.VY = -impact * RESTITUTION
          // Q 弹已取消：落地不再触发挤压动画。
          if (impact > 90 && r.bounces < r.maxBounces) r.bounces++
          if (r.bounces >= r.maxBounces || Math.abs(r.VY) < 45) {
            r.VY = 0
            if (!slide) { r.VX = 0; r.grounded = true; r.rot = 0 } else r.grounded = false
          } else r.grounded = false
        }
        if (!r.grounded && r.Y >= floor - 0.5 && Math.abs(r.VY) < 45) {
          r.VX *= (1.0 - SLIDE_FRICTION * dt)
          if (Math.abs(r.VX) <= SLIDE_STOP) { r.VX = 0; r.grounded = true; r.rot = 0 }
        }
        if (r.X < left) { r.X = left; r.VX = Math.abs(r.VX) * 0.5 }
        if (r.X > right) { r.X = right; r.VX = -Math.abs(r.VX) * 0.5 }
        if (r.Y < top) { r.Y = top; if (r.VY < 0) r.VY = 0 }
        if (ironOnHead(r)) attachIronPot(r)
      }

      if (!r.iron && !r.fed && riceOnGirl(r)) onRiceFed(r)
    }

    // bowl-vs-bowl collisions (circles of radius R)
    for (var a2 = 0; a2 < state.bowls.length; a2++) {
      for (var b2 = a2 + 1; b2 < state.bowls.length; b2++) {
        var ra = state.bowls[a2], rb = state.bowls[b2]
        if (ra.fed || rb.fed || ra.onHead || rb.onHead) continue
        var dx = rb.X - ra.X, dy = rb.Y - ra.Y
        var d = Math.sqrt(dx * dx + dy * dy) || 0.001
        var minD = ra.R + rb.R
        if (d >= minD) continue
        var nx = dx / d, ny = dy / d
        var push = (minD - d) * 0.5
        var aFixed = ra.dragging || ra.beingSucked
        var bFixed = rb.dragging || rb.beingSucked
        var aw = aFixed ? 0 : (bFixed ? 1 : 0.5)
        var bw = bFixed ? 0 : (aFixed ? 1 : 0.5)
        ra.X -= nx * push * 2 * aw; ra.Y -= ny * push * 2 * aw
        rb.X += nx * push * 2 * bw; rb.Y += ny * push * 2 * bw
        var va = ra.VX * nx + ra.VY * ny
        var vb = rb.VX * nx + rb.VY * ny
        if (va - vb > 0 && !aFixed && !bFixed) {
          var imp = (va - vb) * 0.55
          ra.VX -= imp * nx; ra.VY -= imp * ny
          rb.VX += imp * nx; rb.VY += imp * ny
        }
      }
    }
  }

  // ---------------------------------------------------------------- radar ---
  function blip(bowl) {
    var G = headScreen()
    var dx = bowl.X - G.x
    var dy = bowl.Y - G.y
    var dist = Math.sqrt(dx * dx + dy * dy)
    var ux = dist > 0.001 ? dx / dist : 1
    var uy = dist > 0.001 ? dy / dist : 0
    var vx = bowl.dragging ? bowl.sampleVX : bowl.VX
    var vy = bowl.dragging ? bowl.sampleVY : bowl.VY
    var closure = -(vx * ux + vy * uy)
    var alt = -dy
    var ang = Math.atan2(uy, ux)
    var S = 1.33 * (2 * (bowl.artW * 0.42))
    function kpx(v) { return isFinite(v) ? (v / 1000).toFixed(1) + ' kpx' : '--' }
    function pxs(v) { return isFinite(v) ? (v === 0 ? '0' : String(Math.round(v))) + ' px/s' : '--' }
    function px(v) { return isFinite(v) ? (v === 0 ? '0' : String(Math.round(v))) + ' px' : '--' }
    return { S: S, Cx: bowl.X, Cy: bowl.Y, Dist: kpx(dist), Closure: pxs(closure), Alt: px(alt), Ang: ang }
  }
  function rectStr(x, y, w, h) {
    return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) +
      '" height="' + h.toFixed(1) + '" fill="' + RADAR_GREEN + '"/>'
  }
  function labelStr(text, x, y, h, anchor) {
    var edge = Math.max(1, h * 0.05)
    var common = ' font-family="Consolas,Menlo,monospace" font-weight="bold" font-size="' + h.toFixed(1) +
      '" text-anchor="' + anchor + '"'
    return '<text x="' + (x + edge).toFixed(1) + '" y="' + (y + edge).toFixed(1) + '"' + common +
      ' fill="rgba(0,40,0,0.667)">' + text + '</text>' +
      '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '"' + common + ' fill="' + RADAR_GREEN + '">' + text + '</text>'
  }
  function renderRadar(list) {
    var out = []
    for (var i = 0; i < list.length; i++) {
      var b = list[i]
      var S = b.S
      if (S < 24) continue
      var cx = b.Cx, cy = b.Cy
      var x0 = cx - S / 2, y0 = cy - S / 2, x1 = cx + S / 2, y1 = cy + S / 2
      var stroke = Math.max(2.0, 0.075 * S)
      var len = 0.30 * S
      var g = []
      g.push(rectStr(x0, y0, len, stroke))
      g.push(rectStr(x1 - len, y0, len, stroke))
      g.push(rectStr(x0, y1 - stroke, len, stroke))
      g.push(rectStr(x1 - len, y1 - stroke, len, stroke))
      g.push(rectStr(x0, y0, stroke, len))
      g.push(rectStr(x1 - stroke, y0, stroke, len))
      g.push(rectStr(x0, y1 - len, stroke, len))
      g.push(rectStr(x1 - stroke, y1 - len, stroke, len))

      var typeH = Math.max(11.0, 0.40 * S)
      var numH = Math.max(11.0, 0.30 * S)
      var gapX = 0.08 * S
      g.push(labelStr(RADAR_TYPE, cx, y0 - 0.06 * S - typeH * 0.78, typeH, 'middle'))
      g.push(labelStr(b.Dist, x1 + gapX, y0 + numH * 0.78, numH, 'start'))
      g.push(labelStr(b.Closure, x1 + gapX, y1, numH, 'start'))
      g.push(labelStr(b.Alt, x1 + 0.11 * S, y1 + 0.09 * S + numH, numH, 'end'))

      var ringR = 0.185 * S
      var ringStroke = 0.075 * S
      var rcx = cx, rcy = y1 + 0.70 * S
      g.push('<circle cx="' + rcx.toFixed(1) + '" cy="' + rcy.toFixed(1) + '" r="' + (ringR - ringStroke / 2).toFixed(1) +
        '" fill="none" stroke="' + RADAR_GREEN + '" stroke-width="' + ringStroke.toFixed(1) + '"/>')
      var ca = Math.cos(b.Ang), sa = Math.sin(b.Ang)
      g.push('<line x1="' + (rcx + ca * (ringR + ringStroke / 2)).toFixed(1) + '" y1="' + (rcy + sa * (ringR + ringStroke / 2)).toFixed(1) +
        '" x2="' + (rcx + ca * (ringR + 0.15 * S)).toFixed(1) + '" y2="' + (rcy + sa * (ringR + 0.15 * S)).toFixed(1) +
        '" stroke="' + RADAR_GREEN + '" stroke-width="' + ringStroke.toFixed(1) + '" stroke-linecap="square"/>')
      out.push('<g>' + g.join('') + '</g>')
    }
    radarSvg.innerHTML = out.join('')
  }

  function chargingBusy() {
    return state.pendingStep > 1e-9 || state.hits.length > 0 || state.demoLeft > 0
  }

  function updateRadar(dt) {
    // 火控雷达是独立开关：关掉时铭牌、10s 锁定与磁吸都不工作，盆留在原地等你拖。
    if (!state.radarOn) {
      state.lockAll = false
      state.lockT = 0
      state.radarManual = false
      state.bowlWait = 0
      if (radarSvg.firstChild) radarSvg.innerHTML = ''
      return
    }
    var anyRice = false
    for (var i = 0; i < state.bowls.length; i++) {
      if (!state.bowls[i].iron && !state.bowls[i].fed) { anyRice = true; break }
    }
    if (!anyRice) {
      state.lockAll = false
      state.lockT = 0
      state.radarManual = false
      if (radarSvg.firstChild) radarSvg.innerHTML = ''
      return
    }
    if (state.bowlWait >= BOWL_WAIT) state.lockAll = true
    var showNow = state.lockAll || state.radarManual
    var blips = []
    for (var j = 0; j < state.bowls.length; j++) {
      var bowl = state.bowls[j]
      if (bowl.iron || bowl.fed) continue
      if (!showNow) continue
      blips.push(blip(bowl))
    }
    state.radarManual = state.radarManual && !state.lockAll
    if (!blips.length) {
      state.lockT = 0
      if (radarSvg.firstChild) radarSvg.innerHTML = ''
      return
    }

    // A charge that arrives now waits its turn: the pump pauses, it does not reset.
    if (!chargingBusy()) state.lockT += dt
    var magnet = state.lockAll && state.lockT >= LOCK_DELAY
    if (magnet) {
      var G = headScreen()
      for (var k = 0; k < state.bowls.length; k++) {
        var b = state.bowls[k]
        if (b.iron || b.fed) continue
        b.beingSucked = true
        var dx = G.x - b.X, dy = G.y - b.Y
        var d = Math.sqrt(dx * dx + dy * dy)
        b.suckSpeed = Math.min(SUCK_MAX, (b.suckSpeed || 0) + SUCK_ACCEL * dt)
        if (d <= Math.max(12, b.R) || d < 0.001) { onRiceFed(b); continue }
        var step = Math.min(d, b.suckSpeed * dt)
        b.X += dx / d * step
        b.Y += dy / d * step
      }
      // plates follow the bowls
      blips = []
      for (var m = 0; m < state.bowls.length; m++) {
        var bb = state.bowls[m]
        if (bb.iron || bb.fed) continue
        blips.push(blip(bb))
      }
    }
    renderRadar(blips)
  }

  // ----------------------------------------------------------- expression ---
  // 换皮肤：替换四张表情图与红闪遮罩，重置命中画布，并按新皮肤的底板类型切样式
  function applySkin(id) {
    state.skin = SKINS[id] ? id : 'vk1'
    var skin = skinOf(state.skin)
    // 立绘翻转：只有非「控制台原生」皮肤允许（原生皮肤保持锁定）
    var flipArt = skin.board !== 'sprite' && state.rotateFlip === true
    art.style.transform = ''
    root.classList.toggle('dshvk1-art-flip', flipArt)
    EXPR_ORDER.forEach(function (key) {
      var url = skin.faces[key]
      faces[key].src = url
      flashes[key].style.webkitMaskImage = 'url(' + url + ')'
      flashes[key].style.maskImage = 'url(' + url + ')'
    })
    root.classList.toggle('dshvk1-board-rect', skin.board === 'rect')
    root.classList.toggle('dshvk1-board-badge', skin.board === 'badge')
    hitSrc = ''
    updateHitSource()
    layout()
    saveOptions()
  }

  function setExpression(want) {
    if (state.expr === want) return
    state.expr = want
    for (var i = 0; i < EXPR_ORDER.length; i++) {
      var k = EXPR_ORDER[i]
      var on = k === want
      faces[k].style.display = on ? 'block' : 'none'
      flashes[k].style.display = on ? 'block' : 'none'
    }
    updateHitSource()
  }
  function updateExpression(dt) {
    var anyBowl = false
    for (var i = 0; i < state.bowls.length; i++) {
      if (!state.bowls[i].fed && !state.bowls[i].iron) { anyBowl = true; break }
    }
    var cueRunning = state.fxHurt && chargingBusy()
    if (anyBowl && !cueRunning && !state.lockAll) state.bowlWait += dt
    else if (!anyBowl) state.bowlWait = 0

    var headPotOn = false
    for (var j = 0; j < state.bowls.length; j++) {
      if (state.bowls[j].iron && state.bowls[j].onHead && state.bowls[j].fadeT <= 0) { headPotOn = true; break }
    }
    var want
    // Upstream 2026 UpdateExpression: the pat uses expression_22 (eyes shut),
    // even with an empty balance. Restore the ordinary state on the next frame.
    if (pat.active) want = 'nervous'
    else if (isFinite(state.real) && state.real <= 0.005) want = 'aloof'
    else if (headPotOn && !anyBowl) want = 'calm'
    else if (cueRunning) want = 'nervous'
    else if (state.bowlWait >= BOWL_WAIT) want = 'aloof'
    else want = 'happy'
    setExpression(want)
  }

  // ------------------------------------------------------- balance reading ---
  function applyBalance(bal, snap) {
    if (!isFinite(bal)) return
    // 抖动保护：与上次读数几乎相同就当作没变，避免同一笔消费被反复结算（音效连响的来源之一）
    if (!snap && isFinite(state.real) && Math.abs(bal - state.real) < 1e-6) { state.connected = true; return }
    state.connected = true
    var first = !isFinite(state.real)
    var prev = state.real
    state.real = bal
    if (first) {
      state.bookedAt = bal
      state.bookedBal = bal
      state.pending = 0
    }
    if (snap) {
      state.bookedAt = bal
      state.bookedBal = bal
      state.pending = 0
      state.pendingStep = 0
      state.dueGap = 0
      state.creditPending = 0
      state.bowls.filter(function (b) { return !b.iron }).forEach(function (b) { detach(b.el) })
      state.bowls = state.bowls.filter(function (b) { return b.iron })
    } else if (!first) {
      if (bal > prev + 1e-9) {
        // A top-up must NOT move the readout: it drops a bowl for you to collect.
        startCredit(round4(bal - prev))
      } else {
        var owed = round4(state.bookedAt - bal)
        if (owed < -1e-9) {
          owed = state.pending
          state.bookedAt = round4(bal + owed)
          state.bookedBal = round4(bal + owed)
        }
        if (owed >= state.pendingStep - 1e-9) owed = round4(owed - state.pendingStep)
        else owed = 0
        var cap = stepValue() * MAX_CUES_PER_POLL
        if (owed > cap) owed = cap
        state.pending = owed < 1e-9 ? 0 : owed
        if (state.pending > 1e-9 && state.dueGap <= 0) state.dueGap = 0
      }
    }
    updateScreen()
  }

  var lastScreenText = null
  var lastConnected = null
  function boardlessBalance() {
    // 除了「控制台原生」（手里有黑板），其余皮肤都把余额放进自动冒出/触发的气泡里
    return skinOf(state.skin).board !== 'sprite'
  }
  var lastBoardlessPush = 0
  function updateScreen() {
    var v = drawnBalance()
    var text = isFinite(v) ? v.toFixed(2) : '--'
    // 只有文本真的变了才写 DOM：这个函数被每帧调用一次，而余额一秒最多变几次。
    if (text !== lastScreenText) {
      lastScreenText = text
      numEl.textContent = text
      // 没黑板的皮肤：余额变化时经 cost 通道冒一条气泡（1.5s 内不重复）
      if (boardlessBalance() && isFinite(v)) {
        var nowMs2 = Date.now()
        if (nowMs2 - lastBoardlessPush > 1500) {
          lastBoardlessPush = nowMs2
          showBubble('¥' + text, false, 'cost')
        }
      }
      // 面板宽 520 CSS px、高约 0.7×520；数字要占可见宽度的一部分：
      // 短数字用 0.46ph，长到 7 位就收到 0.30ph，保证 ¥ + 数字 + 边距不越界。
      var fs = Math.min(0.46, 2.2 / Math.max(3, text.length))
      numEl.style.fontSize = 'calc(var(--dshvk1-ph) * ' + fs.toFixed(3) + ')'
      updateTablet()
    }
    if (state.connected !== lastConnected) {
      lastConnected = state.connected
      dot.style.display = state.connected ? 'none' : 'block'
    }
  }

  // 每轮消耗：轮询宿主 /last-turn.json，seq 递增即「刚结束一轮」→ 播结束音 + 弹本轮消耗
  var turnBusy = false
  function pollTurn() {
    if (stopped || turnBusy) return
    turnBusy = true
    fetch(BASE + '/last-turn.json', { cache: 'no-store' })
      .then(function (r) { return r.json() })
      .then(function (d) {
        if (stopped || !d || !d.ok) return
        var seq = Number(d.seq) || 0
        if (!state.lastTurnSeq) { state.lastTurnSeq = seq; return }   // 首轮只对齐，不播
        if (seq === state.lastTurnSeq) return
        state.lastTurnSeq = seq
        var amount = Number(d.amount) || 0
        state.turnCost = amount
        if (state.turnEndOn !== false) playPool(endPool)               // 任务结束音（第 5 槽）
        var costText = fmt2(amount)
        var line = pickReminder(costText)
        showBubble(line || ('\u672C\u8F6E \u00A5' + costText))
      })
      .catch(function () {})
      .finally(function () { turnBusy = false })
  }

  var busy = false
  function poll(snap) {
    if (busy) return
    busy = true
    fetch(BALANCE_URL, { cache: 'no-store' })
      .then(function (r) { return r.json() })
      .then(function (d) {
        if (stopped) return
        if (d && d.ok && d.totalBalance != null && isFinite(Number(d.totalBalance))) {
          if (d.version) state.hostVersion = String(d.version)
          applyBalance(Number(d.totalBalance), !!snap)
        }
        else { state.connected = false; updateScreen() }
      })
      .catch(function () { if (!stopped) { state.connected = false; updateScreen() } })
      .finally(function () { busy = false })
  }

  // ----------------------------------------------------------------- draw ---
  function renderBowls() {
    if (state.bowls.length === 0) {
      // 快路径：没有道具时只需保证铁盆遮罩已复位，跳过整个循环。
      applyPotMask(false)
      return
    }
    var worn = false
    for (var i = 0; i < state.bowls.length; i++) {
      var r = state.bowls[i]
      if (!r.el) continue
      if (r.iron && r.onHead) worn = true
      // 取消「Q 弹」挤压：缩放恒为 1，落点不再做 squash/stretch 动画。
      var sw = 1.0
      var sh = 1.0
      // Upstream draws with TranslateTransform(anchor) then Rotate/Scale and finally
      // DrawImage at a fixed art offset relative to that anchor. Emitting the same
      // chain as one CSS transform list keeps the two anchor rules honest:
      var tf
      if (r.onHead) {
        // Worn pot: anchored on the art CENTRE (IronHeadAnchor) and tilted about it. It has
        // to be mirrored together with her: she is drawn with scaleX(-1) when pinned to the
        // right edge, and a pot living in screen coordinates would otherwise lean the wrong
        // way against a mirrored head. Mirroring negates the rotation and flips the
        // horizontal scale: M' = T(2C-X, Y) R(-T) S(-sw, sh) T(-c).
        var flip = mirrored() ? -1 : 1
        tf = 'translate(' + Math.round(r.X) + 'px,' + Math.round(r.Y) + 'px)' +
          ' rotate(' + (flip * -IRON_TILT_DEG) + 'deg)' +
          ' scale(' + (flip * sw).toFixed(3) + ',' + sh.toFixed(3) + ')' +
          ' translate(' + (-r.artW / 2).toFixed(1) + 'px,' + (-r.artH / 2).toFixed(1) + 'px)'
      } else {
        // Loose prop: anchored on its BOTTOM edge at Y + R, so at rest the art sits
        // exactly on the screen floor (anchoring the art on Y instead pushes its
        // bottom 0.08*artW through the floor, where it gets clipped), and the squash
        // then grows upward from that same edge.
        tf = 'translate(' + Math.round(r.X) + 'px,' + Math.round(r.Y + r.R) + 'px)' +
          ' scale(' + sw.toFixed(3) + ',' + sh.toFixed(3) + ')' +
          ' translate(' + (-r.artW / 2).toFixed(1) + 'px,' + (-r.artH).toFixed(1) + 'px)'
      }
      r.el.style.transform = tf
      r.el.style.zIndex = r.onHead ? String(10 + ironStackIndex(r)) : '0'
      if (r.fed) {
        var e = 1.0 - r.dieT / BOWL_DIE
        r.el.style.opacity = String(e > 0 ? e : 0)
      } else if (r.fadeT > 0) {
        var f = 1.0 - r.fadeT / IRON_FADE
        r.el.style.opacity = String(f > 0 ? f : 0)
      } else {
        r.el.style.opacity = '1'
      }
    }
    applyPotMask(worn)
  }

  var last = 0
  var rafId = 0
  var stopped = false
  function frame(now) {
    if (stopped) return
    rafId = requestAnimationFrame(frame)
    if (!last) { last = now; return }
    var dt = Math.min(0.1, (now - last) / 1000)
    last = now

    // ---- settlement: the only place the printed number moves ----
    if (state.dueGap > 0) state.dueGap -= dt
    var take = 0
    if (state.dueGap <= 0 && state.pendingStep <= 0) {
      if (state.pending >= stepValue() - 1e-9) take = stepValue()
      else if (state.pending > 1e-9) take = Math.round(state.pending * 100) / 100
    }
    if (take > 0) {
      state.pending = round4(state.pending - take)
      if (state.pending < 1e-9) state.pending = 0
      state.bookedAt = round4(state.bookedAt - take)
      state.bookedBal = round4(state.bookedBal - take)
      state.pendingStep = take
      state.dueGap = CUE_GAP
    }
    if (state.pendingStep > 0) { makeTick(state.pendingStep, false); state.pendingStep = 0; updateScreen() }
    if (state.demoLeft > 0 && state.pendingStep <= 0 && state.dueGap <= 0) {
      makeTick(state.demoAmount, true)
      state.demoLeft--
      state.dueGap = CUE_GAP
      updateScreen()
    }

    updateBowls(dt)
    updateRadar(dt)
    tickBubble(dt)
    updatePat(dt)
    tickTablet(dt)
    updateExpression(dt)

    for (var i = state.hits.length - 1; i >= 0; i--) {
      state.hits[i].T += dt
      if (state.hits[i].T >= HIT_DUR) state.hits.splice(i, 1)
    }
    for (var j = state.floaters.length - 1; j >= 0; j--) {
      var fl = state.floaters[j]
      fl.T += dt
      if (fl.T >= FLOAT_DUR) {
        if (fl.el.parentNode) fl.el.parentNode.removeChild(fl.el)
        state.floaters.splice(j, 1)
      }
    }
    for (var k = state.hearts.length - 1; k >= 0; k--) {
      var hh = state.hearts[k]
      hh.T += dt
      if (hh.T >= hh.Dur) {
        if (hh.el.parentNode) hh.el.parentNode.removeChild(hh.el)
        state.hearts.splice(k, 1)
      }
    }

    var sx = 0, sy = 0
    for (var m = 0; m < state.hits.length; m++) {
      var h = state.hits[m]
      var e = Math.max(0, 1 - h.T / HIT_DUR)
      sx += Math.sin(h.T * 24) * 3.2 * e
      sy += Math.cos(h.T * 19) * 2.8 * e
    }
    var shakeMax = Math.min(12.0, state.size * 0.06)
    sx = clamp(sx, -shakeMax, shakeMax)
    sy = clamp(sy, -shakeMax, shakeMax)

    if (state.headSquashT < HEAD_SQUASH_DUR) state.headSquashT += dt
    var hu = state.headSquashT / HEAD_SQUASH_DUR
    // 单击弹跳进行中不叠加头顶挤压，避免两套 scale 同帧相乘导致抖动
    var squash = (state.clickJumpT >= CLICK_JUMP_DUR && hu < 1) ? Math.sin(Math.PI * hu) * (1 - hu) * 0.6 : 0
    var shakeTf = 'translate(' + Math.round(sx) + 'px,' + Math.round(sy) + 'px)'
    if (squash > 0.001) {
      shakeTf += ' scale(' + (1 + squash * 0.10).toFixed(4) + ',' + (1 - squash * 0.16).toFixed(4) + ')'
    }
    // 单击角色的 Q 弹：先上跳（sin 半周）再落地，落地时带一点挤压
    if (state.clickJumpT < CLICK_JUMP_DUR) {
      state.clickJumpT += dt
      var ju = Math.min(1, state.clickJumpT / CLICK_JUMP_DUR)
      var lift = Math.sin(Math.PI * ju) * state.size * 0.06
      var press = ju < 0.5 ? 1 - ju * 2 : (ju - 0.5) * 2
      shakeTf += ' translateY(' + (-lift).toFixed(2) + 'px) scale(' + (1 + press * 0.05).toFixed(4) + ',' + (1 - press * 0.07).toFixed(4) + ')'
    }
    if (pat.active) {
      var pi = Math.floor(pat.t / 0.04) % 5
      // Upstream moves the compression pivot below her feet: displacement is shift*(1-scaleY).
      // Keep the feet inside the webpage when she is pinned against the viewport's bottom.
      var patShift = Math.min(state.size * pi * 0.05 * pi * 0.0625, Math.max(0, viewport().h - state.top - state.size))
      shakeTf += ' translateY(' + patShift.toFixed(2) + 'px) scale(' + (1 + pi * 0.025) + ',' + (1 - pi * 0.0625) + ')'
    }
    body.style.transform = shakeTf

    var flash = 0
    var maxTint = Math.max(0.30, 0.64 - scaleOf() * 0.75)
    for (var n = 0; n < state.hits.length; n++) {
      var hit = state.hits[n]
      var pulse
      if (hit.T < 0.20) pulse = 1.0
      else {
        var ee = Math.max(0, 1 - (hit.T - 0.20) / (HIT_DUR - 0.20))
        pulse = Math.sin((hit.T - 0.20) * 26) * 0.55 * ee * ee
      }
      if (pulse > 0.01) flash = Math.max(flash, Math.min(maxTint, maxTint * pulse))
    }
    var activeFlash = flashes[state.expr]
    if (activeFlash) activeFlash.style.opacity = String(flash)

    for (var p = 0; p < state.floaters.length; p++) {
      var f = state.floaters[p]
      var t = f.T / FLOAT_DUR
      var em = Math.max(13, 34 * scaleOf())
      var pop = t < 0.18 ? (0.62 + 0.38 * (t / 0.18)) : 1
      var alpha = t < 0.55 ? 1 : (1 - (t - 0.55) / 0.45)
      if (!f.el) continue
      if (alpha <= 0) { f.el.style.opacity = '0'; continue }
      var fx = f.x + Math.round(f.jitter * Math.sin(t * 9))
      if (mirrored()) fx = state.left + (state.size - (fx - state.left) - f.tw)
      var fy = f.y - Math.round(t * em * 2.7)
      f.el.style.opacity = String(alpha)
      f.el.style.transform = 'translate(' + fx + 'px,' + fy + 'px) scale(' + pop + ')'
    }

    for (var q = 0; q < state.hearts.length; q++) {
      var hd = state.hearts[q]
      var u = hd.T / hd.Dur
      var a = u < 0.15 ? u / 0.15 : 1.0 - (u - 0.15) / 0.85
      var rise = 46.0 * u
      var wob = Math.sin(hd.phase + u * 7.0) * 6.0
      hd.el.style.opacity = String(a > 0 ? a : 0)
      hd.el.style.transform = 'translate(' + Math.round(hd.x + hd.drift * u + wob) + 'px,' + Math.round(hd.y - rise) + 'px)'
    }

    renderBowls()
  }

  // ----------------------------------------------------------- hit testing ---
  var hitCanvas = null
  var hitReady = false
  var hitSrc = ''
  var potArt = null
  var potArtReady = false
  var potMask = { key: '', url: '', applied: '' }
  function updateHitSource() {
    var skin = skinOf(state.skin)
    var url = skin.faces[state.expr] || skin.faces.happy
    if (hitSrc === url) return
    hitSrc = url
    hitReady = false
    try {
      var probe = new Image()
      probe.onload = function () {
        if (stopped || hitSrc !== url) return
        try {
          hitCanvas.getContext('2d').clearRect(0, 0, 610, 610)
          hitCanvas.getContext('2d').drawImage(probe, 0, 0, 610, 610)
          hitReady = true
        } catch (err) {}
      }
      probe.src = url
    } catch (err) {}
  }
  function alphaBounds(pixels, width, height) {
    var x0 = width, y0 = height, x1 = -1, y1 = -1
    for (var y = 0; y < height; y++) for (var x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] <= 8) continue
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
    }
    return x1 < x0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
  }
  function setupHitTest() {
    try {
      hitCanvas = document.createElement('canvas')
      hitCanvas.width = 610
      hitCanvas.height = 610
      updateHitSource()
    } catch (err) {}
    try {
      potArt = new Image()
      potArt.onload = function () {
        if (stopped) return
        try {
          // The authorized HD source is a square canvas with transparent margins.
          // Match upstream TrimTransparent(alpha > 8), retaining every source pixel.
          var source = potArt
          var scan = document.createElement('canvas')
          scan.width = source.naturalWidth; scan.height = source.naturalHeight
          var ctx = scan.getContext('2d')
          ctx.drawImage(source, 0, 0)
          var pixels = ctx.getImageData(0, 0, scan.width, scan.height).data
          var bounds = alphaBounds(pixels, scan.width, scan.height)
          if (!bounds) throw new Error('Empty iron art')
          var cropped = document.createElement('canvas')
          cropped.width = bounds.w; cropped.height = bounds.h
          cropped.getContext('2d').drawImage(source, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h)
          ironDrawUrl = cropped.toDataURL('image/png')
          potArt = cropped; potArtReady = true
          state.bowls.forEach(function (b) { if (b.iron) { b.el.src = ironDrawUrl; b.el.style.visibility = '' } })
          scan.width = scan.height = 0
        } catch (err) { showFatal('铁盆高清素材读取失败') }
      }
      potArt.src = IRON_URL
    } catch (err) {}
  }

  // Wearing the pot must not leave her hair showing above it. Upstream ships a
  // hand-drawn erase mask (EraseStrokes) that clears her pixels inside the pot's
  // column and above the pot's own OUTLINE — note it follows the dome (deep in the
  // middle, shallow at the ends), because a flat cut would bite a notch out of her
  // hair beside the dome. Here the same shape is derived from the pot art instead of
  // pasted coordinates, so it tracks every size preset and the worn tilt.
  function potMaskUrl() {
    // The erase shape IS the pot, so without its art step 3 cannot run and the mask
    // degenerates into a flat cut of the whole column above the rim — which bites a
    // notch out of her hair beside the dome, the very thing the dome-following shape
    // avoids. Returning '' leaves the mask off entirely; applyPotMask() re-asks every
    // frame, so the mask appears on its own once the art lands (and never gets cached
    // in the degraded form, because nothing is cached on this path).
    if (!potArtReady) return ''
    var worn = ironWornSize()
    var key = state.size + '/' + worn.w + 'x' + worn.h
    if (potMask.key === key) return potMask.url
    potMask.key = key
    potMask.url = ''
    try {
      var W = state.size
      var cx = W * 0.5558
      var rimY = W * 0.3639
      var pad = Math.ceil(W * 0.02)                 // covers the worn tilt
      var x0 = Math.floor(cx - worn.w / 2 - pad)
      // Rasterise the pot exactly where the worn pot is drawn — same centre, same tilt —
      // and read its ALPHA back, so the erase boundary is the pot's REAL outline in every
      // column instead of a guessed shape. This is the shape upstream encodes by hand in
      // EraseStrokes. Deriving it also removes the need to re-show the pot body, and that
      // re-show was what let her hair leak back through the pot's anti-aliased top edge
      // as the little spikes the user photographed.
      var t = document.createElement('canvas')
      t.width = Math.max(1, Math.ceil(worn.w + pad * 2))
      t.height = Math.max(1, Math.ceil(rimY))
      var tg = t.getContext('2d')
      tg.save()
      tg.translate(cx - x0, rimY - worn.h / 2)
      // The mask is applied to the ART, and the art is flipped as a whole when she is pinned
      // to the right edge, so the mask's content must be the UNMIRRORED pot placement in
      // every case. Mirroring it here as well would flip twice and leave the erase boundary
      // 2*6.23deg out of step with the pot.
      tg.rotate(-IRON_TILT_DEG * Math.PI / 180)
      tg.drawImage(potArt, -worn.w / 2, -worn.h / 2, worn.w, worn.h)
      tg.restore()
      var alpha = tg.getImageData(0, 0, t.width, t.height).data
      var margin = Math.max(2, Math.round(W * 0.008))   // swallow the AA fringe
      var c = document.createElement('canvas')
      c.width = W
      c.height = W
      var g = c.getContext('2d')
      // A CSS mask fed an IMAGE is read through its ALPHA channel (mask-mode:
      // match-source), so "hidden" means alpha 0. Painting a region black would leave it
      // fully opaque and the mask would silently do nothing at all — which is what the
      // first version did.
      g.fillStyle = '#fff'
      g.fillRect(0, 0, W, W)
      g.globalCompositeOperation = 'destination-out'
      for (var x = 0; x < t.width; x++) {
        var top = -1
        for (var y = 0; y < t.height; y++) {
          if (alpha[(y * t.width + x) * 4 + 3] > 128) { top = y; break }
        }
        // Where the pot has no pixel at all, nothing covers her, so the whole column down
        // to the rim goes. Otherwise everything above the outline, plus a margin so the
        // pot's own soft edge cannot leak her hair back through.
        var bottom = top < 0 ? t.height : Math.min(t.height, top + margin)
        if (bottom > 0) g.fillRect(x0 + x, 0, 1, bottom)
      }
      g.globalCompositeOperation = 'source-over'
      potMask.url = c.toDataURL()
    } catch (err) {
      potMask.url = ''
    }
    return potMask.url
  }

  function applyPotMask(worn) {
    var url = worn ? potMaskUrl() : ''
    if (url === potMask.applied) return
    potMask.applied = url
    var cssUrl = url ? 'url("' + url + '")' : ''
    art.style.webkitMaskImage = cssUrl
    art.style.maskImage = cssUrl
    // Pinned explicitly: the canvas mask encodes the erase as transparency, and alpha is
    // the reading that matches it (luminance would invert the meaning of the punch).
    art.style.webkitMaskMode = url ? 'alpha' : ''
    art.style.maskMode = url ? 'alpha' : ''
    art.style.webkitMaskSize = url ? '100% 100%' : ''
    art.style.maskSize = url ? '100% 100%' : ''
    art.style.webkitMaskRepeat = url ? 'no-repeat' : ''
    art.style.maskRepeat = url ? 'no-repeat' : ''
  }
  function isHit(e) {
    if (!hitCanvas || !hitReady) return false
    try {
      var r = root.getBoundingClientRect()
      if (!r || r.width <= 0 || r.height <= 0) return false
      var lx = (e.clientX - r.left) / r.width * 610
      var ly = (e.clientY - r.top) / r.height * 610
      if (lx < 0 || ly < 0 || lx >= 610 || ly >= 610) return false
      var data = hitCanvas.getContext('2d').getImageData(Math.floor(lx), Math.floor(ly), 1, 1).data
      return data[3] > 10
    } catch (err) {
      return false
    }
  }
  function bowlAt(x, y) {
    for (var i = state.bowls.length - 1; i >= 0; i--) {
      var b = state.bowls[i]
      // A worn pot is not grabbable: it is removed by double-clicking her head.
      if (b.fed || b.fadeT > 0 || b.beingSucked || b.onHead) continue
      // The art hangs from its bottom edge at Y + R, so the pick circle tracks the
      // drawn art rather than the physics footprint centre.
      var cy = b.Y + b.R - b.artH / 2
      var dx = x - b.X, dy = y - cy
      if (dx * dx + dy * dy <= Math.pow(b.R * 1.15, 2)) return b
    }
    return null
  }
  function inHeadBox(x, y) {
    var cx = state.left + state.size * (mirrored() ? (1 - 0.47) : 0.47)
    var cy = state.top + state.size * 0.30
    return Math.abs(x - cx) < state.size * 0.26 && Math.abs(y - cy) < state.size * 0.18
  }

  // ================================================== position (whale port) ==
  function viewport() {
    return {
      w: window.innerWidth || document.documentElement.clientWidth || 1280,
      h: window.innerHeight || document.documentElement.clientHeight || 800,
    }
  }
  function rightGap() {
    if (!state.scrollGapOn) return 0
    return state.scrollGapPx > 0 ? state.scrollGapPx : 0
  }

  // ---- 吸附配置：照搬 dsh-whale-widget 的 snapConfig 模型（ratio / px / off 三档，
  //      四边吸附区宽度 + 翻转线）。判定点与它一致：图像中心 x 判左右与翻转，
  //      盒中心 y 判顶，图像中心 y 判底；挂件的「图像」就是整个 1024 方块，所以
  //      图像中心 = 盒中心。
  var SNAP_KEY = 'dsh-vk1-snap'
  var SNAP_VER = 3
  var SNAP_DEFAULTS = { mode: 'ratio', ratio: { L: 10, T: 0, R: 10, B: 15, F: 50 }, px: { L: 80, T: 0, R: 80, B: 80, F: -1 } }
  var snapConfig = null
  var SNAP_KEYS = ['L', 'T', 'R', 'B', 'F']
  function cloneSnap(src) {
    var out = { mode: src.mode, ratio: {}, px: {} }
    for (var i = 0; i < SNAP_KEYS.length; i++) {
      out.ratio[SNAP_KEYS[i]] = src.ratio[SNAP_KEYS[i]]
      out.px[SNAP_KEYS[i]] = src.px[SNAP_KEYS[i]]
    }
    return out
  }
  function fixSnapConfig(cfg, mode) {
    var box = mode === 'px' ? cfg.px : cfg.ratio
    var limit = mode === 'px' ? 4000 : 45
    for (var i = 0; i < 4; i++) {
      var k = SNAP_KEYS[i]
      var v = Number(box[k])
      if (!isFinite(v)) v = SNAP_DEFAULTS[mode][k]
      box[k] = Math.round(clamp(v, 0, limit) * 100) / 100
    }
    if (mode === 'px') {
      var f = Number(box.F)
      box.F = (!isFinite(f) || f < 0) ? Math.round(viewport().w / 2) : Math.round(clamp(f, 0, 4000))
    } else {
      var rf = Number(box.F)
      box.F = isFinite(rf) ? Math.round(clamp(rf, 0, 100) * 100) / 100 : 50
    }
  }
  function loadSnapConfig() {
    snapConfig = cloneSnap(SNAP_DEFAULTS)
    try {
      var raw = localStorage.getItem(SNAP_KEY)
      if (raw) {
        var d = JSON.parse(raw)
        if (d && d.v === SNAP_VER) {
          if (d.mode === 'ratio' || d.mode === 'px' || d.mode === 'off') snapConfig.mode = d.mode
          for (var i = 0; i < SNAP_KEYS.length; i++) {
            var k = SNAP_KEYS[i]
            if (d.ratio && typeof d.ratio[k] === 'number' && isFinite(d.ratio[k])) snapConfig.ratio[k] = d.ratio[k]
            if (d.px && typeof d.px[k] === 'number' && isFinite(d.px[k])) snapConfig.px[k] = d.px[k]
          }
        }
      }
    } catch (err) {}
    fixSnapConfig(snapConfig, 'ratio')
    fixSnapConfig(snapConfig, 'px')
  }
  function saveSnapConfig() {
    try {
      var out = cloneSnap(snapConfig)
      out.v = SNAP_VER
      localStorage.setItem(SNAP_KEY, JSON.stringify(out))
    } catch (err) {}
  }
  // 吸附区在屏幕坐标里的位置；off 档返回整屏且翻转线在正中。
  function snapBounds(vp) {
    var b = { L: 0, T: 0, R: vp.w, B: vp.h, F: vp.w / 2 }
    try {
      var cfg = snapConfig
      if (!cfg || cfg.mode === 'off') return b
      if (cfg.mode === 'px') {
        b.L = cfg.px.L
        b.T = cfg.px.T
        b.R = Math.max(0, vp.w - cfg.px.R)
        b.B = Math.max(0, vp.h - cfg.px.B)
        b.F = cfg.px.F
      } else {
        b.L = vp.w * cfg.ratio.L / 100
        b.T = vp.h * cfg.ratio.T / 100
        b.R = vp.w * (100 - cfg.ratio.R) / 100
        b.B = vp.h * (100 - cfg.ratio.B) / 100
        b.F = vp.w * cfg.ratio.F / 100
      }
    } catch (err) {}
    return b
  }
  function snapZones(cx, cyBox, cyImg, vp) {
    var out = { zH: null, zV: null, flip: false }
    try {
      var cfg = snapConfig
      if (!cfg || cfg.mode === 'off') return out
      var b = snapBounds(vp)
      if (cx < b.L) out.zH = 'left'
      else if (cx > b.R) out.zH = 'right'
      if (cyBox < b.T) out.zV = 'top'
      else if (cyImg > b.B) out.zV = 'bottom'
    } catch (err) {}
    return out
  }
  // 挂件的美术中心 = 盒中心（美术铺满整个方形），镜像不改中心点。
  function artCenter() {
    return { cx: state.left + state.size / 2, cy: state.top + state.size / 2 }
  }
  // 镜像语义沿用 VK-1 本体：**贴右才镜像**，贴左保持正向；自由摆放时按角色中心
  // 越过翻转线判定（翻转线来自 snapConfig，可配置）。
  function refreshFlip() {
    try {
      if (state.h === 'right') state.flip = true
      else if (state.h === 'left') state.flip = false
      else state.flip = artCenter().cx > snapBounds(viewport()).F
    } catch (err) {}
  }

  function express() {
    root.style.left = state.left + 'px'
    root.style.top = state.top + 'px'
  }
  function settle() {
    var vp = viewport()
    var w = state.size, h = state.size
    var bounds = snapBounds(vp)
    if (state.dragWidget) {
      state.left = clamp(state.left, 0, Math.max(0, vp.w - w - rightGap()))
      state.top = clamp(state.top, 0, Math.max(0, vp.h - h))
      refreshFlip(); express(); layout(); return
    }
    if (state.h === 'right') state.left = Math.max(0, vp.w - w - state.hOff - rightGap())
    else if (state.h === 'left') state.left = state.hOff
    else state.left = clamp(state.left, 0, Math.max(0, vp.w - w - rightGap()))
    if (state.v === 'bottom') state.top = Math.max(0, vp.h - h - state.vOff)
    else if (state.v === 'top') state.top = state.vOff
    else state.top = clamp(state.top, 0, Math.max(0, vp.h - h))
    refreshFlip()
    express()
    layout()
    return bounds
  }
  function saveAnchor() {
    try {
      var vp = viewport()
      var w = state.size, h = state.size
      var leftDist = state.left, rightDist = vp.w - state.left - w
      var topDist = state.top, bottomDist = vp.h - state.top - h
      var hAnchor = leftDist <= rightDist ? 'left' : 'right'
      var hDistRaw = Math.round(Math.min(leftDist, rightDist))
      var hDist = hAnchor === 'right' && state.scrollGapOn ? Math.max(0, hDistRaw - rightGap()) : hDistRaw
      localStorage.setItem(POS_KEY, JSON.stringify({
        v: 2, hAnchor: hAnchor, hDist: hDist,
        vAnchor: topDist <= bottomDist ? 'top' : 'bottom',
        vDist: Math.round(Math.min(topDist, bottomDist)),
      }))
    } catch (err) {}
  }
  function applyAnchorPos() {
    try {
      var a = JSON.parse(localStorage.getItem(POS_KEY) || 'null')
      if (!a || a.v !== 2 || (a.hAnchor !== 'left' && a.hAnchor !== 'right') || typeof a.hDist !== 'number' ||
          (a.vAnchor !== 'top' && a.vAnchor !== 'bottom') || typeof a.vDist !== 'number') return false
      var vp = viewport()
      var w = state.size, h = state.size
      var effectiveRightDist = a.hAnchor === 'right' ? a.hDist + (state.scrollGapOn ? rightGap() : 0) : a.hDist
      var l = a.hAnchor === 'left' ? a.hDist : vp.w - effectiveRightDist - w
      var t = a.vAnchor === 'top' ? a.vDist : vp.h - a.vDist - h
      state.left = clamp(l, 0, Math.max(0, vp.w - w))
      state.top = clamp(t, 0, Math.max(0, vp.h - h))
      state.h = a.hAnchor; state.hOff = 0
      state.v = a.vAnchor; state.vOff = 0
      refreshFlip(); express(); layout()
      return true
    } catch (err) {
      return false
    }
  }

  // ------------------------------------------------------ drag & snapping ---
  function addDragListeners() {
    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('pointercancel', onUp, true)
  }
  function removeDragListeners() {
    document.removeEventListener('pointermove', onMove, true)
    document.removeEventListener('pointerup', onUp, true)
    document.removeEventListener('pointercancel', onUp, true)
  }
  // 命中角色或饭盆的那次按下会把后续 click 吞掉，避免点到身后的按钮。
  var swallowClickUntil = 0
  function swallowNextClick(ms) {
    var until = Date.now() + (ms || 400)
    if (until > swallowClickUntil) swallowClickUntil = until
  }
  function onDocClick(e) {
    // 菜单 / 设置面板 / ☰ 按钮自己的点击必须放行。
    var t = e.target
    if (t && t.closest && (t.closest('.dshvk1-menu') || t.closest('.dshvk1-dialog') || t.closest('.dshvk1-btn'))) return
    var swallow = Date.now() <= swallowClickUntil
    if (!swallow && typeof e.clientX === 'number') {
      // 兜底：按这次 click 的坐标再判一次「是否点在角色或道具上」。
      swallow = !!isHit(e) || !!bowlAt(e.clientX, e.clientY)
    }
    if (!swallow) return
    swallowClickUntil = 0
    try { e.stopPropagation(); e.preventDefault() } catch (err) {}
  }
  document.addEventListener('click', onDocClick, true)

  function onDown(e) {
    blockPat()
    if (settingsOpen) return
    if (state.menuOpen) return
    if (e.button !== 0 && e.pointerType === 'mouse') return
    if (e.target && e.target.closest && e.target.closest('.dshvk1-menu')) return

    var onArt = isHit(e)
    // 只要按下点落在角色或道具上，就把随后那次 click 吞掉（拖拽与单击都一样）。
    if (onArt || bowlAt(e.clientX, e.clientY)) swallowNextClick(400)
    // Double-clicking her head (with the pot on it) is decided FIRST: the worn pot
    // is a wide circle sitting right on that spot, so a bowl grab would eat it.
    var now = Date.now()
    var isHead = onArt && inHeadBox(e.clientX, e.clientY)
    if (isHead && state.lastHeadClick && now - state.lastHeadClick.t < 400 &&
        Math.abs(e.clientX - state.lastHeadClick.x) < 24 && Math.abs(e.clientY - state.lastHeadClick.y) < 24) {
      state.lastHeadClick = null
      knockPotOff()
      try { e.preventDefault(); e.stopPropagation() } catch (err) {}
      return
    }
    if (isHead) state.lastHeadClick = { t: now, x: e.clientX, y: e.clientY }

    var bowl = bowlAt(e.clientX, e.clientY)
    if (bowl) {
      try { e.preventDefault(); e.stopPropagation() } catch (err) {}
      bowl.beingSucked = false
      bowl.dragging = true
      bowl.VX = 0
      bowl.VY = 0
      state.grab = { bowl: bowl, dx: bowl.X - e.clientX, dy: bowl.Y - e.clientY, moved: false, x: e.clientX, y: e.clientY }
      addDragListeners()
      return
    }
    if (!onArt) return

    try { e.preventDefault(); e.stopPropagation() } catch (err) {}
    state.dragWidget = { x: e.clientX, y: e.clientY, left: state.left, top: state.top, moved: false }
    root.classList.add('dshvk1-dragging')
    addDragListeners()
  }
  function onMove(e) {
    var g = state.grab
    if (g) {
      var b = g.bowl
      if (Math.abs(e.clientX - g.x) + Math.abs(e.clientY - g.y) >= 3) g.moved = true
      var nx = e.clientX + g.dx
      var ny = e.clientY + g.dy
      b.sampleVX = (nx - b.X) / 0.016
      b.sampleVY = (ny - b.Y) / 0.016
      b.X = nx
      b.Y = ny
      renderBowls()
      return
    }
    var d = state.dragWidget
    if (!d) return
    var dx = e.clientX - d.x
    var dy = e.clientY - d.y
    if (dx * dx + dy * dy >= 9) d.moved = true
    var vp = viewport()
    state.left = clamp(d.left + dx, 0, Math.max(0, vp.w - state.size - rightGap()))
    state.top = clamp(d.top + dy, 0, Math.max(0, vp.h - state.size))
    express()
  }
  function onUp(e) {
    var g = state.grab
    if (g) {
      var b = g.bowl
      b.dragging = false
      state.grab = null
      removeDragListeners()
      if (b.iron) {
          b.VX = b.sampleVX * 0.35
          b.VY = b.sampleVY * 0.35
          var floor = viewportRect().bottom
          b.maxBounces = bouncesForDrop(Math.max(0, floor - b.Y))
          b.bounces = 0
          b.grounded = false
      } else if (riceOnGirl(b)) {
        onRiceFed(b)
      } else {
        b.VX = b.sampleVX * 0.35
        b.VY = b.sampleVY * 0.35
        var fl = viewportRect().bottom
        b.maxBounces = bouncesForDrop(Math.max(0, fl - b.Y))
        b.bounces = 0
        b.grounded = false
      }
      return
    }
    var d = state.dragWidget
    if (!d) return
    state.dragWidget = null
    root.classList.remove('dshvk1-dragging')
    removeDragListeners()
    swallowNextClick(400)
    if (!d.moved) {
      // 单击角色：Q 弹 + 音效 + 气泡。
      // ⚠️ 这里不能用 poll(true)：snap 会清空场上没喂的饭盆（旧版单击就把它们重置了）。
      state.clickJumpT = 0
      if (state.clickSoundOn !== false) playPool(clickPool)
      // 只有「没有别的气泡在显示 / 排队」时才插一句，避免挤掉本轮消耗提示。
      if (state.bubbleOn && !bubbleText && !bubbleQueue.length) {
        showBubble(pickReminder('') || ('\u00A5' + (isFinite(drawnBalance()) ? fmt2(drawnBalance()) : '--')))
      }
      poll(false)
      return
    }

    var vp = viewport()
    // 吸附判定交给 snapBounds / snapZones：吸附区宽度与翻转线都可配置（照搬
    // dsh-whale-widget 的模型），不是固定的「四分之一视口」。
    var ac = artCenter()
    var z = snapZones(ac.cx, ac.cy, ac.cy, vp)
    state.h = z.zH; state.hOff = z.zH ? 0 : state.left
    state.v = z.zV; state.vOff = z.zV ? 0 : state.top
    if (z.zH === 'right') state.flip = true
    else if (z.zH === 'left') state.flip = false
    else state.flip = ac.cx > snapBounds(vp).F
    settle()
    saveAnchor()
  }
  function onCursor(e) {
    pat.pointer = { x: e.clientX, y: e.clientY, buttons: e.buttons || 0 }
    if (state.dragWidget || state.grab) return
    var onArt = isHit(e)
    var onBowl = !!bowlAt(e.clientX, e.clientY)
    var onBtn = !!(e.target && e.target.closest && e.target.closest('.dshvk1-btn'))
    if (onArt || onBowl || onBtn || state.menuOpen) {
      btnOnSolid = true
      keepBtn()
    } else if (btnOnSolid) {
      btnOnSolid = false
      releaseBtn()
    }
    if (onBowl) root.style.cursor = 'grab'
    else root.style.cursor = onArt ? 'grab' : ''
  }
  function onContextMenu(e) {
    if (settingsOpen) return
    if (state.dragWidget || state.grab) return
    if (!isHit(e)) return
    try { e.preventDefault(); e.stopPropagation() } catch (err) {}
    openMenu(e.clientX, e.clientY)
  }
  function onResize() {
    // 窗口尺寸变了，base 尺寸按 scale 重算（与鲸鱼挂件一致的响应式基准）
    var next = baseSizePx(state.scale)
    if (next !== state.size) { applySize(); return }
    if (state.h === null && state.v === null && applyAnchorPos()) return
    settle()
  }
  // 菜单外单击关闭：缺这条就只能靠 Esc 或再点 ⋯ 关闭。
  document.addEventListener('pointerdown', onDocMenuClose, true)
  document.addEventListener('pointerdown', onDown, true)
  document.addEventListener('pointermove', onCursor, true)
  document.addEventListener('contextmenu', onContextMenu, true)
  window.addEventListener('resize', onResize)

  // ---------------------------------------------------------------- menu ----
  var btnOnSolid = false
  var btnHideTimer = null
  function keepBtn() {
    if (btnHideTimer) { clearTimeout(btnHideTimer); btnHideTimer = null }
    btn.classList.add('dshvk1-btn-on')
  }
  function releaseBtn() {
    if (btnHideTimer) clearTimeout(btnHideTimer)
    btnHideTimer = setTimeout(function () {
      btnHideTimer = null
      if (!state.menuOpen) { btn.classList.remove('dshvk1-btn-on'); btnOnSolid = false }
    }, BTN_GRACE_MS)
  }
  function menuRow(text, onClick) {
    var b = document.createElement('button')
    b.type = 'button'
    b.className = 'dshvk1-menu-row'
    b.textContent = text
    b.addEventListener('click', function (e) { e.stopPropagation(); closeMenu(); onClick() })
    menu.appendChild(b)
    return b
  }
  function menuSep() {
    var d = document.createElement('div')
    d.className = 'dshvk1-menu-sep'
    menu.appendChild(d)
  }
  function menuToggle(labelText, checked, onChange) {
    var row = document.createElement('div')
    row.className = 'dshvk1-menu-row dshvk1-menu-row-flex'
    var label = document.createElement('span')
    label.textContent = labelText
    var box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = !!checked
    box.addEventListener('click', function (e) { e.stopPropagation() })
    box.addEventListener('change', function () { onChange(box.checked) })
    row.appendChild(label)
    row.appendChild(box)
    menu.appendChild(row)
    return row
  }

  // 一级菜单：余额 / 大小 / 火控雷达 / 掉盆间隔 + 二级入口。整体是「一行一项、右侧控件」
  // 的高密度布局，与 dsh-whale-widget 的主菜单同一形态。
  function buildMenu() {
    menu.textContent = ''
    var head = document.createElement('div')
    head.className = 'dshvk1-menu-head'
    var bal = document.createElement('span')
    bal.className = 'dshvk1-menu-bal'
    var v = drawnBalance()
    bal.textContent = (isFinite(v) ? '\u00A5' + fmt2(v) : '\u00A5--') + (state.connected ? '' : ' \u00B7 \u79BB\u7EBF')
    head.appendChild(bal)
    var refresh = document.createElement('button')
    refresh.type = 'button'
    refresh.className = 'dshvk1-menu-mini'
    refresh.textContent = '\u5237\u65B0'
    refresh.addEventListener('click', function (e) { e.stopPropagation(); closeMenu(); poll(true) })
    head.appendChild(refresh)
    menu.appendChild(head)

    var sizeRow = document.createElement('div')
    sizeRow.className = 'dshvk1-menu-row dshvk1-menu-row-flex'
    var sizeLabel = document.createElement('span')
    sizeLabel.textContent = '\u5927\u5C0F'
    var range = document.createElement('input')
    range.type = 'range'
    range.className = 'dshvk1-menu-range'
    range.min = '1'; range.max = String(SCALE_STEPS); range.step = '1'
    range.value = String(scaleToStep(state.scale))
    var num = document.createElement('input')
    num.type = 'number'
    num.className = 'dshvk1-menu-num'
    num.min = '1'; num.max = String(SCALE_STEPS); num.step = '1'
    num.value = range.value
    var applyStep = function (step) {
      var n = clamp(Math.round(Number(step) || 1), 1, SCALE_STEPS)
      setScale(stepToScale(n))
      range.value = String(n)
      num.value = String(n)
    }
    range.addEventListener('click', function (e) { e.stopPropagation() })
    num.addEventListener('click', function (e) { e.stopPropagation() })
    range.addEventListener('input', function () { applyStep(range.value) })
    num.addEventListener('change', function () { applyStep(num.value) })
    sizeRow.appendChild(sizeLabel)
    sizeRow.appendChild(range)
    sizeRow.appendChild(num)
    menu.appendChild(sizeRow)

    menuToggle('\u706B\u63A7\u96F7\u8FBE', state.radarOn, function (on) {
      state.radarOn = on
      saveOptions()
      if (!on) { state.lockAll = false; state.radarManual = false; if (radarSvg.firstChild) radarSvg.innerHTML = '' }
    })

    var dropRow = document.createElement('div')
    dropRow.className = 'dshvk1-menu-row dshvk1-menu-row-flex'
    var dropLabel = document.createElement('span')
    dropLabel.textContent = '\u6389\u76C6\u95F4\u9694'
    var dropNum = document.createElement('input')
    dropNum.type = 'number'
    dropNum.className = 'dshvk1-menu-num'
    dropNum.min = String(DROP_INTERVAL_MIN_S)
    dropNum.max = String(DROP_INTERVAL_MAX_S)
    dropNum.step = '1'
    dropNum.value = String(state.dropIntervalSec)
    var unit = document.createElement('span')
    unit.className = 'dshvk1-menu-unit'
    unit.textContent = '\u79D2'
    dropNum.addEventListener('click', function (e) { e.stopPropagation() })
    dropNum.addEventListener('change', function () {
      setDropInterval(dropNum.value)
      dropNum.value = String(state.dropIntervalSec)
    })
    dropRow.appendChild(dropLabel)
    dropRow.appendChild(dropNum)
    dropRow.appendChild(unit)
    menu.appendChild(dropRow)

    menuSep()
    menuRow('\u5F62\u8C61\u4E0E\u529F\u80FD', function () { showSettings('look') })
    menuRow('\u5438\u9644\u4E0E\u7FFB\u8F6C', function () { showSettings('snap') })
    menuRow('\u58F0\u97F3\u4E0E\u97F3\u6548', function () { showSettings('sound') })
    menuRow('\u97F3\u6548\u5E93', function () { showSettings('library') })
    menuRow('\u6C14\u6CE1\u4E0E\u63D0\u9192\u8BCD', function () { showSettings('bubble') })
    menuRow('\u8D44\u6E90\u7BA1\u7406', function () { showSettings('resources') })
    menuRow('\u6F14\u793A\uFF08\u53EA\u64AD\u52A8\u753B\uFF09', function () { showSettings('demo') })
    menuRow('\u5173\u4E8E', function () { showSettings('about') })
  }
  function openMenu(clientX, clientY) {
    buildMenu()
    state.menuOpen = true
    menu.classList.add('dshvk1-menu-open')
    keepBtn()
    var mw = menu.offsetWidth || 236
    var mh = menu.offsetHeight || 320
    var vp = viewport()
    menu.style.left = clamp(clientX, 4, Math.max(4, vp.w - mw - 4)) + 'px'
    menu.style.top = clamp(clientY, 4, Math.max(4, vp.h - mh - 4)) + 'px'
  }
  function closeMenu() {
    state.menuOpen = false
    menu.classList.remove('dshvk1-menu-open')
    releaseBtn()
  }
  btn.addEventListener('click', function (e) {
    e.stopPropagation()
    if (state.menuOpen) { closeMenu(); return }
    var r = root.getBoundingClientRect()
    // 按钮在左侧时菜单往右展开；镜像后按钮到右侧，菜单往左收
    openMenu(mirrored() ? r.right : r.left, r.top + 2)
  })
  btn.addEventListener('pointerenter', function () { btnOnSolid = true; keepBtn() })
  btn.addEventListener('pointerleave', function () { if (!state.menuOpen) { btnOnSolid = false; releaseBtn() } })
  function onDocMenuClose(e) {
    if (!state.menuOpen) return
    if (e.target && e.target.closest && (e.target.closest('.dshvk1-menu') || e.target.closest('.dshvk1-btn') || e.target.closest('.dshvk1-dialog'))) return
    closeMenu()
  }

  // ------------------------------------------------------------ size & gap ---
  // ---- 尺寸：scale -> 像素（照搬 dsh-whale-widget 的 --dshw-base 公式）----
  function stepToScale(step) {
    var n = clamp(Math.round(Number(step) || 1), 1, SCALE_STEPS)
    return Math.round((SCALE_MIN + (n - 1) * (SCALE_MAX - SCALE_MIN) / (SCALE_STEPS - 1)) * 100) / 100
  }
  function scaleToStep(scale) {
    var sc = clamp(Number(scale) || DEFAULT_SCALE, SCALE_MIN, SCALE_MAX)
    return Math.round(1 + (sc - SCALE_MIN) * (SCALE_STEPS - 1) / (SCALE_MAX - SCALE_MIN))
  }
  function baseSizePx(scale) {
    var vp = viewport()
    var base = Math.min(SIZE_BASE_CAP, Math.min(vp.w, vp.h) * SIZE_BASE_RATIO) * (Number(scale) || DEFAULT_SCALE)
    return Math.round(clamp(base * SIZE_SCALE_DOWN, SIZE_MIN_PX, SIZE_MAX_PX))
  }
  // 尺寸变化后所有依赖 size 的几何都要重算：平板面板、盆的尺寸与半径、命中画布。
  function applySize() {
    var prev = state.size
    state.size = baseSizePx(state.scale)
    // 以左下角为不动点：底边不动、左边不动 → 视觉上"向左下角收缩"。
    if (prev && isFinite(prev) && prev !== state.size) {
      state.top = Math.round(state.top + (prev - state.size))
    }
    try { localStorage.setItem(SIZE_KEY, JSON.stringify({ v: 2, scale: state.scale })) } catch (err) {}
    riceSizeCache = null
    for (var i = 0; i < state.bowls.length; i++) {
      var b = state.bowls[i]
      var sz = b.iron ? (b.onHead ? ironWornSize() : ironLooseSize()) : riceDims()
      b.artW = sz.w; b.artH = sz.h; b.R = sz.w * 0.42
      b.el.style.width = sz.w + 'px'
      b.el.style.height = sz.h + 'px'
    }
    layout()
    settle()
    saveAnchor()
  }
  function setScale(scale) {
    state.scale = Math.round(clamp(Number(scale) || DEFAULT_SCALE, SCALE_MIN, SCALE_MAX) * 100) / 100
    applySize()
  }
  function setDropInterval(sec) {
    state.dropIntervalSec = clamp(Math.round(Number(sec) || DROP_INTERVAL_DEFAULT_S), DROP_INTERVAL_MIN_S, DROP_INTERVAL_MAX_S)
    saveOptions()
    restartDropTimer()
  }
  function saveGap() {
    try { localStorage.setItem(GAP_KEY, JSON.stringify({ on: state.scrollGapOn, px: state.scrollGapPx })) } catch (err) {}
  }
  function setScrollGapOn(on) { state.scrollGapOn = !!on; saveGap(); settle(); saveAnchor() }
  function setScrollGapPx(v) {
    if (!state.scrollGapOn) return
    state.scrollGapPx = Math.max(0, Math.round(Number(v) || 0))
    saveGap(); settle(); saveAnchor()
  }
  function saveSound() {
    try { localStorage.setItem(SOUND_KEY, JSON.stringify({ on: state.soundOn, vol: state.volume })) } catch (err) {}
  }

  // Modernized upstream 571da3b (2026-10-15): hover strokes, usage and tablet clock.
  // 摸头触发门槛（v2.2 放宽）：累计位移 14px、持续 0.3s
  var PAT_MIN_DISTANCE = 14
  var PAT_MIN_HOLD = 0.3
  var pat = { active: false, t: 0, distance: 0, moveTime: 0, idle: 0, blocked: 0, pointer: null, previous: null, waiting: false }
  var hands = []
  for (var hi = 0; hi < 5; hi++) {
    var hand = document.createElement('img')
    hand.src = BASE + '/pat_hand_' + hi + '.png'
    hand.alt = ''
    hand.draggable = false
    hand.style.cssText = 'position:absolute;pointer-events:none;display:none;transform-origin:0 0'
    root.appendChild(hand)
    hands.push(hand)
  }
  function blockPat() {
    pat.active = false; pat.waiting = false; pat.t = 0
    pat.distance = 0; pat.moveTime = 0; pat.blocked = 1.16
    hands.forEach(function (h) { h.style.display = 'none' })
  }
  function pointerLeft() { pat.pointer = null }
  document.addEventListener('pointerleave', pointerLeft)
  window.addEventListener('blur', pointerLeft)
  function updatePat(dt) {
    var p = pat.pointer
    var onHer = p && charHitAt(p.x, p.y)
    var can = onHer && !p.buttons && !state.menuOpen && !settingsOpen && !state.dragWidget && !state.grab && state.fxPat
    var distance = p && pat.previous ? Math.hypot(p.x - pat.previous.x, p.y - pat.previous.y) : 0
    if (distance > 120) distance = 0
    pat.previous = p ? { x: p.x, y: p.y } : null
    if (state.dragWidget || state.grab || (p && p.buttons)) pat.blocked = 1.16
    else pat.blocked = Math.max(0, pat.blocked - dt)
    if (!can || pat.blocked > 0) {
      pat.distance = 0; pat.moveTime = 0
      if (!state.fxPat || pat.blocked > 0 || state.menuOpen || settingsOpen) pat.active = false
    }
    if (pat.waiting) {
      if (!can) pat.waiting = false
      else if (!state.bowls.some(function (b) { return b.onHead })) { pat.waiting = false; pat.active = true; pat.t = 0 }
      else if (!state.bowls.some(function (b) { return b.onHead && b.fadeT > 0 })) knockPotOff()
    }
    if (can && pat.blocked <= 0 && distance > 0) {
      pat.idle = 0
      pat.distance = Math.min(96, pat.distance + distance)
      // 放宽后的门槛：累计 14px 且持续 0.3s（原 24px / 0.5s）。仍然要求连续划动，
      // 单击、抖动或原地按住都不会触发。
      if (pat.distance >= PAT_MIN_DISTANCE) pat.moveTime += dt
      if (!pat.active && !pat.waiting && pat.moveTime >= PAT_MIN_HOLD) {
        if (state.bowls.some(function (b) { return b.onHead })) { knockPotOff(); pat.waiting = true }
        else { pat.active = true; pat.t = 0 }
      }
    } else {
      pat.idle += dt
      if (!pat.active && pat.idle >= 0.15) { pat.distance = 0; pat.moveTime = 0 }
      if (pat.idle >= 0.15) { pat.active = false; pat.distance = 0; pat.moveTime = 0 }
    }
    if (pat.active) pat.t += dt
    var frameIndex = Math.floor(pat.t / 0.04) % 5
    hands.forEach(function (h, i) {
      h.style.display = pat.active && i === frameIndex ? 'block' : 'none'
    })
    if (!pat.active) return
    // Same measured palm anchors as PatGeometry; reflect the whole rectangle on the right.
    var k = state.size / 454
    var w = 446 * k, h = 392 * k
    var palmX = [0.319, 0.356, 0.318, 0.425, 0.298][frameIndex] + 0.393
    var palmY = [0.511, 0.720, 0.835, 0.744, 0.608][frameIndex] - 0.206
    var x = state.size * 0.67 - palmX * w
    if (mirrored()) x = state.size - x - w
    var y = 40 * (446 / 107) * k - palmY * h
    hands[frameIndex].style.width = w + 'px'
    hands[frameIndex].style.height = h + 'px'
    hands[frameIndex].style.left = x + 'px'
    hands[frameIndex].style.top = y + 'px'
    hands[frameIndex].style.transform = mirrored() ? 'scaleX(-1) translateX(-100%)' : ''
  }

  function onTablet(x, y) {
    var q = quad().P
    var lx = x - state.left, ly = y - state.top
    if (mirrored()) lx = state.size - lx
    var ax = q[1].x - q[0].x, ay = q[1].y - q[0].y
    var bx = q[3].x - q[0].x, by = q[3].y - q[0].y
    var det = ax * by - ay * bx
    var u = ((lx - q[0].x) * by - (ly - q[0].y) * bx) / det
    var v = (ax * (ly - q[0].y) - ay * (lx - q[0].x)) / det
    return u >= 0 && u <= 1 && v >= 0 && v <= 1
  }
  // 峰谷（梁文峰 / 梁文谷）显示已按需求移除：平板只显示余额，不再有时钟与倒计时。
  function updateTablet() {}
  function tickTablet(dt) {}

  function saveOptions() {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify({
        fxBowl: state.fxBowl, fxPat: state.fxPat, fxHurt: state.fxHurt,
        theme: state.theme, cueVolumes: state.cueVolumes,
        radarOn: state.radarOn, dropIntervalSec: state.dropIntervalSec,
        soundPack: state.soundPack, stepYuan: state.stepYuan,
        bubbleOn: state.bubbleOn, reminders: state.reminders, turnEndOn: state.turnEndOn, bubbleGifOn: state.bubbleGifOn,
        clickSoundOn: state.clickSoundOn, cueSrc: state.cueSrc, skin: state.skin, autoIronOnFeed: state.autoIronOnFeed,
        idleBubbleOn: state.idleBubbleOn, idleWords: state.idleWords, rotateFlip: state.rotateFlip,
      }))
    } catch (e) {}
  }

  // Four-page settings surface. All placement follows grid/flex layout, including narrow viewports.
  styleEl.textContent += '\n' + [
    '.dshvk1-dialog{--vk-bg:#fff;--vk-ink:#203052;--vk-muted:#65718b;--vk-border:#d9deea;--vk-card:#f2f5fa;--vk-accent:#3c5ddb;background:var(--vk-bg);color:var(--vk-ink);border:1px solid var(--vk-border);border-radius:12px;padding:0;width:min(400px,calc(100vw - 24px));max-height:min(78vh,calc(100dvh - 32px));box-sizing:border-box;box-shadow:0 10px 30px #0003;font:13px/1.45 system-ui,sans-serif;display:flex;flex-direction:column;overflow:hidden}',
    '.dshvk1-mask{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:22000;display:none;align-items:center;justify-content:center;color-scheme:light;padding:12px;box-sizing:border-box}',
    '.dshvk1-mask.dshvk1-mask-open{display:flex}',
    '.dshvk1-dialog[data-theme=dark]{--vk-bg:#171e2d;--vk-ink:#edf2ff;--vk-muted:#a3b0ca;--vk-border:#3b4861;--vk-card:#232e43;--vk-accent:#9eb7ff;color-scheme:dark}',
    '@media(prefers-color-scheme:dark){.dshvk1-dialog[data-theme=auto]{--vk-bg:#171e2d;--vk-ink:#edf2ff;--vk-muted:#a3b0ca;--vk-border:#3b4861;--vk-card:#232e43;--vk-accent:#9eb7ff;color-scheme:dark}}',
    '.dshvk1-dialog header{position:sticky;top:0;z-index:2;background:var(--vk-bg);display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--vk-border)}',
    '.dshvk1-dialog h2{margin:0;font-size:13.5px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dshvk1-dialog h3{margin:10px 0 4px;font-size:11.5px;font-weight:700;color:var(--vk-muted);letter-spacing:.04em}',
    '.dshvk1-back{background:transparent!important;border:none!important;padding:2px 4px!important;color:var(--vk-accent)!important;cursor:pointer}',
    '.dshvk1-close{background:transparent!important;border:none!important;padding:0 4px!important;font-size:18px!important;line-height:1!important;color:var(--vk-muted)!important;cursor:pointer}',
    '.dshvk1-dialog button,.dshvk1-dialog select,.dshvk1-dialog input{font:inherit;color:inherit;box-sizing:border-box}',
    '.dshvk1-dialog button,.dshvk1-dialog select{background:var(--vk-card);border:1px solid var(--vk-border);border-radius:6px;padding:3px 8px;cursor:pointer;font-size:12px}',
    '.dshvk1-dialog button[aria-selected=true]{color:var(--vk-accent);border-color:var(--vk-accent);font-weight:700}',
    '.dshvk1-dialog button:focus-visible,.dshvk1-dialog input:focus-visible,.dshvk1-dialog select:focus-visible{outline:2px solid var(--vk-accent);outline-offset:1px}',
    '.dshvk1-dialog button:disabled{opacity:.5;cursor:default}',
    '.dshvk1-content{padding:2px 10px 10px;overflow:auto;overflow-wrap:anywhere;flex:1 1 auto}',
    '.dshvk1-setting{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid var(--vk-border)}',
    '.dshvk1-setting:last-child{border-bottom:none}',
    '.dshvk1-setting-name{flex:1 1 auto;min-width:0;font-size:12.5px}',
    '.dshvk1-num{width:74px;padding:2px 5px;background:var(--vk-card);border:1px solid var(--vk-border);border-radius:5px;font-size:12px;text-align:right}',
    '.dshvk1-range{width:130px;max-width:46vw;accent-color:var(--vk-accent)}',
    '.dshvk1-actions{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0}',
    '.dshvk1-bubblegif{width:22px;height:22px;object-fit:contain;flex:0 0 auto;border-radius:4px;margin-top:1px;display:none}',
    '.dshvk1-bubblegif.dshvk1-gif-on{display:block}',
    '.dshvk1-snapwrap{margin:6px 0 2px}',
    '.dshvk1-snapstage{position:relative;width:100%;height:132px;border:1px solid var(--vk-border);border-radius:8px;' +
      'background:repeating-linear-gradient(45deg,rgba(60,93,219,.05) 0 6px,transparent 6px 12px),var(--vk-card);overflow:hidden;touch-action:none}',
    '.dshvk1-snapband{position:absolute;background:rgba(60,93,219,.22);border:1px dashed rgba(60,93,219,.65);cursor:ew-resize;box-sizing:border-box}',
    '.dshvk1-snapband.dshvk1-snap-l{left:0;top:0;bottom:0}',
    '.dshvk1-snapband.dshvk1-snap-r{right:0;top:0;bottom:0}',
    '.dshvk1-snapband.dshvk1-snap-t{left:0;right:0;top:0;cursor:ns-resize}',
    '.dshvk1-snapband.dshvk1-snap-b{left:0;right:0;bottom:0;cursor:ns-resize}',
    '.dshvk1-snapflip{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:#c0392b;cursor:ew-resize}',
    '.dshvk1-snapflip::after{content:"";position:absolute;left:-4px;right:-4px;top:0;bottom:0}',
    '.dshvk1-snapread{margin-top:4px;font-size:11.5px;color:var(--vk-muted);font-variant-numeric:tabular-nums}',
    '.dshvk1-cuebox{padding:5px 0;border-bottom:1px solid var(--vk-border)}',
    '.dshvk1-cuebox:last-child{border-bottom:none}',
    '.dshvk1-cuehead{display:flex;align-items:center;justify-content:space-between;gap:6px}',
    '.dshvk1-cuename{font-size:12.5px}',
    '.dshvk1-cuesel{max-width:52%;padding:1px 4px;border:1px solid var(--vk-border);border-radius:5px;background:var(--vk-card);color:inherit;font-size:11.5px}',
    '.dshvk1-cuevol{display:flex;align-items:center;gap:6px;margin-top:2px}',
    '.dshvk1-cuevollabel{font-size:11px;color:var(--vk-muted)}',
    '.dshvk1-textarea{width:100%;box-sizing:border-box;padding:5px;background:var(--vk-card);border:1px solid var(--vk-border);' +
      'border-radius:5px;font:12px/1.5 system-ui,sans-serif;color:inherit;resize:vertical}',
    '.dshvk1-file{max-width:56%;font-size:11px;color:var(--vk-muted)}',
    '.dshvk1-reslist{max-height:200px;overflow:auto;border:1px solid var(--vk-border);border-radius:6px;margin:6px 0}',
    '.dshvk1-resrow{display:flex;justify-content:space-between;gap:8px;padding:3px 7px;border-bottom:1px solid var(--vk-border);font-size:11.5px}',
    '.dshvk1-resrow:last-child{border-bottom:none}',
    '.dshvk1-resname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dshvk1-resmeta{color:var(--vk-muted);flex:0 0 auto;font-variant-numeric:tabular-nums}',
    '.dshvk1-hint{color:var(--vk-muted);font-size:11.5px;margin:4px 0 6px;line-height:1.45}',
    '.dshvk1-status{min-height:1.4em;margin:4px 0;color:var(--vk-accent);font-size:12px}',
    '.dshvk1-clip{border:1px solid var(--vk-border);border-radius:8px;padding:8px;margin:6px 0}',
    '.dshvk1-dialog input[type=text]{max-width:100%;width:100%;padding:4px;background:var(--vk-card);border:1px solid var(--vk-border);border-radius:5px;font-size:12px}',
    '.dshvk1-wave{display:block;width:100%;height:60px;background:var(--vk-card);border-radius:5px;margin:6px 0}',
    '.dshvk1-menu-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 6px 5px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(32,49,112,.25));margin-bottom:3px}',
    '.dshvk1-menu-bal{font-size:13px;font-weight:800;font-variant-numeric:tabular-nums}',
    '.dshvk1-menu-mini{background:var(--dsw-alias-bg-layer-1,transparent);border:1px solid var(--dsw-alias-border-l2,rgba(32,49,112,.35));border-radius:5px;padding:1px 7px;font-size:11.5px;cursor:pointer;color:inherit;font-family:inherit}',
    '.dshvk1-menu-range{width:104px;accent-color:var(--dsw-alias-brand-primary,#203170)}',
  ].join('\n')
  var settingsOpen = false
  // 照搬 dsh-whale-widget 的设置面板结构：一层 .xxmask 遮罩 + 居中的 .xxcard 卡片，
  // 点遮罩关闭、卡片内是「sticky 表头 + 可滚动内容区」。
  var settingsMask = document.createElement('div')
  settingsMask.className = 'dshvk1-mask'
  var settings = document.createElement('div')
  settings.className = 'dshvk1-dialog'
  settings.setAttribute('role', 'dialog')
  settings.setAttribute('aria-modal', 'true')
  settings.setAttribute('aria-labelledby', 'dshvk1-settings-title')
  var settingsHeader = document.createElement('header')
  var settingsBack = document.createElement('button')
  settingsBack.type = 'button'
  settingsBack.className = 'dshvk1-back'
  settingsBack.textContent = '\u2039 \u8FD4\u56DE'
  // 二级界面的返回：回到一级菜单（即挂件右键菜单），而不是直接关窗。
  settingsBack.addEventListener('click', function () {
    stopPreview()
    closeSettingsPanel()
    var r = root.getBoundingClientRect()
    // 按钮在左侧时菜单往右展开；镜像后按钮到右侧，菜单往左收
    openMenu(mirrored() ? r.right : r.left, r.top + 2)
  })
  settingsHeader.appendChild(settingsBack)
  var settingsTitle = document.createElement('h2')
  settingsTitle.id = 'dshvk1-settings-title'
  settingsTitle.textContent = '\u8BBE\u7F6E'
  settingsHeader.appendChild(settingsTitle)
  var closeSettings = document.createElement('button')
  closeSettings.type = 'button'
  closeSettings.className = 'dshvk1-close'
  closeSettings.title = '\u5173\u95ED'
  closeSettings.textContent = '\u00D7'
  closeSettings.addEventListener('click', function () { closeSettingsPanel() })
  settingsHeader.appendChild(closeSettings)
  settings.appendChild(settingsHeader)
  var content = document.createElement('div')
  content.className = 'dshvk1-content'
  settings.appendChild(content)
  settingsMask.appendChild(settings)
  settingsMask.addEventListener('click', function (e) { if (e.target === settingsMask) closeSettingsPanel() })
  document.body.appendChild(settingsMask)
  function closeSettingsPanel() {
    if (!settingsOpen) return
    settingsOpen = false
    settingsMask.classList.remove('dshvk1-mask-open')
    stopPreview()
  }
  var settingsPage = 'display'
  var libraryCue = 0
  var renderGeneration = 0
  function element(tag, text, parent, className) {
    var el = document.createElement(tag)
    if (text != null) el.textContent = text
    if (className) el.className = className
    if (parent) parent.appendChild(el)
    return el
  }
  function action(parent, text, fn) {
    var b = element('button', text, parent)
    b.type = 'button'; b.addEventListener('click', fn)
    return b
  }
  function hint(text, parent) { return element('p', text, parent || content, 'dshvk1-hint') }
  // 音效库编辑器的数值/滑杆控件（设置主界面已改用 row() + numberBox()/rangeBox()）
  function numeric(parent, text, value, min, max, step, fn, type) {
    var label = element('label', text, parent)
    var input = element('input', null, label)
    input.type = type || 'number'; input.min = min; input.max = max; input.step = step; input.value = value
    var output = type === 'range' ? element('span', value + '%', label) : null
    input.addEventListener('input', function () {
      if (input.value === '' || !input.validity.valid) return
      var v = Number(input.value)
      if (!isFinite(v) || v < min || v > max) return
      if (output) output.textContent = v + '%'
      fn(v)
    })
    return input
  }
  function onEscape(e) {
    if (e.key === 'Escape') { closeMenu(); if (settingsOpen) { closeSettingsPanel(); e.stopPropagation() } }
  }
  document.addEventListener('keydown', onEscape, true)
  var SETTINGS_PAGES = {
    look: '\u5F62\u8C61\u4E0E\u529F\u80FD',
    snap: '\u5438\u9644\u4E0E\u7FFB\u8F6C',
    sound: '\u58F0\u97F3\u4E0E\u97F3\u6548',
    library: '\u97F3\u6548\u5E93',
    demo: '\u6F14\u793A\uFF08\u53EA\u64AD\u52A8\u753B\uFF09',
    bubble: '\u6C14\u6CE1\u4E0E\u63D0\u9192\u8BCD',
    resources: '\u8D44\u6E90\u7BA1\u7406',
    about: '\u5173\u4E8E',
  }
  function showSettings(page) {
    blockPat(); closeMenu()
    settingsPage = SETTINGS_PAGES[page] ? page : 'snap'
    renderSettings()
    if (!settingsOpen) {
      settingsOpen = true
      settingsMask.classList.add('dshvk1-mask-open')
    }
  }
  // 二级页统一入口：标题由 settingsPage 决定，点标题左侧「‹ 返回」回到一级菜单。
  function setPage(page) { stopPreview(); settingsPage = page; renderSettings() }
  function section(title) { return element('h3', title, content) }
  function row(label, control) {
    var r = element('div', null, content, 'dshvk1-setting')
    var l = element('span', null, r, 'dshvk1-setting-name')
    l.textContent = label
    if (control) r.appendChild(control)
    return r
  }
  function checkbox(checked, onChange) {
    var box = element('input')
    box.type = 'checkbox'
    box.checked = !!checked
    box.addEventListener('change', function () { onChange(box.checked) })
    return box
  }
  function numberBox(value, min, max, step, onChange) {
    var input = element('input', null, null, 'dshvk1-num')
    input.type = 'number'
    input.min = min; input.max = max; input.step = step; input.value = value
    input.addEventListener('change', function () {
      var v = Number(input.value)
      if (!isFinite(v)) return
      onChange(clamp(v, min, max))
    })
    return input
  }
  function rangeBox(value, min, max, step, onChange) {
    var input = element('input', null, null, 'dshvk1-range')
    input.type = 'range'
    input.min = min; input.max = max; input.step = step; input.value = value
    input.addEventListener('input', function () { onChange(Number(input.value)) })
    return input
  }
  function chips(options, current, onPick) {
    var wrap = element('div', null, content, 'dshvk1-actions')
    options.forEach(function (opt) {
      var b = action(wrap, opt[1], function () { onPick(opt[0]) })
      b.setAttribute('aria-selected', String(current === opt[0]))
    })
    return wrap
  }

  // 吸附/翻转可视化编辑：一块 100%×62% 的「屏幕」预览，四边吸附区用半透明色带表示，
  // 翻转线是红色竖线；全部可拖。比例模式按百分比、像素模式按当前视口换算。
  function renderSnapEditor() {
    var isPx = snapConfig.mode === 'px'
    var box = isPx ? snapConfig.px : snapConfig.ratio
    var vp = viewport()
    var wrap = element('div', null, content, 'dshvk1-snapwrap')
    var stageEl = element('div', null, wrap, 'dshvk1-snapstage')
    var bands = {}
    ;[['L', 'dshvk1-snap-l'], ['T', 'dshvk1-snap-t'], ['R', 'dshvk1-snap-r'], ['B', 'dshvk1-snap-b']].forEach(function (it) {
      var d = element('div', null, stageEl, 'dshvk1-snapband ' + it[1])
      bands[it[0]] = d
    })
    var flipLine = element('div', null, stageEl, 'dshvk1-snapflip')
    var readout = element('div', null, wrap, 'dshvk1-snapread')

    // 百分比 <-> 预览坐标（预览就是视口缩略图，所以比例模式天然一一对应）
    function pctOf(key, value) {
      if (!isPx) return value
      if (key === 'L' || key === 'F') return (value / Math.max(1, vp.w)) * 100
      if (key === 'R') return (value / Math.max(1, vp.w)) * 100
      if (key === 'T') return (value / Math.max(1, vp.h)) * 100
      return (value / Math.max(1, vp.h)) * 100
    }
    function draw() {
      bands.L.style.width = clamp(pctOf('L', box.L), 0, 45) + '%'
      bands.R.style.width = clamp(pctOf('R', box.R), 0, 45) + '%'
      bands.T.style.height = clamp(pctOf('T', box.T), 0, 45) + '%'
      bands.B.style.height = clamp(pctOf('B', box.B), 0, 45) + '%'
      flipLine.style.left = clamp(pctOf('F', box.F), 0, 100) + '%'
      readout.textContent = '\u5DE6 ' + fmt2(box.L) + ' \u00B7 \u4E0A ' + fmt2(box.T) +
        ' \u00B7 \u53F3 ' + fmt2(box.R) + ' \u00B7 \u4E0B ' + fmt2(box.B) +
        ' \u00B7 \u7FFB\u8F6C\u7EBF ' + fmt2(box.F) + (isPx ? 'px' : '%')
    }
    function commit() {
      fixSnapConfig(snapConfig, snapConfig.mode)
      saveSnapConfig(); settle(); saveAnchor(); draw()
    }
    // 拖动：把鼠标位置换算成比例/像素值
    function dragBand(key, e) {
      var rect = stageEl.getBoundingClientRect()
      var px = clamp((e.clientX - rect.left) / Math.max(1, rect.width) * 100, 0, 45)
      var py = clamp((e.clientY - rect.top) / Math.max(1, rect.height) * 100, 0, 45)
      if (key === 'L') box.L = isPx ? Math.round(px / 100 * vp.w) : Math.round(px * 100) / 100
      if (key === 'R') box.R = isPx ? Math.round((100 - px) / 100 * vp.w) : Math.round((100 - px) * 100) / 100
      if (key === 'T') box.T = isPx ? Math.round(py / 100 * vp.h) : Math.round(py * 100) / 100
      if (key === 'B') box.B = isPx ? Math.round((100 - py) / 100 * vp.h) : Math.round((100 - py) * 100) / 100
      commit()
    }
    function dragFlip(e) {
      var rect = stageEl.getBoundingClientRect()
      var p = clamp((e.clientX - rect.left) / Math.max(1, rect.width) * 100, 0, 100)
      box.F = isPx ? Math.round(p / 100 * vp.w) : Math.round(p * 100) / 100
      commit()
    }
    function onDrag(move) {
      return function (startEvent) {
        startEvent.preventDefault()
        try { stageEl.setPointerCapture(startEvent.pointerId) } catch (err) {}
        function mv(ev) { move(ev) }
        function up() {
          stageEl.removeEventListener('pointermove', mv)
          stageEl.removeEventListener('pointerup', up)
          stageEl.removeEventListener('pointercancel', up)
        }
        stageEl.addEventListener('pointermove', mv)
        stageEl.addEventListener('pointerup', up)
        stageEl.addEventListener('pointercancel', up)
        move(startEvent)
      }
    }
    bands.L.addEventListener('pointerdown', onDrag(function (e) { dragBand('L', e) }))
    bands.R.addEventListener('pointerdown', onDrag(function (e) { dragBand('R', e) }))
    bands.T.addEventListener('pointerdown', onDrag(function (e) { dragBand('T', e) }))
    bands.B.addEventListener('pointerdown', onDrag(function (e) { dragBand('B', e) }))
    flipLine.addEventListener('pointerdown', onDrag(dragFlip))
    draw()
  }

  function renderSettingsIfOpen() { if (settingsOpen) renderSettings() }

  function renderSettings() {
    renderGeneration++
    settings.dataset.theme = state.theme
    settingsTitle.textContent = SETTINGS_PAGES[settingsPage] || '\u8BBE\u7F6E'
    content.textContent = ''

    if (settingsPage === 'look') {
      section('\u7ACB\u7ED8\uFF08\u76AE\u80A4\uFF09')
      var skinWrap = element('div', null, content, 'dshvk1-actions')
      Object.keys(SKINS).forEach(function (id) {
        var b = action(skinWrap, SKINS[id].name, function () { applySkin(id); renderSettings() })
        b.setAttribute('aria-selected', String(state.skin === id))
      })
      // 自定义立绘：上传一张图（最长边 512，PNG），存 IndexedDB 的 skins 表
      var upRow = element('div', null, content, 'dshvk1-setting')
      element('span', '\u81EA\u5B9A\u4E49\u7ACB\u7ED8', upRow, 'dshvk1-setting-name')
      var fileInput = element('input', null, upRow, 'dshvk1-file')
      fileInput.type = 'file'
      fileInput.accept = 'image/png,image/jpeg,image/webp'
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0]
        if (!file) return
        shrinkImage(file, function (dataUrl) {
          if (!dataUrl) { alert('\u56FE\u7247\u8BFB\u53D6\u5931\u8D25'); return }
          registerCustomSkin(dataUrl)
          saveCustomSkin(dataUrl, function (ok) {
            applySkin('custom')
            renderSettings()
            if (!ok) alert('\u5B58\u50A8\u5931\u8D25\uFF0C\u672C\u6B21\u4EC5\u4E34\u65F6\u751F\u6548')
          })
        })
      })
      action(content, '\u5220\u9664\u81EA\u5B9A\u4E49\u7ACB\u7ED8', function () {
        openSkinDb(function (db) {
          if (!db) return
          try {
            var tx = db.transaction('skins', 'readwrite')
            tx.objectStore('skins').delete('custom')
            tx.oncomplete = function () { delete SKINS.custom; applySkin('vk1'); renderSettings() }
          } catch (err) {}
        })
      })
      hint('\u4E0A\u4F20\u540E\u81EA\u52A8\u5207\u5230\u300C\u81EA\u5B9A\u4E49\u300D\uFF1B\u56FE\u50CF\u6700\u957F\u8FB9\u538B\u5230 512px\uFF0C\u5B58\u5728\u6D4F\u89C8\u5668 IndexedDB\uFF0C\u4E0D\u4E0A\u4F20\u3002')
      // 图片翻转：只有非「控制台原生」皮肤可用（原生皮肤锁死，不做镜像以外的翻转）
      if (skinOf(state.skin).board !== 'sprite') {
        section('\u7ACB\u7ED8\u7FFB\u8F6C')
        row('\u7FFB\u8F6C\u7ACB\u7ED8\uFF08\u5DE6\u53F3\u5BF9\u8C03\uFF09', checkbox(state.rotateFlip === true, function (v) {
          state.rotateFlip = v
          saveOptions()
          applySkin(state.skin)
          renderSettings()
        }))
        hint('\u63A7\u5236\u53F0\u539F\u751F\u753B\u4E0D\u53EF\u7FFB\u8F6C\uFF08\u5B83\u81EA\u5E26\u65B9\u5411\uFF09\uFF1B\u5176\u4F59\u76AE\u80A4\u53EF\u5355\u72EC\u8BBE\u7F6E\u3002')
      }
      section('\u529F\u80FD\u5F00\u5173')
      ;[['fxBowl', '\u5145\u503C\u540E\u6389\u843D\u996D\u76C6\uFF08\u624B\u52A8\u62D6\u53D6\uFF09'],
        ['fxPat', '\u9F20\u6807\u629A\u6478\u4F1A\u5F00\u5FC3'],
        ['fxHurt', '\u6263\u8D39\u65F6\u64AD\u653E\u97F3\u6548\u4E0E\u52A8\u753B'],
        ['clickSoundOn', '\u5355\u51FB\u89D2\u8272\u64AD\u653E\u97F3\u6548'],
        ['bubbleOn', '\u663E\u793A\u6C14\u6CE1'],
        ['idleBubbleOn', '\u81EA\u52A8\u5192\u51FA\u968F\u673A\u8BCD'],
        ['autoIronOnFeed', '\u96F7\u8FBE\u5438\u9644\u540E\u94C1\u76C6\u76F4\u63A5\u6263\u5934'],
        ['turnEndOn', '\u4EFB\u52A1\u7ED3\u675F\u97F3\uFF08\u6BCF\u8F6E\uFF09']].forEach(function (it) {
        row(it[1], checkbox(state[it[0]] !== false, function (v) {
          state[it[0]] = v
          saveOptions()
          if (!v && it[0] === 'fxPat') blockPat()
        }))
      })
      section('\u81EA\u52A8\u5192\u8BCD')
      var idleTa = element('textarea', null, content, 'dshvk1-textarea')
      idleTa.rows = 4
      idleTa.placeholder = '\u4E00\u884C\u4E00\u53E5\uFF1B\u7559\u7A7A\u5C31\u7528\u5185\u7F6E\u968F\u673A\u8BCD\uFF08\u6765\u81EA\u88C5\u9970\u9CB8\u9C7C\u63D2\u4EF6\uFF09'
      idleTa.value = (state.idleWords || []).join('\n')
      action(content, '\u4FDD\u5B58\u81EA\u52A8\u5192\u8BCD', function () {
        var lines = String(idleTa.value || '').split('\n').map(function (x) { return x.trim().slice(0, 80) }).filter(Boolean).slice(0, 40)
        state.idleWords = lines
        saveOptions()
        renderSettings()
      })
      action(content, '把当前设置存为默认', function () {
        // 当前 options 全量 POST 给宿主 → defaults.json；新装或清了 localStorage 时用它
        var body = {
          fxBowl: state.fxBowl, fxPat: state.fxPat, fxHurt: state.fxHurt,
          theme: state.theme, cueVolumes: state.cueVolumes,
          radarOn: state.radarOn, dropIntervalSec: state.dropIntervalSec,
          soundPack: state.soundPack, stepYuan: state.stepYuan,
          bubbleOn: state.bubbleOn, reminders: state.reminders, turnEndOn: state.turnEndOn,
          bubbleGifOn: state.bubbleGifOn, clickSoundOn: state.clickSoundOn,
          cueSrc: state.cueSrc, skin: state.skin, autoIronOnFeed: state.autoIronOnFeed,
          idleBubbleOn: state.idleBubbleOn, idleWords: state.idleWords, rotateFlip: state.rotateFlip,
        }
        fetch(BASE + '/defaults.json', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then(function (r) { return r.json() })
          .then(function (d) { showBubble(d && d.ok ? '已保存为默认' : '保存失败', true, 'cost') })
          .catch(function () { showBubble('保存失败', true, 'cost') })
      })
      action(content, '\u6062\u590D\u5185\u7F6E\u968F\u673A\u8BCD', function () {
        state.idleWords = []
        saveOptions()
        renderSettings()
      })
      hint('\u7559\u7A7A = \u7528\u5185\u7F6E\u90A3\u5957\u52A0\u6743\u968F\u673A\u8BCD\uFF1B\u6BCF 20\u201345 \u79D2\u5192\u4E00\u53E5\uFF0C\u4E0E\u6D88\u8017\u63D0\u793A\u4E92\u4E0D\u8986\u76D6\u3002')
    } else if (settingsPage === 'snap') {
      section('\u5438\u9644\u533A\u57DF')
      chips([['ratio', '\u6309\u6BD4\u4F8B'], ['px', '\u6309\u50CF\u7D20'], ['off', '\u5173\u95ED\u5438\u9644']], snapConfig.mode, function (mode) {
        snapConfig.mode = mode
        fixSnapConfig(snapConfig, 'ratio'); fixSnapConfig(snapConfig, 'px')
        saveSnapConfig(); settle(); saveAnchor(); renderSettings()
      })
      if (snapConfig.mode !== 'off') {
        renderSnapEditor()
        hint('\u76F4\u63A5\u62D6\u52A8\u56DB\u8272\u5438\u9644\u5E26\u4E0E\u7EA2\u8272\u7FFB\u8F6C\u7EBF\uFF1B\u4E0B\u65B9\u6570\u5B57\u4F1A\u8DDF\u7740\u53D8\u3002\u5DE6\u53F3\u770B\u89D2\u8272\u4E2D\u5FC3 x\u3001\u4E0A\u4E0B\u770B\u4E2D\u5FC3 y\u3002')
      } else {
        hint('\u5DF2\u5173\u95ED\uFF1A\u89D2\u8272\u505C\u5728\u677E\u624B\u4F4D\u7F6E\uFF0C\u4E5F\u4E0D\u505A\u5DE6\u53F3\u955C\u50CF\u3002')
      }
      section('\u8FB9\u8DD1\u907F\u8BA9')
      row('\u907F\u8BA9\u6EDA\u52A8\u6761', checkbox(state.scrollGapOn, setScrollGapOn))
      row('\u907F\u8BA9\u5BBD\u5EA6\uFF08px\uFF09', numberBox(state.scrollGapPx, 0, 100, 1, setScrollGapPx))
    } else if (settingsPage === 'sound') {
      section('\u6263\u8D39\u63D0\u793A')
      row('\u6B65\u957F\uFF08\u6BCF\u8017 \u00A5X \u63D0\u793A\u4E00\u6B21\uFF09', numberBox(state.stepYuan, STEP_MIN, STEP_MAX, 0.01, function (v) {
        state.stepYuan = Math.round(clamp(v, STEP_MIN, STEP_MAX) * 100) / 100
        saveOptions()
        renderSettings()
      }))
      section('\u603B\u5F00\u5173')
      row('\u5F00\u542F\u58F0\u97F3', checkbox(state.soundOn, function (on) { state.soundOn = on; saveSound(); if (!on) stopPlaying() }))
      row('\u603B\u97F3\u91CF', rangeBox(state.volume, 0, 100, 1, function (v) { state.volume = v; saveSound() }))
      section('\u9010\u4E2A\u97F3\u6548')
      hint('\u6BCF\u4E2A\u97F3\u6548\u90FD\u53EF\u5355\u72EC\u9009\u6E90\uFF08\u9ED8\u8BA4 = \u63A7\u5236\u53F0\u539F\u751F\uFF09\u3001\u5355\u72EC\u8C03\u97F3\u91CF\u3001\u5355\u72EC\u8BD5\u542C\u3002')
      CUE_NAMES.forEach(function (name, i) {
        var box = element('div', null, content, 'dshvk1-cuebox')
        var head = element('div', null, box, 'dshvk1-cuehead')
        element('span', name, head, 'dshvk1-cuename')
        var sel = element('select', null, head, 'dshvk1-cuesel')
        CUE_SOURCES.forEach(function (src) {
          var opt = element('option', src.name, sel)
          opt.value = src.id
        })
        sel.value = (state.cueSrc && state.cueSrc[i]) || ''
        sel.addEventListener('change', function () { setCueSource(i, sel.value) })
        var volRow = element('div', null, box, 'dshvk1-cuevol')
        element('span', '\u97F3\u91CF', volRow, 'dshvk1-cuevollabel')
        volRow.appendChild(rangeBox(state.cueVolumes[i], 0, 100, 1, function (v) { state.cueVolumes[i] = v; saveOptions() }))
        action(volRow, '\u8BD5\u542C', function () { playPool(cuePools[i]) })
      })
      hint('\u603B\u97F3\u91CF\u4E0E\u5206\u9879\u97F3\u91CF\u76F8\u4E58\uFF1B\u81EA\u5B9A\u4E49\u97F3\u9891\u5728\u300C\u97F3\u6548\u5E93\u300D\u3002')
    } else if (settingsPage === 'bubble') {
      section('\u6C14\u6CE1')
      row('\u663E\u793A\u6C14\u6CE1', checkbox(state.bubbleOn, function (v) { state.bubbleOn = v; saveOptions() }))
      row('\u4EFB\u52A1\u7ED3\u675F\u97F3', checkbox(state.turnEndOn !== false, function (v) { state.turnEndOn = v; saveOptions() }))
      row('\u6C14\u6CE1\u88C5\u9970\u52A8\u56FE', checkbox(state.bubbleGifOn !== false, function (v) { state.bubbleGifOn = v; saveOptions() }))
      hint('\u6BCF\u8F6E\u7ED3\u675F\u65F6\u64AD\u4E00\u58F0\u5E76\u5F39\u4E00\u6761\u6C14\u6CE1\uFF08\u663E\u793A\u672C\u8F6E\u6D88\u8017\uFF09\u3002')
      section('\u63D0\u9192\u8BCD')
      var ta = element('textarea', null, content, 'dshvk1-textarea')
      ta.value = state.reminders.join('\n')
      ta.rows = 5
      ta.placeholder = '\u4E00\u884C\u4E00\u53E5\uFF1B{cost} \u4F1A\u88AB\u672C\u8F6E\u91D1\u989D\u66FF\u6362'
      var saveReminders = action(content, '\u4FDD\u5B58\u63D0\u9192\u8BCD', function () {
        var lines = String(ta.value || '').split('\n').map(function (x) { return x.trim().slice(0, 60) }).filter(Boolean).slice(0, 20)
        state.reminders = lines.length ? lines : ['\u672C\u8F6E \u00A5{cost}']
        saveOptions()
        renderSettings()
      })
      action(content, '\u6062\u590D\u9ED8\u8BA4', function () {
        state.reminders = ['\u672C\u8F6E \u00A5{cost}', '\u8FD9\u4E00\u8F6E\u82B1\u4E86 \u00A5{cost}', '\u5E10\u5355\u62A5\u544A\uFF1A\u00A5{cost}']
        saveOptions(); renderSettings()
      })
      hint('\u6BCF\u6B21\u8F6E\u672B\u6309\u987A\u5E8F\u8F6E\u6362\u4E00\u53E5\uFF0C\u6700\u591A 20 \u884C\u3002{cost} \u662F\u5360\u4F4D\u7B26\u3002')
    } else if (settingsPage === 'resources') {
      section('\u968F\u5305\u7D20\u6750')
      var info = element('div', null, content, 'dshvk1-hint')
      info.textContent = '\u8BFB\u53D6\u4E2D\u2026'
      fetch(BASE + '/resources.json', { cache: 'no-store' })
        .then(function (r) { return r.json() })
        .then(function (d) {
          if (!d || !d.ok) { info.textContent = '\u8D44\u6E90\u6E05\u5355\u4E0D\u53EF\u7528'; return }
          var kb = Math.round(d.totalBytes / 1024)
          info.textContent = d.count + ' \u4E2A\u7D20\u6750\uFF0C\u5171\u7EA6 ' + kb + ' KB\u3002\u90FD\u662F\u968F\u5305\u5206\u53D1\uFF0C\u4E0D\u4E0B\u8F7D\u3001\u4E0D\u4E0A\u4F20\u3002'
          var box = element('div', null, content, 'dshvk1-reslist')
          d.items.forEach(function (it) {
            var li = element('div', null, box, 'dshvk1-resrow')
            var name = element('span', it.file, li, 'dshvk1-resname')
            var meta = element('span', (it.width ? it.width + '\u00D7' + it.height + ' \u00B7 ' : '') + Math.round((it.bytes || 0) / 1024) + ' KB', li, 'dshvk1-resmeta')
            name.title = it.source || ''
          })
        })
        .catch(function () { info.textContent = '\u8D44\u6E90\u6E05\u5355\u8BFB\u53D6\u5931\u8D25' })
      hint('\u97F3\u6548\u53EF\u5728\u300C\u97F3\u6548\u5E93\u300D\u91CC\u6362\u6210\u81EA\u5DF1\u7684\u97F3\u9891\uFF1B\u8FD9\u91CC\u53EA\u5217\u968F\u5305\u7D20\u6750\u4E0E\u4F53\u79EF\u3002')
    } else if (settingsPage === 'about') {
      section('\u7248\u672C')
      hint('dsh-vk1-balance-pet v' + (state.hostVersion || '2.0.0'))
      section('\u4F59\u989D\u6E20\u9053')
      hint('\u5B98\u65B9\u8D26\u53F7\u51ED\u636E\u4F18\u5148\uFF1B\u65E0\u8D26\u53F7\u670D\u52A1\u65F6\u56DE\u9000 DSH \u5DF2\u914D\u7F6E\u7684 API Key\u3002\u4E0D\u63D0\u4F9B Key \u8F93\u5165\u3002')
    } else {
      renderLibrary()
    }
  }

  // 四路音效槽的显示名：与 DEFAULT_SOUNDS / state.cueVolumes / activeClips 的索引一一对应。
  // （v2.0.0 重构设置页时这一行被误删，导致声音页 ReferenceError，v2.0.1 修复。）
  // 音效槽命名：顺序与 cuePools 槽位一一对应（0..5）
  var CUE_NAMES = [
    '\u6389\u8840\uFF08\u6BCF\u6B65\u6263\u8D39\uFF09',
    '\u56DE\u8840\uFF08\u5582\u996D\u5165\u8D26\uFF09',
    '\u94C1\u76C6\u843D\u5934',
    '\u53CC\u51FB\u53D6\u76C6',
    '\u4EFB\u52A1\u7ED3\u675F',
    '\u5355\u51FB\u89D2\u8272',
  ]
  var CUE_SOURCES = [
    { id: '', name: '\u9ED8\u8BA4' },
    { id: BASE + '/duck_press.mp3', name: '\u5C0F\u9EC4\u9E2D\u00B7\u6309\u4E0B' },
    { id: BASE + '/duck_release.mp3', name: '\u5C0F\u9EC4\u9E2D\u00B7\u677E\u5F00' },
    { id: BASE + '/orb.wav', name: '\u7ECF\u9A8C\u7403' },
    { id: BASE + '/cost.wav', name: '\u6BCF\u8F6E\u6D88\u8017' },
    { id: BASE + '/task_end.wav', name: '\u4EFB\u52A1\u7ED3\u675F\u97F3' },
    { id: BASE + '/fx1_press.mp3', name: '\u97F3\u6548\u7EC41\u00B7\u6309\u4E0B' },
    { id: BASE + '/fx1_release.mp3', name: '\u97F3\u6548\u7EC41\u00B7\u677E\u5F00' },
    { id: BASE + '/hit.mp3', name: '\u63A7\u5236\u53F0\u00B7\u6253\u51FB' },
    { id: BASE + '/feed.mp3', name: '\u63A7\u5236\u53F0\u00B7\u56DE\u8840' },
    { id: BASE + '/pot_land.mp3', name: '\u63A7\u5236\u53F0\u00B7\u94C1\u76C6\u843D\u5730' },
    { id: BASE + '/pot_off.mp3', name: '\u63A7\u5236\u53F0\u00B7\u53D6\u76C6' },
  ]
  var DEFAULT_SOUNDS = [HIT_SOUND, FEED_SOUND, BASE + '/pot_land.mp3', BASE + '/pot_off.mp3', BASE + '/task_end.wav']
  var soundDb = null, audioContext = null, previewAudio = null, previewUrl = null
  var clips = [], activeClips = {}, libraryStatus = ''
  function stopPool(pool) {
    pool.pool.forEach(function (a) { clearTimeout(a.trimTimer); a.pause(); a.removeAttribute('src'); a.load() })
    if (pool.url) URL.revokeObjectURL(pool.url)
  }
  function stopPlaying() {
    cuePools.forEach(function (p) { p.pool.forEach(function (a) { clearTimeout(a.trimTimer); a.pause() }) })
    stopPreview()
  }
  function stopPreview() {
    if (previewAudio) { previewAudio.pause(); previewAudio.removeAttribute('src'); previewAudio.load(); previewAudio = null }
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null }
  }
  function stopAudio() {
    stopPreview(); cuePools.forEach(stopPool)
    if (audioContext) audioContext.close().catch(function () {})
  }
  function activateClip(cue, id, persist) {
    var clip = clips.find(function (c) { return c.id === id && c.cue === cue })
    stopPool(cuePools[cue])
    var url = clip ? URL.createObjectURL(clip.rendered) : DEFAULT_SOUNDS[cue]
    var p = makePool(url, cue === 0 ? 4 : 2)
    p.cue = cue; if (clip) p.url = url
    cuePools[cue] = p
    hitPool = cuePools[0]; feedPool = cuePools[1]; landPool = cuePools[2]; offPool = cuePools[3]
    activeClips[cue] = clip ? clip.id : ''
    if (persist) try { localStorage.setItem('dsh-vk1-active-clips', JSON.stringify(activeClips)) } catch (e) {}
  }
  function dbChange(mode, value) {
    return new Promise(function (resolve, reject) {
      if (!soundDb) return reject(new Error('浏览器音效存储不可用'))
      var tx = soundDb.transaction('clips', 'readwrite')
      var store = tx.objectStore('clips')
      if (mode === 'put') store.put(value)
      else store.delete(value)
      tx.oncomplete = resolve; tx.onerror = function () { reject(tx.error || new Error('音效保存失败')) }
      tx.onabort = function () { reject(tx.error || new Error('音效保存中止')) }
    })
  }
  function initSoundLibrary() {
    try {
      activeClips = JSON.parse(localStorage.getItem('dsh-vk1-active-clips') || '{}') || {}
      var request = indexedDB.open('dsh-vk1-sounds', 2)
      request.onupgradeneeded = function (ev) {
        var db = request.result
        if (!db.objectStoreNames.contains('clips')) db.createObjectStore('clips', { keyPath: 'id' })
        // v2：自定义立绘图（一个 key 'custom' 一条记录）
        if (!db.objectStoreNames.contains('skins')) db.createObjectStore('skins', { keyPath: 'id' })
      }
      request.onerror = function () { libraryStatus = '浏览器音效存储不可用，仍可使用出厂音效。' }
      request.onsuccess = function () {
        if (stopped) { request.result.close(); return }
        soundDb = request.result
        soundDb.onversionchange = function () { soundDb.close(); soundDb = null }
        var get = soundDb.transaction('clips', 'readonly').objectStore('clips').getAll()
        get.onsuccess = function () {
          if (stopped) return
          clips = get.result
          CUE_NAMES.forEach(function (_, i) { activateClip(i, activeClips[i], false) })
          if (settingsOpen && settingsPage === 'library') renderSettings()
        }
      }
    } catch (e) { libraryStatus = '浏览器音效存储不可用，仍可使用出厂音效。' }
  }
  async function decodeSound(blob) {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)()
    return audioContext.decodeAudioData(await blob.arrayBuffer())
  }
  function wavBlob(buffer, start, end, gain) {
    var first = Math.floor(start * buffer.sampleRate)
    var lastFrame = Math.min(buffer.length, Math.floor(end * buffer.sampleRate))
    var count = lastFrame - first, channels = Math.min(2, buffer.numberOfChannels)
    if (count <= 0) throw new Error('终点必须大于起点')
    var data = new ArrayBuffer(44 + count * channels * 2), view = new DataView(data)
    function chars(offset, s) { for (var i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)) }
    chars(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); chars(8, 'WAVEfmt ')
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true)
    view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true)
    view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); chars(36, 'data')
    view.setUint32(40, count * channels * 2, true)
    for (var c = 0; c < channels; c++) {
      var samples = buffer.getChannelData(c)
      for (var f = 0; f < count; f++) {
        var sample = clamp(samples[first + f] * gain / 100, -1, 1)
        view.setInt16(44 + (f * channels + c) * 2, sample * (sample < 0 ? 32768 : 32767), true)
      }
    }
    return new Blob([data], { type: 'audio/wav' })
  }
  function renderLibrary() {
    hint('音频只保存在本浏览器，不上传服务器。支持浏览器能解码的 MP3 / WAV / M4A / AAC / FLAC / OGG 等，单文件最大 50 MB。')
    var select = element('select', null, content)
    select.setAttribute('aria-label', '选择音效类别')
    CUE_NAMES.forEach(function (name, i) { var o = element('option', name, select); o.value = i })
    select.value = libraryCue
    select.addEventListener('change', function () { libraryCue = Number(select.value); renderSettings() })
    var actions = element('div', null, content, 'dshvk1-actions')
    action(actions, '恢复出厂音效', function () { activateClip(libraryCue, '', true); renderSettings() })
    action(actions, '试听当前音效', function () { playPool(cuePools[libraryCue]) })
    var status = element('p', libraryStatus, content, 'dshvk1-status'); status.setAttribute('role', 'status')
    var file = element('input', null, content)
    file.type = 'file'; file.accept = '.mp3,.wav,.m4a,.wma,.aac,.flac,.ogg,audio/*'
    file.setAttribute('aria-label', '导入本地音效')
    file.disabled = !soundDb
    file.addEventListener('change', async function () {
      var selected = file.files[0], cue = libraryCue, generation = renderGeneration
      if (!selected) return
      if (selected.size > 50 * 1024 * 1024) { status.textContent = '文件过大，最大 50 MB。'; return }
      file.disabled = true; status.textContent = '正在解码音频…'
      try {
        var buffer = await decodeSound(selected)
        if (stopped || generation !== renderGeneration || !settingsOpen) return
        if (!isFinite(buffer.duration) || buffer.duration <= 0) throw new Error('音频为空')
        editClip({ id: crypto.randomUUID(), cue: cue, name: selected.name.replace(/\.[^.]+$/, '').slice(0, 80), source: selected, start: 0, end: buffer.duration, gain: 100 }, buffer)
      } catch (e) { if (!stopped && generation === renderGeneration) { status.textContent = '无法读取音频：' + e.message; file.disabled = !soundDb } }
    })
    hint('当前：' + ((clips.find(function (c) { return c.id === activeClips[libraryCue] }) || {}).name || '出厂音效'))
    clips.filter(function (c) { return c.cue === libraryCue }).forEach(function (clip) {
      var row = element('div', null, content, 'dshvk1-clip')
      element('strong', clip.name + (activeClips[libraryCue] === clip.id ? ' · 使用中' : ''), row)
      var buttons = element('div', null, row, 'dshvk1-actions')
      action(buttons, '使用', function () { activateClip(clip.cue, clip.id, true); renderSettings() })
      action(buttons, '修改', async function () {
        var generation = renderGeneration
        try { var buffer = await decodeSound(clip.source); if (!stopped && generation === renderGeneration && settingsOpen) editClip(Object.assign({}, clip), buffer) }
        catch (e) { if (!stopped) status.textContent = '无法读取音频：' + e.message }
      })
      action(buttons, '删除', async function () {
        try {
          await dbChange('delete', clip.id)
          if (stopped) return
          clips = clips.filter(function (c) { return c.id !== clip.id })
          if (activeClips[clip.cue] === clip.id) activateClip(clip.cue, '', true)
          renderSettings()
        } catch (e) { status.textContent = '删除失败：' + e.message }
      })
    })
  }
  function editClip(clip, buffer) {
    content.textContent = ''; renderGeneration++
    element('h3', '剪辑音效 · ' + CUE_NAMES[clip.cue], content)
    var nameLabel = element('label', '音效名称', content)
    var name = element('input', null, nameLabel); name.type = 'text'; name.maxLength = 80; name.value = clip.name
    var canvas = element('canvas', null, content, 'dshvk1-wave'); canvas.width = 560; canvas.height = 100
    canvas.setAttribute('aria-label', '音频波形及裁剪范围')
    function drawWave() {
      var ctx = canvas.getContext('2d'), samples = buffer.getChannelData(0)
      ctx.clearRect(0, 0, 560, 100); ctx.fillStyle = '#7a8fd1'
      for (var x = 0; x < 560; x++) {
        var first = Math.floor(x * samples.length / 560), last = Math.floor((x + 1) * samples.length / 560), peak = 0
        for (var i = first; i < last; i++) peak = Math.max(peak, Math.abs(samples[i]))
        ctx.fillRect(x, 50 - peak * 46, 1, Math.max(1, peak * 92))
      }
      ctx.fillStyle = '#355ce833'
      ctx.fillRect(560 * clip.start / buffer.duration, 0, 560 * (clip.end - clip.start) / buffer.duration, 100)
    }
    var fields = element('div', null, content, 'dshvk1-setting')
    numeric(fields, '起点（秒）', clip.start, 0, buffer.duration, 0.001, function (v) { clip.start = v; drawWave() })
    numeric(fields, '终点（秒）', clip.end, 0, buffer.duration, 0.001, function (v) { clip.end = v; drawWave() })
    numeric(element('div', null, content, 'dshvk1-setting'), '音量增益', clip.gain, 0, 200, 1, function (v) { clip.gain = v }, 'range')
    var status = element('p', '', content, 'dshvk1-status'); status.setAttribute('role', 'status')
    var buttons = element('div', null, content, 'dshvk1-actions')
    action(buttons, '试听剪辑', function () {
      try { stopPreview(); previewUrl = URL.createObjectURL(wavBlob(buffer, clip.start, clip.end, clip.gain)); previewAudio = new Audio(previewUrl); previewAudio.volume = state.soundOn ? state.volume / 100 * state.cueVolumes[clip.cue] / 100 : 0; previewAudio.play().catch(function () { status.textContent = '浏览器暂时阻止了播放，请再次点击试听。' }) }
      catch (e) { status.textContent = e.message }
    })
    var save = action(buttons, '保存并使用', async function () {
      try {
        save.disabled = true
        clip.name = name.value.trim() || '自定义音效'
        clip.rendered = wavBlob(buffer, clip.start, clip.end, clip.gain)
        await dbChange('put', clip)
        if (stopped) return
        clips = clips.filter(function (c) { return c.id !== clip.id }); clips.push(clip)
        activateClip(clip.cue, clip.id, true); stopPreview(); renderSettings()
      } catch (e) { status.textContent = '保存失败：' + e.message; save.disabled = false }
    })
    action(buttons, '取消', function () { stopPreview(); renderSettings() })
    drawWave()
  }


  try {
    // 尺寸存的是 { v:2, scale }；早期版本存的是像素字符串，按公式反推 scale 兼容一次。
    var rawSize = localStorage.getItem(SIZE_KEY)
    if (rawSize) {
      var parsed = JSON.parse(rawSize)
      if (parsed && parsed.v === 2 && isFinite(Number(parsed.scale))) {
        state.scale = Math.round(clamp(Number(parsed.scale), SCALE_MIN, SCALE_MAX) * 100) / 100
      } else {
        var legacyPx = parseInt(rawSize, 10)
        if (isFinite(legacyPx) && legacyPx > 0) {
          var vpNow = viewport()
          var baseNow = Math.min(SIZE_BASE_CAP, Math.min(vpNow.w, vpNow.h) * SIZE_BASE_RATIO) || 1
          state.scale = Math.round(clamp(legacyPx / baseNow, SCALE_MIN, SCALE_MAX) * 100) / 100
        }
      }
    }
    state.size = baseSizePx(state.scale)
    var g = JSON.parse(localStorage.getItem(GAP_KEY) || 'null')
    if (g) { state.scrollGapOn = !!g.on; state.scrollGapPx = typeof g.px === 'number' && g.px > 0 ? Math.round(g.px) : 0 }
    var s = JSON.parse(localStorage.getItem(SOUND_KEY) || 'null')
    if (s) {
      state.soundOn = s.on !== false
      state.volume = typeof s.vol === 'number' && s.vol >= 0 && s.vol <= 100 ? s.vol : 80
    }
    var options = JSON.parse(localStorage.getItem(OPTIONS_KEY) || 'null')
    if (options) {
      ;['fxBowl', 'fxPat', 'fxHurt'].forEach(function (key) { state[key] = options[key] !== false })
      if (typeof options.radarOn === 'boolean') state.radarOn = options.radarOn
      if (typeof options.soundPack === 'string' && SOUND_PACKS[options.soundPack]) state.soundPack = options.soundPack
      if (typeof options.bubbleOn === 'boolean') state.bubbleOn = options.bubbleOn
      if (typeof options.turnEndOn === 'boolean') state.turnEndOn = options.turnEndOn
      if (typeof options.bubbleGifOn === 'boolean') state.bubbleGifOn = options.bubbleGifOn
      if (typeof options.clickSoundOn === 'boolean') state.clickSoundOn = options.clickSoundOn
      if (typeof options.autoIronOnFeed === 'boolean') state.autoIronOnFeed = options.autoIronOnFeed
      if (typeof options.idleBubbleOn === 'boolean') state.idleBubbleOn = options.idleBubbleOn
      if (typeof options.rotateFlip === 'boolean') state.rotateFlip = options.rotateFlip
      if (Array.isArray(options.idleWords)) {
        state.idleWords = options.idleWords.map(function (x) { return String(x == null ? '' : x).slice(0, 80) })
          .filter(function (x) { return x.trim() !== '' }).slice(0, 40)
      }
      if (typeof options.skin === 'string' && SKINS[options.skin]) state.skin = options.skin
      if (Array.isArray(options.cueSrc)) state.cueSrc = options.cueSrc.map(function (x) { return String(x || '') })
      if (Array.isArray(options.reminders)) {
        state.reminders = options.reminders
          .map(function (x) { return String(x == null ? '' : x).slice(0, 60) })
          .filter(function (x) { return x.trim() !== '' })
          .slice(0, 20)
        if (!state.reminders.length) state.reminders = ['\u672C\u8F6E \u00A5{cost}']
      }
      if (isFinite(Number(options.stepYuan))) state.stepYuan = Math.round(clamp(Number(options.stepYuan), STEP_MIN, STEP_MAX) * 100) / 100
      if (isFinite(Number(options.dropIntervalSec))) {
        state.dropIntervalSec = clamp(Math.round(Number(options.dropIntervalSec)), DROP_INTERVAL_MIN_S, DROP_INTERVAL_MAX_S)
      }
      if (['auto', 'light', 'dark'].indexOf(options.theme) >= 0) state.theme = options.theme
      if (Array.isArray(options.cueVolumes) && options.cueVolumes.length) {
        var vols = options.cueVolumes.slice(0, CUE_NAMES.length)
        while (vols.length < CUE_NAMES.length) vols.push(100)
        state.cueVolumes = vols.map(function (n) { return isFinite(n) ? clamp(Number(n), 0, 100) : 100 })
      }
    }
  } catch (err) {}

  loadSnapConfig()
  layout()
  if (!applyAnchorPos()) { state.h = 'left'; state.v = 'bottom'; state.hOff = 0; state.vOff = 0; settle() }
  updateScreen()
  setupHitTest()
  // 应用持久化的皮肤（建 DOM 时只换了图，这里补齐底板样式与命中图）
  loadCustomSkin(function (dataUrl) {
    if (dataUrl) {
      registerCustomSkin(dataUrl)
      if (state.skin === 'custom') applySkin('custom')
      else renderSettingsIfOpen()
    }
  })
  applySkin(state.skin)
  rebuildPools(state.cueSrc || null)
  initSoundLibrary()

  rafId = requestAnimationFrame(frame)
  poll(false)
  var pollTimer = setInterval(function () { poll(false) }, POLL_MS)
  var turnTimer = setInterval(pollTurn, 2500)
  var dropTimer = 0
  function restartDropTimer() {
    try { clearInterval(dropTimer) } catch (err) {}
    dropTimer = setInterval(dropTick, state.dropIntervalSec * 1000)
  }
  restartDropTimer()

  // ------------------------------------------------- live mount/unmount hook ---
  // The appearance manager mounts this script when the bundle is enabled and asks
  // it to tear itself down (then removes the tag) when it is disabled — that is
  // what makes 切换外观 take effect without a page refresh.
  function detach(el) {
    try { if (el && el.parentNode) el.parentNode.removeChild(el) } catch (err) {}
  }
  function stop() {
    stopped = true
    try { cancelAnimationFrame(rafId) } catch (err) {}
    try { clearInterval(pollTimer) } catch (err) {}
    try { clearInterval(dropTimer) } catch (err) {}
    try { clearInterval(turnTimer) } catch (err) {}
    if (btnHideTimer) { clearTimeout(btnHideTimer); btnHideTimer = null }
    document.removeEventListener('pointerdown', onDown, true)
    document.removeEventListener('pointermove', onCursor, true)
    document.removeEventListener('contextmenu', onContextMenu, true)
    document.removeEventListener('pointerdown', onDocMenuClose, true)
    document.removeEventListener('click', onDocClick, true)
    document.removeEventListener('pointerleave', pointerLeft)
    document.removeEventListener('keydown', onEscape, true)
    window.removeEventListener('blur', pointerLeft)
    window.removeEventListener('error', onWidgetError)
    removeDragListeners()
    window.removeEventListener('resize', onResize)
    try { if (document.body) document.body.style.cursor = '' } catch (err) {}
    detach(styleEl)
    detach(stage)
    detach(root)
    detach(menu)
    detach(settingsMask)
    stopAudio()
    if (soundDb) soundDb.close()
    window.__dshVk1Widget = false
  }
  window.__dshAppearanceWidgets = window.__dshAppearanceWidgets || {}
  window.__dshAppearanceWidgets['dsh-vk1-balance-widget'] = { stop: stop }
})()
