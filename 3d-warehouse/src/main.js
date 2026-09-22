// 智能仓库 3D 搜索定位 V2 —— 本地原型（演示数据，未连接腾讯文档）
//
// ============================ 模块结构（高内聚低耦合） ============================
//   config.js    全局配置常量（颜色 / 尺寸 / 视角默认值）—— 无依赖，最底层
//   state.js     共享运行时状态（会被改动的数据都集中在这）—— 无依赖
//   layout.js    坐标唯一数据源（区域 / 排 / 层 → 世界坐标）
//   adapter.js   腾讯文档适配层（占位，未启用）
//   scene.js     渲染基建 + 场景构建（渲染器 / 相机 / 灯光 / 箱位 / 标签）
//   camera.js    相机运动（view 数值 → 相机位置；flyTo 平滑过渡）
//   emphasis.js  高亮与定位（强调哪个箱位 + 镜头聚焦 + 复位）
//   search.js    搜索匹配规则（输入 → 命中记录）
//   panel.js     界面 DOM 的唯一出入口（结果列表 / 面包屑 / 详情卡 / 提示）
//   controls.js  视角输入（鼠标拖拽 + 触摸手势）
//   joystick.js  左下虚拟摇杆（触摸设备上一根手指"走过去"，不影响单指旋转）
//   minimap.js   小地图（独立模块，当前界面已停用）
//   api.js       对外测试接口（window.__diag / window.__api）
//   main.js      组装层：把上面这些接起来 + 绑定界面事件 + 启动  ← 本文件
// ==============================================================================
//
// 备份位置：../3d-warehouse.backup（重构前完整快照，验收通过后可删）

import { DATA_SOURCE } from './config.js';
import { state } from './state.js';
import { loadFromApi, loadFromTencentDocs } from './adapter.js';
import { buildWarehouse, renderer, resize, composer, canvasHost } from './scene.js';
import { updateCamera, stepAnimation, flyToOverview } from './camera.js';
import { locate, resetView, setResetHook } from './emphasis.js';
import { search } from './search.js';
import { renderResults, setLoading, setLoadError, setResultCount } from './panel.js';
import { initControls } from './controls.js';
import { initJoystick } from './joystick.js';
import { initMinimap, sizeMinimap, renderMinimap } from './minimap.js';
import { toggleMap, enterMap, exitMap, isMapMode, pickOnMap, setMapUiHook, setPickBoxHook } from './mapview.js';
import { setMapUi, toggleSelInfo, initPanelDrawer } from './panel.js';
import { exposeApi, exposeError } from './api.js';

/** 判定"轻点"的最大位移（像素）。超过这个距离视为拖拽，不触发地图点选。 */
const TAP_SLOP = 8;

/**
 * initControls 的返回值（里面带着 stopInertia）。
 * 为什么放在模块作用域而不是 init() 里：setMapUi 的回调需要在切地图时
 * 掐掉旋转惯性，但那个回调注册在 initControls 之前，拿不到局部变量。
 */
let hooks = { stopInertia: () => {} };

/** 摇杆的测试出口（initJoystick 的返回值），api.js 要用 */
let joystick = { getVec: () => ({ x: 0, y: 0 }), setVec: () => {}, reset: () => {} };

// ---------------------------------------------------------------------------
// 界面事件绑定
// ---------------------------------------------------------------------------
/** 切换全屏地图（界面同步由 mapview 的回调统一处理） */
function doToggleMap() {
  toggleMap();
}

/**
 * 定位。
 *
 * 这里刻意**不再**包一层抽屉逻辑 —— 抽屉的"定位后升到半开"已经收口在
 * emphasis.js 的 locate() 里（那是所有定位路径的唯一入口）。
 * 早先版本在这里包了个 locateAndReveal，只覆盖"点结果卡"这一条路，
 * 搜索自动定位（search.js 直接调 locate）就漏了，表现为结果卡藏着不露。
 * 统一到 locate 内部之后，这里保持最朴素的转发即可。
 */

function bindUi() {
  document.getElementById('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    search(document.getElementById('search').value);
  });

  document.getElementById('btn-clear').addEventListener('click', resetView);
  document.getElementById('btn-reset').addEventListener('click', (e) => {
    e.preventDefault();
    resetView();
  });
  document.getElementById('btn-overview')?.addEventListener('click', resetView);

  // ---- 地图：点面包屑 / 点"地图"按钮，都能进出全屏地图 ----
  const bc = document.getElementById('breadcrumb');
  if (bc) {
    bc.addEventListener('click', (e) => { e.stopPropagation(); doToggleMap(); });
    bc.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doToggleMap(); }
    });
  }
  document.getElementById('btn-map')?.addEventListener('click', (e) => {
    e.preventDefault();
    doToggleMap();
  });

  // ---- 地图上点一下：镜头飞到那个位置，并回到 3D ----
  // 注意：拖拽平移也会在抬手时触发 click，所以要先记录按下位置，
  //       只有位移小于阈值的"轻点"才算点选，避免转地图时误跳。
  const host = document.getElementById('canvas-host');
  if (host) {
    let downAt = null;
    host.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
    host.addEventListener('click', (e) => {
      if (!isMapMode()) return;
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      if (moved > TAP_SLOP) return;   // 是拖拽，不是点选
      pickOnMap(e.clientX, e.clientY, host);
    });
  }

  // ---- 详情卡：点标题行展开 / 收起 ----
  document.getElementById('selinfo-head')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSelInfo();
  });

  document.getElementById('search').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') resetView();
  });

  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.id === 'search') return;
    if (e.key === 'r' || e.key === 'R') resetView();
    if (e.key === 'm' || e.key === 'M') doToggleMap();
    if (e.key === 'Escape' && isMapMode()) doToggleMap();
    // 以下两个按钮在精简版界面中已移除，?.click() 保证不存在时静默跳过
    if (e.key === 'v' || e.key === 'V') document.getElementById('btn-view')?.click();
    if (e.key === 'l' || e.key === 'L') document.getElementById('btn-labels')?.click();
  });

  // ---------- 精简版保留的开关（元素不存在则自动跳过，无需改代码） ----------
  const btnLabels = document.getElementById('btn-labels');
  if (btnLabels) {
    btnLabels.addEventListener('click', () => {
      state.labelsVisible = !state.labelsVisible;
      if (state.labelGroup) state.labelGroup.visible = state.labelsVisible;
    });
  }

  const btnView = document.getElementById('btn-view');
  if (btnView) {
    btnView.addEventListener('click', () => {
      state.topView = !state.topView;
      const span = btnView.querySelector('span');
      if (span) span.textContent = state.topView ? '3D 透视' : '2D 俯视';
    });
  }

  const btnMinimap = document.getElementById('btn-minimap');
  if (btnMinimap) {
    btnMinimap.addEventListener('click', () => {
      document.getElementById('minimap')?.classList.toggle('hidden');
    });
  }

  window.addEventListener('resize', () => {
    resize();
    sizeMinimap();
  });
}

// ---------------------------------------------------------------------------
// 渲染循环
// ---------------------------------------------------------------------------
let lastT = performance.now();

function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  stepAnimation(dt);
  updateCamera();
  renderMinimap();
  composer.render();
  requestAnimationFrame(frame);
}

/** 启动渲染循环 */
function startRenderLoop() {
  lastT = performance.now();
  frame();
}

// ---------------------------------------------------------------------------
// 数据加载
// ---------------------------------------------------------------------------
async function loadData() {
  if (DATA_SOURCE === 'api') {
    // 方案 X：经后端取数。后端不通时退回演示数据，保证页面始终可用。
    try {
      return await loadFromApi();
    } catch (err) {
      console.warn('[data] 后端不可用，退回本地演示数据：', err.message);
      return await loadDemo();
    }
  }
  if (DATA_SOURCE === 'tencent') {
    // 已否决的路径，调用即抛错（保留以说明为什么不这么做）
    return await loadFromTencentDocs();
  }
  return await loadDemo();
}

/** 直接读本地 JSON（离线演示模式） */
async function loadDemo() {
  const res = await fetch('./data/demo-data.json');
  const json = await res.json();
  return json.items;
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------
async function init() {
  // 先把界面切到「加载中」，再去取数据。
  // 顺序很重要：反过来的话，取数那几百毫秒里面板显示的是"输入…开始定位"，
  // 那是**空态**的文案，会让人以为页面已就绪、只是自己没输入 —— 实际数据还在路上。
  setLoading(true);

  let items;
  try {
    items = await loadData();
  } catch (err) {
    // 取数彻底失败（本地 JSON 都不见了 / 格式坏了）。
    // 不抛出：抛出会中断 init，3D 场景根本建不起来，页面只剩一张白板。
    // 这里让场景照常建起来（空数据就是空货架），只在面板上说明出了什么事。
    setLoadError(`没能读取物资数据：${err.message}。请确认 data/demo-data.json 存在，或查看控制台。`);
    items = [];
  }

  state.items = items;
  state.byId.clear();
  for (const it of items) state.byId.set(it.materialId, it);

  // 数据就位，解除加载态
  setLoading(false);

  buildWarehouse();
  initMinimap();

  // 交互与界面
  // 把"地图状态变化"接到面板文字上：任何进出地图的路径都会自动同步按钮文案，
  // 不用在每个调用点都记得调一次 setMapUi。
  setMapUiHook((on) => {
    setMapUi(on);
    // 进地图 / 回 3D 时顺手掐掉正在跑的旋转惯性：
    // 否则切视角的瞬间镜头还会自己飘一会儿，看起来像"按了没反应又乱动"。
    // 用 hooks.stopInertia?.() 是因为 controls 的返回值只有测试会拿到，
    // 这里做可选调用，避免把 main 和 controls 的初始化顺序绑死。
    hooks.stopInertia?.();
  });
  // 地图上点中箱位时，直接走标准定位流程（和点结果列表同一条路径）
  setPickBoxHook((boxId) => {
    const item = state.items.find((it) => it.boxId === boxId);
    if (item) {
      locate(item);
      setMapUi(false);
    }
  });
  hooks = initControls(renderer.domElement);
  // 复位时也要掐掉旋转惯性（见 emphasis.resetView 的说明）
  setResetHook(() => hooks.stopInertia?.());
  // 抽屉把手：竖屏手机上可上下拖动改高度（横屏/桌面自动不生效）
  initPanelDrawer();
  // 左下虚拟摇杆：触摸设备上一根手指"走过去"（桌面端自动不显示）
  joystick = initJoystick();
  bindUi();
  setMapUi(false);
  // 此时 state.loading 已是 false，这一次会画出"输入…开始定位"或错误提示
  renderResults([], locate);
  setResultCount(0);

  // 布局与循环
  resize();
  sizeMinimap();

  // 开屏就把镜头摆到"按当前屏幕比例算出的全景距离"上。
  //
  // 这是个**真实缺陷修复**：之前只 import 了 flyToOverview 却没在这调用，
  // view.radius 一直停在 state.js 的初值 DEFAULT_VIEW.radius = 52 —— 那个值
  // 是给宽屏（aspect≈1.6）用的。手机竖屏 aspect≈0.6，水平可视半宽只有
  // 52 × tan(25°) × 0.6 ≈ 14.5，而 A 区在 x=-22、C 区在 x=+22，
  // **C 区整个被切在画面外**（真机截图确认）。
  // 只有用户按了「全景」/「复位」之后，defaultRadiusFor 才会被走到、距离才变 96。
  // 也就是说自适应距离算得对，但"开屏那一次"漏了。
  //
  // 必须在 resize() 之后调用：defaultRadiusFor 依赖 camera.aspect，
  // 而 aspect 是在 resize() 里按画布实际尺寸刷新的。
  // 用 dur=0 让它直接落位，不要开屏先飞一段动画。
  flyToOverview(0);

  startRenderLoop();

  if (window.lucide) window.lucide.createIcons();

  exposeApi(joystick);
}

init().catch((err) => {
  console.error('[warehouse3d-v2] init failed:', err);
  exposeError(err);
});
