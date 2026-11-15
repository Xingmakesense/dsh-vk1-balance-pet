# VK-1 DSH 余额桌宠（网页插件）

贴在 DSH 网页界面里的余额桌宠：角色举着一块倾斜的平板显示 DeepSeek 余额，扣费时红闪 + 震动 + 飘字，
余额涨了就掉一盆米饭，拖到她身上才入账。

本项目是 [VKmich16/VK-1](https://github.com/VKmich16/VK-1) 桌宠的 **DSH bundle 实现**，
以 [YCTS-otree/VK-1](https://github.com/YCTS-otree/VK-1) 的 `dsh-plugin` 为基线改造而来，
吸附与余额渠道照搬 [dsh-whale-widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) 的做法。

## 与上游两个实现的区别

| 项 | 上游窗口桌宠 / 社区插件 | 本实现 |
| --- | --- | --- |
| 余额渠道 | 自己的 API Key 设置流程 | **官方账号凭据优先**（`deepseekAccount`），没有账号服务时才回退 DSH 已配置的 `DEEPSEEK_API_KEY`；**不提供任何 API Key 输入界面** |
| 掉饭盆 | 充值立刻掉盆 / 按余额变化掉盆 | **每 60 秒随机掉一盆**，位置在角色**左上方 2 倍身高**处；场上已有未喂的盆时跳过本轮 |
| 扣费提示 | 每 0.01 元一次 | **每 0.5 元提示一次** |
| 落盆动画 | 有 Q 弹挤压 | **取消 Q 弹**，落地不再 squash/stretch |
| 演示模式 | 会改动平板数字 | **只播动画**（红闪 / 震动 / 飘字 / 音效），数字不变，也不计入消费 |
| 吸附 | 固定四分之一视口 | **可配置吸附区宽度 + 翻转线**（按比例 / 按像素 / 关闭），与鲸鱼挂件同一模型 |
| 尺寸预设 | 128–512px | **小杯 340 / 中杯 454 / 大杯 624**（当前大小定为中杯，其余按 340:454:624 同一比例） |
| 更新检查 | 每日访问 GitHub 取版本号 | **已移除**：除余额接口外不出网 |

## 安装

作为本地 bundle 安装到某个 DSH profile（示例用 `desktop`）：

```sh
# 1) 把本仓库放到任意目录，例如 <repo>
# 2) 登记依赖（link: 指向仓库根）并加入 bundles
#    在 profile 的 package.json 里：
#    dependencies: { "dsh-vk1-balance-pet": "link:<repo 绝对路径>" }
#    dsh.profile.bundles: [ ..., "dsh-vk1-balance-pet" ]
# 3) 在 profile 的 node_modules 下建目录联接指向仓库根
# 4) 重启 DSH，插件即加载（页面刷新后挂件出现）
```

页面注入走两条通道：Web 形态用 `tapIndex`，桌面端（Electron）用 `webserver/index-inject`
的结构化**内联 script 行**（`script-src` 行加载失败会 reject 掉应用启动，故不使用）。

## 使用

| 操作 | 效果 |
| --- | --- |
| 左键拖动角色 | 移动；松手按吸附区贴到最近的边 |
| 右键角色（或点右上角 ⋯） | 立即刷新余额 / 演示 / 设置与吸附 / 峰谷时钟 |
| 拖动米饭盆到她身上 | 入账（碰到头发也算） |
| 双击平板 | 显示峰谷时钟，离开角色 5 秒恢复余额 |
| 双击她的头（顶着铁盆时） | 取下最上面那个铁盆 |
| 在角色上悬停划动 | 摸头动画 |

设置面板（`设置与吸附`）里有：功能开关、明暗主题、三档尺寸与自定义像素、
**吸附与翻转**（左/上/右/下吸附区 + 翻转线，ratio / px / off 三档）、今日消费校准、声音与四路音效音量。

## 余额渠道

宿主侧 `index.js` 的顺序是：

1. `ctx.get('deepseekAccount')` → `getBalance()`：把 `normal_wallets`（充值）与
   `bonus_wallets`（赠金）按币种合计成 `totalBalance`，**只有赠金也算成功**；
2. 账号路不可用（未登录 / 未就绪 / 接口失败）时，回退 `ctx.credentials.resolve('DEEPSEEK_API_KEY')`
   请求官方 `GET https://api.deepseek.com/user/balance`；
3. 两条都失败 → 返回 `{ ok: false, code, error }`，挂件显示 `--`。

结果缓存 8 秒，瞬时失败沿用上一次读数并标 `stale`。响应恒为 HTTP 200，错误放在 body 里。

## 安全

- 除 `api.deepseek.com` 外**不访问任何域**；已移除上游的更新检查与节假日第三方源。
- 不读写 API Key 输入界面，密钥始终由 DSH 自己管理；`.dsh/.credentials.yaml` 只由宿主读取。
- 路由不带 `Access-Control-Allow-Origin: *`；素材与脚本均同源提供，`Cache-Control: no-store`。
- 页面脚本无 `eval` / `new Function` / `innerHTML` 拼接外部输入；自定义音效存浏览器 IndexedDB，不上传。

## 开发与测试

```sh
node tools/verify.mjs     # 宿主：路由、注入行去重、素材、余额失败路径、无 CORS 通配
node tools/behavior.mjs   # 客户端：0.5 元步进、演示不改数值、60s 掉盆、落点、无 Q 弹、吸附、尺寸档
```

两个脚本都在隔离环境里跑（DOM 桩 / 桩凭据），**不触网、不读真实凭据**。

## 素材与许可

- 代码：MIT，见 [LICENSE](LICENSE)。
- 角色差分、米饭盆、铁盆、音效来自 [VKmich16/VK-1](https://github.com/VKmich16/VK-1)（MIT）；
  来源、原始尺寸与校验值登记在 [asset-sources.json](asset-sources.json)。
- 为控制体积，本仓库把四张 1024×1024 表情与 2880×2880 铁盆**下采样到 768×768**
  （最大显示尺寸 624px），其余素材保持上游原始字节；逐项记录在 `asset-sources.json` 的 `processing` 字段。
- DSH 宿主接口（`webServer` / `credentials` / `deepseekAccount` / `webserver/index-inject`）的用法参考
  dsh-whale-widget（MIT）。
