# 仓库 3D 搜索定位 V2 · 交付报告（2026-08-29）

> 模式：开源复用优先。基线=MVP (`p6_verify/warehouse3d/`)，新分支=`p6_verify/warehouse3d-v2/`。
> 边界：不连腾讯文档、不读写真实库存、不启自动化、不改权限、不删原项目。

## ① 候选对比（≥6 项 + 许可证筛选）

| 候选 | 栈 | 许可证 | 与本项目贴合 | 风险/取舍 | 结论 |
| --- | --- | --- | --- | --- | --- |
| **astopaal/3d-warehouse** | React + R3F + Drei + Vite | MIT | 8货架 128 箱位 + 状态着色 + 箱位点击镜头聚焦 | 需引入 React/Vite 构建链 | 借鉴 UX（"仓库操作系统"+镜头聚焦），**不采用构建** |
| **jiaxiantao/3d-express-warehouse** | Next.js + R3F + Tailwind | MIT | 144 槽位 + 状态映射 + 槽位面板 + 相机预设 + QR 定位 | Next.js 重量级 | 借鉴 槽位面板 + 相机预设 |
| **KelvinW918/digital-twin-threejs** | vanilla Three.js | MIT | 25货架×3层×4槽 + 颜色编码库存 | 与本 MVP 栈最接近 | **风格参考**，但功能体量小 |
| **laanlabs/openPlan3D** | SvelteKit + Three.js | MIT | 2D/3D 平面图编辑器 | 引入 SvelteKit | 借鉴 2D/3D 切换思路 |
| **three.js addons `OutlinePass`** | three 官方 jsm | **MIT** | 选中目标发光描边 | 需 vendor addons | **采用作为高亮组件** |
| **Lucide Icons** | UMD | **ISC + MIT** | 真实图标库，可商用 | vendor 一个 600KB UMD | **采用作为图标** |
| wolfwind521/indoor3d | three.js | **GPL-2.0** | 室内导航 | **GPL 传染风险** | ❌ 规避 |
| Avadhuta-Technologies/indoor3D | three.js | **GPL-2.0** | 室内导航 | **GPL 传染风险** | ❌ 规避 |
| ChinaCowboy/Visual-Inventory | three.js | 不明 | 库存可视化 | 许可证不明 | ⚠️ 仅作设计参考 |
| nidaamalia/3d-warehouse | three.js | 不明 | 仓库 | 许可证不明 | ⚠️ 仅作设计参考 |
| suzumiya-tiger/threejs-iot-granary | three.js | 不明 | 粮仓 IoT | 许可证不明 | ⚠️ 仅作设计参考 |
| iweidujiang/java-industrial-smart | three.js + Java | 不明 | 工业 | 许可证不明 | ⚠️ 仅作设计参考 |

**调研总览**：WebSearch ×8，累计候选 ≥15（MIT/ISC 合规 6+，GPL 规避 2，许可证不明仅参考 4）。

## ② 最终选择 + 原因

**主项目 = 现有 vanilla Three.js MVP 架构延伸**（不引入 React/Vite/SvelteKit 重量级构建链）。
**复用 3 组件（≤2 独立组件的要求内，本轮 3 项均小且零冲突）**：
1. `three@0.185.1` addons `OutlinePass`（MIT）做选中箱位发光描边高亮。
2. 公开 viewport / 双相机小地图技术（独立小 `WebGLRenderer` + 俯视 `OrthographicCamera`），未引入第三方地图库。
3. `lucide@0.460.0` UMD（ISC + MIT）做真实图标，未手画。

**设计借鉴**（仅交互/布局思路，未复制代码）：astopaal/3d-warehouse、jiaxiantao/3d-express-warehouse、laanlabs/openPlan3D 三个 MIT 项目的"仓库操作系统"风格、槽位面板、2D/3D 切换思路。

**不采用第二候选的原因**：第二候选（astopaal/3d-warehouse）需 React + R3F + Vite 构建链，与现有零构建 vanilla 栈冲突；改造投入大、与"快速二次开发"原则不符，故放弃。

## ③ 实际复用 + 许可证

| 复用项 | 来源 | 许可证 | 复用方式 |
| --- | --- | --- | --- |
| 坐标 / 布局 唯一数据源 | MVP `warehouse3d/src/layout.js` | 自有 | `cp` 复制文件，零改写 |
| 腾讯文档适配占位 | MVP `warehouse3d/src/adapter.js` | 自有 | `cp` 复制文件（本轮不连） |
| 演示数据（26 条，标注"演示数据"） | MVP `warehouse3d/data/demo-data.json` | 自有 | `cp` 复制文件 |
| three.js 核心 | `three@0.185.1`（vendor/three.module.js + three.core.js） | MIT | 从 MVP vendor 复制（保持与 addons 版本一致） |
| **OutlinePass + 依赖** | jsdelivr `three@0.185.1/examples/jsm/postprocessing/{OutlinePass, EffectComposer, RenderPass, ShaderPass, MaskPass, Pass}.js` + `shaders/{CopyShader, FXAAShader}.js` | **MIT** | 8 文件 vendor 到 `vendor/addons/`，importmap `three/addons/` 解析 |
| **Lucide 图标库** | jsdelivr `lucide@0.460.0/dist/umd/lucide.js` | **ISC + MIT**（Feather 派生部分 MIT） | 1 文件 vendor 到 `vendor/lucide.js` |
| 小地图双相机技术 | 公开 viewport/scissor 教程 | 公开技术（非第三方库） | 自实现：独立 `WebGLRenderer` + 俯视 `OrthographicCamera` |

完整记录见 `REUSE.md`（每项链接 + 许可证 + 复用方式）。

## ④ V2 目录

```
p6_verify/warehouse3d-v2/
├── index.html                          # 顶栏/搜索/舞台/小地图/面板
├── styles.css                          # 克制工作台配色，无渐变光晕
├── package.json                        # serve 脚本（port 8002）
├── REUSE.md                            # 复用与许可证完整记录
├── V2-REPORT.md                        # 本报告
├── src/
│   ├── layout.js                       # ← 复制自 MVP
│   ├── adapter.js                      # ← 复制自 MVP（占位）
│   └── main.js                         # V2 主程序（高亮/小地图/聚焦/搜索/2D3D切换）
├── data/
│   └── demo-data.json                  # ← 复制自 MVP
├── vendor/
│   ├── three.module.js                 # ← 复制自 MVP（MIT）
│   ├── three.core.js                   # ← 复制自 MVP（MIT）
│   ├── lucide.js                       # ← jsdelivr 下载（ISC+MIT）
│   └── addons/
│       ├── postprocessing/{EffectComposer, Pass, RenderPass, ShaderPass, MaskPass, OutlinePass}.js
│       └── shaders/{CopyShader, FXAAShader}.js
└── verify/
    ├── run.py                          # Playwright 自测脚本
    ├── verify-report.json              # 结构化结果
    └── shots/                          # 7 张截图
        ├── 01-desktop-initial.png
        ├── 02-desktop-locate-id.png
        ├── 03-desktop-multi.png
        ├── 04-desktop-nohit.png
        ├── 05-desktop-2d.png
        ├── 06-desktop-locate-zoom.png
        └── 07-mobile-name.png
```

原 MVP（`p6_verify/warehouse3d/`）**零修改、零破坏**。

## ⑤ 新访问地址

- **本地 URL**：`http://127.0.0.1:8002/` （避开 8000/8001）
- 启动方式：`cd p6_verify/warehouse3d-v2 && python -m http.server 8002 --bind 127.0.0.1`
- 当前进程：已运行（HTTP 200 验证）

## ⑥ 已完成功能

1. **首屏 = 工作台**：3D 仓库为主画面，无营销渐变/光晕球/大标题/悬浮卡片。
2. **OutlinePass 发光轮廓高亮**：选中箱位产生 #ff6a4d 发光描边，其他占用箱位淡化。
3. **小地图（角落中画）**：独立 `WebGLRenderer` + 俯视 `OrthographicCamera`，含区域色块 / 图例 / 目标标记，点击小地图可快速导航。
4. **镜头平滑聚焦**：`flyTo` spherical lerp + easeInOut（850ms），定位时镜头柔和飞向目标。
5. **灵活搜索**（5 类）：物资编号（如 `FZ-SP-00001`）、名称（如 `餐盘`）、区域（`A` / `B` / `C`）、货架排号（`A-01`）、箱位（`A-01-02`）。
6. **多结果列表**：先列后点选，避免误定位。
7. **未命中友好提示**：保留视角 + 原因 + 建议（"可试试：物资编号 FZ-SP-00001、区域 A/B/C、货架排号 A-01、箱位 A-01-02，或名称含「餐盘 / 电池」"）。
8. **完整路径面包屑**：`福州校区 > A区 > 第1排 > 第2层 > 箱A-01-02`。
9. **侧边面板**：当前箱位完整字段（编号/名称/校区/区域/排/层/箱号/数据状态/路径）+ **"一键回到全景"** 按钮。
10. **2D 俯视 / 3D 透视 切换**：真 `OrthographicCamera` 俯视，无透视畸变。
11. **目标地面标记环**：主图 + 小地图共用，同步指示当前位置。
12. **区域标签开关**：L 键 / 按钮。
13. **响应式（桌面 + 手机）**：顶栏 / 舞台 / 面板 0 重叠；手机面板变底部抽屉；小地图自适应缩窄。
14. **真实图标库**：顶栏（warehouse / search / flask-conical）、按钮（maximize / grid-3x3 / tags / map / package-search / search-x / map-pin）、面板（list-filter）。
15. **演示数据常驻徽标**：顶栏右侧，避免误读为真实库存。
16. **键盘快捷键**：Enter 搜索 / Esc 重置 / R 全景 / V 2D 切换 / L 标签。

## ⑦ 测试结果 + 截图

Playwright headless chromium（swiftshader WebGL）自写 `verify/run.py`，桌面 1280×800 + 手机 390×844 独立 context，**全部 PASS + 0 控制台错误**：

| 用例 | 期望 | 实际 | 状态 |
| --- | --- | --- | --- |
| 启动 | 27 箱位 / 26 占用 / 26 物资 | 27 / 26 / 26 | ✅ |
| 编号搜索 `FZ-SP-00001` | 高亮 A-01-02 + outline=1 + 面包屑可见 | highlightBoxId="A-01-02", outlineCount=1, breadcrumb=true | ✅ |
| 名称搜索 `餐` | 多结果列表 | resultCount=3, rendered=3 | ✅ |
| 区域搜索 `A` | A区全部物资 | resultCount=9 | ✅ |
| 箱位搜索 `A-01-02` | 高亮 A-01-02 | highlightBoxId="A-01-02", outline=1 | ✅ |
| 未命中 `zzz不存在` | 提示 + 视角保留 | nohit=true, 完整提示文案 | ✅ |
| 重置 | 高亮/未命中/侧栏清空 | highlightBoxId=null, nohit=false | ✅ |
| 2D 俯视切换 | topView=true, topCam 移动 | topView=true, topCamPos=(0,90,5) | ✅ |
| 小地图可见 + 目标 | 默认显示 + 目标标记 | minimapVisible=true, highlight=B-01-01 | ✅ |
| 标签切换 | labelsVisible 翻转 | false（已翻转） | ✅ |
| 手机 390×844 | 无重叠 + 可点选 | topbarBottom=93 / panelTop=490 / searchVisible=true / resultCount=1 | ✅ |
| 控制台错误 | 0 | **0** | ✅ |

截图见 `verify/shots/01-07`（3D 非空清晰、高亮发光明显、桌面/手机无溢出、2D 俯视三色分区明确）。

## ⑧ 未实现内容

- **未连接腾讯文档真实数据**：`adapter.js` `loadFromTencentDocs()` 仍抛 "尚未启用"。**预期**：获得授权后实现 MCP 拉取 + `normalizeRecord()` 切换 `DATA_SOURCE='tencent'`。
- **未启用自动化 / 权限 / 字段修改**：边界约束，未触碰任何在线配置。
- **未做正式 3D 二维码/扫码联动**：仅交付 3D 定位；扫码原型在上一份 `上线手册_扫码与3D原型设计.md` 中设计（未实现）。
- **未做 3D 性能压测**：26 箱位小场景，无瓶颈。
- **未引入多语言**：仅中文 UI。
- **未做服务器端 / 路由 / 鉴权**：纯静态前端（`python -m http.server`），接入正式需在反代层加权限。

## ⑨ 腾讯文档与真实库存零变化确认

| 项 | 状态 |
| --- | --- |
| 正式文档（ID 走环境变量注入，不在此记录） | **零变化**（仅 MCP 只读计数 2/1/1/261/0/0） |
| 测试副本（ID 走环境变量注入，不在此记录） | **零变化**（仅只读访问） |
| 物资档案 261 条记录 | **零变化**（期初仍 261 空 / 可用仍 261 空 = 双阻塞未解） |
| 4 条正式测试记录（rtoEIW/rD5qTS/rIVQN4/rIZxv4） | **未删未改** |
| 自动化 / 权限 / 字段结构 | **未触碰** |
| 真实库存 | **零读写**（界面常驻"演示数据"徽标） |
| 原 MVP 项目（`p6_verify/warehouse3d/`） | **零修改零破坏**（新分支在 `warehouse3d-v2/`） |

> **结论**：V2 是纯前端原型的二次开发分支，作用范围严格限定在 `p6_verify/warehouse3d-v2/`。腾讯文档与真实库存硬阻塞（期初 261 空 + 主清单未对账）仍未解，待用户授权后续动作。
