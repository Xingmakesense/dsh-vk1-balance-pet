# VK-1 DSH 余额桌宠（网页插件）

贴在 DSH 网页界面里的余额桌宠：角色举着一块倾斜的平板显示 DeepSeek 余额，扣费时红闪 + 震动 + 飘字，
掉饭盆时拖到她身上才入账。

本项目是 [VKmich16/VK-1](https://github.com/VKmich16/VK-1) 桌宠的 **DSH bundle 实现**，
以 [YCTS-otree/VK-1](https://github.com/YCTS-otree/VK-1) 的 `dsh-plugin` 为基线改造而来，
**尺寸、位置与菜单形态照搬 [dsh-whale-widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)**。

## v2.1.0 的变化（相对 v2.0.0）

| 项 | v2.1.0 |
| --- | --- |
| 声音页崩溃 | 修复 `Uncaught ReferenceError: CUE_NAMES is not defined`（v2.0.0 重构时误删声明） |
| 右键菜单 | 修复：点菜单外**一次**即关闭（当时漏注册 `pointerdown` 监听） |
| 平板数字 | 修复居中：满高 flex 居中，实测水平偏差 0px、垂直 2px |
| 点击穿透 | 角色/道具上的 click 必被吞，空白处正常送达（已实测） |
| 音效包 | 新增可切换音效包：控制台原生 / 小黄鸭 / 经验球（素材来自 dsh-whale-widget，MIT） |
| 扣费步长 | 可自定义 0.01–100 元（默认 0.5） |
| 峰谷显示 | **已移除**：平板只显示余额，不再有梁文峰/梁文谷与倒计时 |

## v2.0.0 的变化（相对 v1.0.0）

| 项 | v2.0.0 |
| --- | --- |
| 尺寸 | 放弃固定像素档，改为**连续缩放**（1–20 级 → 0.6–2.5 倍），基准 `clamp(122px, min(250px, min(100vw,100vh)×0.28) × scale, 625px)`，默认 1 倍约 250px，不再是 454px；窗口尺寸变化自动重算 |
| 位置/吸附 | 四边吸附区 + 翻转线（ratio / px / off），与鲸鱼挂件同一模型 |
| 一级菜单 | 高密度单列：余额 + 刷新、大小滑杆 + 数字、**火控雷达开关**、**掉盆间隔（5–3600 秒，可自定义）**、吸附与翻转、声音与音效、音效库、演示、关于 |
| 二级界面 | 完全重构：每页独立卡片，标题栏左侧「‹ 返回」回到一级、右侧 × 关闭；不再用 tab |
| 点击穿透 | 修复：拖拽/点击角色与道具时不再触发其身后的页面按钮 |
| 火控雷达 | 独立开关，关闭时铭牌、10 秒锁定与磁吸一起停用，盆留在原地等你拖 |

## 安装（手动）

1. `git clone https://github.com/Xingmakesense/dsh-vk1-balance-pet.git <repo>`
2. 在目标 profile 的 `package.json` 里登记依赖与 bundle：

```json
{
  "dependencies": { "dsh-vk1-balance-pet": "link:<repo 绝对路径>" },
  "dsh": { "profile": { "bundles": [ "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-vk1-balance-pet" ] } }
}
```

3. 在 `<profile>/node_modules/` 下建一个指向仓库根的目录联接：

```powershell
# Windows
New-Item -ItemType Junction -Path "<profile>\node_modules\dsh-vk1-balance-pet" -Target "<repo>"
# macOS / Linux
ln -s <repo> <profile>/node_modules/dsh-vk1-balance-pet
```

4. 重启 DSH，刷新页面。挂件默认贴在**左下角**。

> 宿主入口是 `index-v2.js`（带版本号的入口 = 全新的模块 URL，改宿主代码后停/启 bundle 即可生效，
> 不必重启 DSH）。改宿主代码时请递增为 `index-v3.js`，并同步 `package.json` 的 `exports["."] / files`
> 与 `cordis.patch.yml`。

## 使用

| 操作 | 效果 |
| --- | --- |
| 左键拖动角色 | 移动；松手按吸附区贴到最近的边 |
| 右键角色（或点右下 ⋯） | 打开一级菜单 |
| 拖动米饭盆到她身上 | 入账（碰到头发也算） |
| 双击她的头（顶着铁盆时） | 取下最上面那个铁盆 |
| 在角色上悬停划动 | 摸头动画 |

菜单里可调：余额刷新、大小、火控雷达开关、掉盆间隔（秒）、吸附与翻转、声音与音效、
音效库（导入 / 截取自定义音频）、演示（只播动画）、关于（版本 / 今日消费校准 / 峰谷时钟）。

## 行为约定

- **掉盆**：每 `掉盆间隔`（默认 60 秒）随机掉一盆，位置在角色**左上方 2 倍身高**处；场上已有未喂的盆时跳过本轮。
- **入账**：充值只累积待入账金额，喂下去的那一刻才记进平板；关闭掉盆功能则充值直接入账。
- **扣费**：每消耗 **0.5 元**提示一次（红闪 / 震动 / 飘字 / 音效）。
- **演示**：只播动画，**不改平板数字**，也不计入今日消费。
- **峰谷显示**：已移除（平板只显示余额）。
- **Q 弹**：已取消，落地不再挤压变形。

## 余额渠道

宿主侧 `index-v2.js` 的顺序是：

1. `ctx.get('deepseekAccount')` → `getBalance()`：把充值钱包与赠金按币种合计成 `totalBalance`（**只有赠金也算成功**）；
2. 账号路不可用时回退 `ctx.credentials.resolve('DEEPSEEK_API_KEY')` 请求官方 `GET https://api.deepseek.com/user/balance`；
3. 两条都失败 → 返回 `{ ok: false, code, error }`，平板显示 `--`。

结果缓存 8 秒，瞬时失败沿用上一次读数并标 `stale`。响应恒为 HTTP 200，错误放在 body 里。
**不提供任何 API Key 输入界面**：密钥始终由 DSH 自己管理。

## 安全

- 除 `api.deepseek.com` 外**不访问任何域**（无更新检查、无第三方节假日源）。
- 路由不带 `Access-Control-Allow-Origin: *`；素材与脚本同源提供，`Cache-Control: no-store`。
- 页面脚本无 `eval` / `new Function` / 拼接外部输入的 `innerHTML`；自定义音效存浏览器 IndexedDB，不上传。
- 素材为原始字节或等比下采样（见 `asset-sources.json` 的 `processing` 字段），单文件均 < 5 MB。

## 开发与测试

```sh
node tools/verify.mjs     # 宿主：路由、注入行去重、素材校验、余额失败路径、无 CORS 通配
node tools/behavior.mjs   # 客户端：扣费步长、演示纯动画、周期掉盆、落点、无 Q 弹、吸附、缩放、雷达开关、点击穿透、音效包
node tools/preview.mjs    # 本地预览：http://127.0.0.1:4319/ （同源加载，mock 余额，可量布局/试交互）
```

`tools/preview.mjs` 把仓库以 `/dsh-vk1/*` 暴露给浏览器：页面与脚本同源，命中画布不会被跨域污染，
因此可以在真实浏览器里量取平板数字位置、验证菜单与点击行为。它**只用于开发**，不接触任何真实凭据。

两个脚本都在隔离环境里跑（DOM 桩 / 桩凭据），**不触网、不读真实凭据**。

## 素材与许可

- 代码：MIT，见 [LICENSE](LICENSE)。
- 角色差分、米饭盆、铁盆、音效来自 [VKmich16/VK-1](https://github.com/VKmich16/VK-1)（MIT），
  来源与校验值见 [asset-sources.json](asset-sources.json)；四张表情与铁盆已等比下采样到 768×768 以控制体积。
- DSH 宿主接口与交互形态参考 dsh-whale-widget（MIT），第三方声明见 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。
