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
//   minimap.js   小地图（独立模块，当前界面已停用）
//   api.js       对外测试接口（window.__diag / window.__api）
//   main.js      组装层：把上面这些接起来 + 绑定界面事件 + 启动  ← 本文件
// ==============================================================================
//
// 备份位置：../3d-warehouse.backup（重构前完整快照，验收通过后可删）

import { DATA_SOURCE } from './config.js';
import { state } from './state.js';
import { loadFromApi, loadFromTencentDocs } from './adapter.js';
import { buildWarehouse, renderer, resize, composer } from './scene.js';
import { updateCamera, stepAnimation } from './camera.js';
import { locate, resetView } from './emphasis.js';
import { search } from './search.js';
import { renderResults } from './panel.js';
import { initControls } from './controls.js';
import { initMinimap, sizeMinimap, renderMinimap } from './minimap.js';
import { exposeApi, exposeError } from './api.js';

// ---------------------------------------------------------------------------
// 界面事件绑定
// ---------------------------------------------------------------------------
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

  document.getElementById('search').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') resetView();
  });

  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.id === 'search') return;
    if (e.key === 'r' || e.key === 'R') resetView();
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
  const items = await loadData();
  state.items = items;
  state.byId.clear();
  for (const it of items) state.byId.set(it.materialId, it);

  buildWarehouse();
  initMinimap();

  // 交互与界面
  initControls(renderer.domElement);
  bindUi();
  renderResults([], locate);   // 先渲染一次空列表（带提示语）

  // 布局与循环
  resize();
  sizeMinimap();
  startRenderLoop();

  if (window.lucide) window.lucide.createIcons();

  exposeApi();
}

init().catch((err) => {
  console.error('[warehouse3d-v2] init failed:', err);
  exposeError(err);
});
