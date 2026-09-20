# 仓库 3D 搜索定位 V2 —— 开源复用记录

> 分支目标：在 MVP（vanilla Three.js）基础上，制作更美观、清晰、符合仓库管理员习惯的 V2。
> 原则：禁止无必要从零开发，优先复用成熟 MIT/ISC 方案再做二次开发。

## 一、直接复用（保留许可证与来源）

| 复用项 | 来源 | 许可证 | 用途 | 复用方式 |
| --- | --- | --- | --- | --- |
| 仓库坐标与布局 | 本项目 MVP `warehouse3d/src/layout.js` | 自有 | 箱位/区域/世界坐标唯一数据源 | 直接复制文件，未改写坐标逻辑 |
| 腾讯文档适配占位 | 本项目 MVP `warehouse3d/src/adapter.js` | 自有 | `loadFromTencentDocs()` 预留接口，本轮不连 | 直接复制文件 |
| 演示数据 | 本项目 MVP `warehouse3d/data/demo-data.json`（26 条，标注“演示数据”） | 自有 | 渲染与搜索数据源 | 直接复制文件 |
| three.js 核心 | `three@0.185.1`（vendor/three.module.js + three.core.js） | MIT | 3D 渲染引擎 | 复制自 MVP vendor |
| **OutlinePass 后处理** | `three@0.185.1/examples/jsm/postprocessing/OutlinePass.js` 及依赖（EffectComposer / RenderPass / ShaderPass / MaskPass / Pass / CopyShader / FXAAShader） | **MIT** | 选中箱位发光描边高亮 | 通过 jsdelivr 下载对应版本 addons 至 `vendor/addons/`，importmap `three/addons/` 解析 |
| **Lucide 图标库** | `lucide@0.460.0/dist/umd/lucide.js` | **ISC + MIT（Feather 派生部分 MIT）** | 顶栏/按钮/面板真实图标，未手绘 | 下载至 `vendor/lucide.js`，`lucide.createIcons()` 渲染 |

## 二、小地图（导航组件）

- 采用公开 viewport / 双相机技术：单个 `WebGLRenderer` + 俯视 `OrthographicCamera` 渲染独立中画。
- 未引入任何第三方地图库；仅复用 three.js 自带相机与渲染器能力（MIT）。
- 支持点击小地图快速导航到对应区域（坐标映射 + `flyTo`）。

## 三、设计借鉴（MIT 项目，仅参考交互/布局思路，未复制代码）

| 项目 | 许可证 | 借鉴点 |
| --- | --- | --- |
| astopaal/3d-warehouse | MIT | “仓库操作系统”式 UX：沉稳配色、状态着色、箱位点击镜头聚焦 |
| jiaxiantao/3d-express-warehouse | MIT | 结果槽位面板 + 相机预设 + 二维码定位思路 |
| laanlabs/openPlan3D | MIT | 2D/3D 平面图切换思路 |

## 四、已规避的许可证风险

- wolfwind521/indoor3d、Avadhuta-Technologies/indoor3D：GPL-2.0，**未采用其代码**。
- ChinaCowboy/Visual-Inventory、nidaamalia/3d-warehouse、suzumiya-tiger/threejs-iot-granary、iweidujiang/java-industrial-smart：许可证不明，**仅作设计参考，未复制代码**。

## 五、运行

```bash
cd warehouse3d-v2
npm run serve      # 或 python3 -m http.server 8002 --bind 127.0.0.1
# 浏览器打开 http://127.0.0.1:8002
```

## 六、边界（与正式系统隔离）

- 不连接腾讯文档、不读写真实库存、不启用自动化、不改权限、不改正式/测试副本。
- 当前数据为本地演示数据，界面已常驻“演示数据”徽标。
