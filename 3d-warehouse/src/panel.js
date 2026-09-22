// ============================================================================
// panel.js —— 界面 DOM 的唯一出入口（依赖 state / layout / result-card）
// ----------------------------------------------------------------------------
// 职责：所有"读写页面元素"的代码都收在这里，其他模块不直接碰 DOM。
// 好处：将来换界面（改版 / 换框架）只需要动这一个文件。
//
// 约定：本模块只负责"显示成什么样"，不含任何业务判断。
//
// 和 result-card.js 的分工：卡片**长什么样**归 result-card（可复用的那部分），
// 面板**在什么状态下摆哪些卡片**归这里（列表 / 空 / 加载 / 错误四态）。
// ============================================================================

import { state } from './state.js';
import { zoneLabel, breadcrumbFor } from './layout.js';
import { createItemCard, createHintCard, createSkeletonCard, createDetailRows } from './result-card.js';

// --- 元素引用（集中查一次，避免散落各处 querySelector） ---
const el = {
  host: () => document.getElementById('canvas-host'),
  search: () => document.getElementById('search'),
  results: () => document.getElementById('results'),
  count: () => document.getElementById('result-count'),
  breadcrumb: () => document.getElementById('breadcrumb'),
  breadcrumbText: () => document.getElementById('breadcrumb-text'),
  bcAction: () => document.querySelector('#breadcrumb .bc-action'),
  nohit: () => document.getElementById('nohit'),
  nohitTitle: () => document.getElementById('nohit-title'),
  nohitTip: () => document.getElementById('nohit-tip'),
  selinfo: () => document.getElementById('selinfo'),
  selinfoBody: () => document.getElementById('selinfo-body'),
  selHead: () => document.getElementById('selinfo-head'),
  selToggle: () => document.getElementById('selinfo-toggle'),
  btnMap: () => document.getElementById('btn-map'),
  btnMapLabel: () => document.querySelector('#btn-map span'),
  btnMapIcon: () => document.querySelector('#btn-map .c-icon'),
  mapBar: () => document.getElementById('map-bar'),
  panel: () => document.getElementById('panel'),
  collapse: () => document.getElementById('panel-collapse'),
  tab: () => document.getElementById('panel-tab'),
  tabCount: () => document.getElementById('panel-tab-count'),
};

// ---------------------------------------------------------------------------
// 输入框
// ---------------------------------------------------------------------------
/** 读取搜索框当前内容 */
export function getInputValue() {
  return el.search()?.value ?? '';
}

/** 清空搜索框 */
export function clearInput() {
  const s = el.search();
  if (s) s.value = '';
}

// ---------------------------------------------------------------------------
// 结果列表（四态：加载中 / 出错 / 空 / 有结果）
// ---------------------------------------------------------------------------
/**
 * 渲染结果列表。
 *
 * 四态的判定顺序**不能调换**，这是这段代码里唯一需要想清楚的地方：
 *   1) 加载中  —— 数据都还没到，谈不上"命中几条"，必须先判
 *   2) 出错    —— 数据到了但坏了，比"没命中"更需要人注意，优先级高于空
 *   3) nohit   —— 搜索执行了、确实没有匹配项
 *   4) 默认提示 —— 还没搜过
 * 如果先判 `!hits.length` 就会把 1、2 两种情况都错误地显示成"输入…开始定位"，
 * 用户看到的是"一切正常，只是我没输入"，而实际是数据根本没加载出来。
 *
 * @param {object[]} hits 命中记录；空数组时进入 3/4 态
 * @param {(item:object)=>void} [onPick] 点击某一项的回调
 */
export function renderResults(hits, onPick) {
  const box = el.results();
  if (!box) return;
  box.innerHTML = '';

  // ---- 1. 加载中：骨架 + 一句说明 ----
  if (state.loading) {
    box.appendChild(createHintCard('正在读取物资数据…', { kind: 'loading' }));
    // 两块骨架，形状接近真实卡片，让"即将出现什么"有预期
    box.append(createSkeletonCard(), createSkeletonCard());
    return;
  }

  // ---- 2. 出错：说清"出了什么事"和"还能做什么" ----
  if (state.loadError) {
    box.appendChild(createHintCard(state.loadError, {
      kind: 'error',
      title: '物资数据没能读出来',
    }));
    return;
  }

  // ---- 3 & 4. 空态：分"搜过没命中"和"还没搜"两种文案 ----
  if (!hits.length) {
    box.appendChild(createHintCard(
      state.nohit
        ? '换个关键词试试：物资编号、名称、区域(A B C)、排号(A1)或箱位(A-01-02)。'
        : '输入物资编号 / 名称 / 区域 / 货架排号 / 箱位开始定位。',
    ));
    return;
  }

  // ---- 有结果 ----
  const frag = document.createDocumentFragment();
  for (const it of hits) frag.appendChild(createItemCard(it, { onPick }));
  box.appendChild(frag);
}

/**
 * 只切换"加载中"这一个状态并重画列表。
 *
 * 为什么单独开一个函数而不是让调用方自己改 `state.loading` 再调 renderResults：
 * 改状态和重画必须成对出现，漏掉任何一半都会出现"数据已在加载、界面还写着
 * 输入提示"的错位。包成一个动作，调用方就没有机会只做一半。
 *
 * @param {boolean} on
 */
export function setLoading(on) {
  state.loading = !!on;
  renderResults([], null);
}

/**
 * 设置加载错误并重画。
 * @param {string} msg 面向用户的错误说明（不要塞原始堆栈）
 */
export function setLoadError(msg) {
  state.loadError = msg || '数据读取失败。';
  state.loading = false;
  renderResults([], null);
}

/**
 * 清掉错误标记。
 *
 * 必须单独开一个函数，因为 `setLoadError(null)` 走不通 ——
 * 它的第一行 `msg || '数据读取失败。'` 会把 null 当成空值填上默认文案，
 * 于是"清错误"变成了"换成另一条错误"。这个坑在测试里实测到过：
 * 调用 `setLoadError(null)` 之后 `panelState` 仍然停在 'error'。
 */
export function clearLoadError() {
  state.loadError = null;
  renderResults([], null);
}

/** 当前是否处于出错状态（供搜索流程判断要不要让位） */
export function hasLoadError() {
  return !!state.loadError;
}

/**
 * 更新"命中 N 条"计数。
 *
 * 要写**两处**：面板头的计数，和收起标签上的计数。
 * 后者是面板收着时唯一还能看到结果变化的地方，漏了它用户就完全不知道
 * 刚才那次搜索有没有搜到东西 —— 面板是关的，什么都没变。
 *
 * @param {number} n 命中条数
 */
export function setResultCount(n) {
  const c = el.count();
  if (c) c.textContent = String(n);

  const tc = el.tabCount();
  if (tc) tc.textContent = String(n);

  // 面板收着时条数变了 → 在标签上点一颗红点。
  // 只对"有结果"点亮：初始化和复位也会调 setResultCount(0)，
  // 那是把计数清零，不该被当成"搜出了新东西"。
  if (!panelOpen && n > 0) markTabNew();
}

/** 高亮结果列表中指定的一条 */
export function markActiveResult(id) {
  clearActiveResult();
  const node = document.querySelector(`.result-item[data-id="${CSS.escape(id)}"]`);
  if (node) node.classList.add('active');
}

/** 取消结果列表的全部高亮 */
export function clearActiveResult() {
  document.querySelectorAll('.result-item.active').forEach((e) => e.classList.remove('active'));
}

// ---------------------------------------------------------------------------
// 面包屑（路径提示条）
// ---------------------------------------------------------------------------
/** 显示面包屑并写入文字 */
export function setBreadcrumb(text) {
  const bc = el.breadcrumb();
  const txt = el.breadcrumbText();
  if (txt) txt.textContent = text;
  if (bc) bc.classList.remove('hidden');
}

/** 隐藏面包屑 */
export function hideBreadcrumb() {
  el.breadcrumb()?.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// 空结果提示
// ---------------------------------------------------------------------------
/** 显示"没找到"提示 */
export function setNoHit(title, tip) {
  const box = el.nohit();
  if (!box) return;
  const t = el.nohitTitle();
  const p = el.nohitTip();
  if (t) t.textContent = title;
  if (p) p.textContent = tip;
  box.classList.remove('hidden');
}

/** 隐藏"没找到"提示 */
export function hideNoHit() {
  el.nohit()?.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// 选中详情卡
// ---------------------------------------------------------------------------
/**
 * 显示某条物资的详情。
 * 注意：默认是**收起**状态 —— 手机上完整详情卡会吃掉 300px 左右，
 * 把 3D 舞台挤得只剩一半。收起后只占一行标题，想看细节再点开。
 */
export function showSelInfo(item) {
  const box = el.selinfo();
  const body = el.selinfoBody();
  if (!box || !body) return;

  // 复用 result-card 的键值行构造器，而不是在这里再拼一遍 HTML。
  // 除了少写一遍，还顺手修掉了拼字符串的隐患：物资名称/编号来自数据源，
  // 用 innerHTML 拼接等于把数据里的 < > & 当标签解析（名称里带"<"就破版）。
  // createDetailRows 内部用 textContent 逐格赋值，没有这个问题。
  body.innerHTML = '';
  body.appendChild(createDetailRows([
    ['物资编号', item.materialId],
    ['物资名称', item.materialName],
    ['校区', item.campus],
    ['区域', zoneLabel(item.zone)],
    ['排 / 层', `第${item.row}排 / 第${item.level}层`],
    ['箱子编号', item.boxId],
    ['数据状态', item.dataStatus],
    ['路径', breadcrumbFor(item)],
  ]));

  setSelInfoExpanded(false);
  box.classList.remove('hidden');
}

/** 展开 / 收起详情卡主体 */
export function setSelInfoExpanded(expanded) {
  const box = el.selinfo();
  const body = el.selinfoBody();
  const toggle = el.selToggle();
  if (body) body.classList.toggle('collapsed', !expanded);
  if (box) box.classList.toggle('collapsed', !expanded);
  if (toggle) toggle.textContent = expanded ? '收起' : '展开';
}

/** 当前详情卡是否展开 */
export function isSelInfoExpanded() {
  return !el.selinfo()?.classList.contains('collapsed');
}

/** 切换详情卡展开状态 */
export function toggleSelInfo() {
  setSelInfoExpanded(!isSelInfoExpanded());
  return isSelInfoExpanded();
}

/** 隐藏详情卡，并复位成收起状态 */
export function hideSelInfo() {
  el.selinfo()?.classList.add('hidden');
  setSelInfoExpanded(false);
}

// ---------------------------------------------------------------------------
// 地图模式界面
// ---------------------------------------------------------------------------
/**
 * 同步地图模式的界面文字。
 * @param {boolean} on 是否处于全屏地图
 */
export function setMapUi(on) {
  const label = el.btnMapLabel();
  const icon = el.btnMapIcon();
  if (label) label.textContent = on ? '3D 视角' : '地图';
  if (icon) icon.setAttribute('data-lucide', on ? 'box' : 'map');

  const btn = el.btnMap();
  if (btn) btn.title = on ? '返回 3D 视角 (M)' : '切换全屏地图 (M)';

  const bc = el.bcAction();
  if (bc) bc.textContent = on ? '返回 3D 视角' : '全屏地图';

  el.mapBar()?.classList.toggle('hidden', !on);

  // 图标是 data-lucide 换名，需要重新渲染
  if (window.lucide) window.lucide.createIcons();
}

// ---------------------------------------------------------------------------
// 面板开合（可收起悬浮窗）
// ---------------------------------------------------------------------------
/**
 * 面板是否展开。
 *
 * 初始是**收起**的：开屏时 3D 应该是完整画面，而不是先被一张空列表占掉一角。
 * 用户第一次搜索时它才弹出来 —— 那一刻列表里才有东西，弹出才有意义。
 *
 * ⚠️ 这个初值必须和 index.html 上的 `data-open="false"` 一致：
 * 首屏那一帧 CSS 按 HTML 上的属性渲染，如果 JS 起来后内部状态是"开"，
 * 会先闪出一张列表、再被收回去。
 */
let panelOpen = false;

/**
 * 用户是否**主动收起**过面板。
 *
 * 这一个布尔值决定了"收起之后还弹不弹"：
 *   false —— 还没手动收过，搜索时自动弹出（首次搜索的默认行为）
 *   true  —— 用户明确表示"我不想看它"，之后搜索只更新标签上的条数，
 *            绝不再把面板撞开。这正是用户提的要求："我也可以选择性去收起这个列表"。
 *
 * 为什么不靠 `panelOpen` 一个变量兼任：面板关着有两种原因 ——
 * "还没搜过"和"用户自己收的"，对下一次搜索的反应完全不同，
 * 用一个变量分不出来。
 */
let userCollapsed = false;

/** 面板开合后的通知回调（由 main.js 注册为"重算画布尺寸"） */
let onPanelToggleHook = null;

export function setPanelToggleHook(fn) { onPanelToggleHook = fn; }

/** 面板当前是否展开 */
export function isPanelOpen() {
  return panelOpen;
}

/** 用户是否主动收起过面板 */
export function isPanelCollapsedByUser() {
  return userCollapsed;
}

/** 把内部状态写到 DOM（真正的显隐由 styles.css 消费 data-open） */
function applyPanelOpen() {
  const p = el.panel();
  if (p) p.dataset.open = panelOpen ? 'true' : 'false';
  // body 上也记一份：右下角的浮层控件（视图按钮 / 提示条 / 面包屑）要
  // 靠它判断"该不该给面板让路"。这些元素和 .panel 分属不同父节点，
  // 用兄弟选择器够不到，只能靠 body 上的状态。
  if (typeof document !== 'undefined') {
    document.body.dataset.panelOpen = panelOpen ? 'true' : 'false';
  }
  if (onPanelToggleHook) onPanelToggleHook(panelOpen);
}

/** 点亮标签上的红点（"收起期间有新结果"） */
function markTabNew() {
  el.tab()?.classList.add('is-new');
}

/** 熄灭标签上的红点 */
function clearTabNew() {
  el.tab()?.classList.remove('is-new');
}

/** 展开面板 */
export function openPanel() {
  clearTabNew();
  if (panelOpen) return;
  panelOpen = true;
  // 手动展开意味着"我愿意看它了"，于是恢复"搜索时自动弹出"的行为
  userCollapsed = false;
  applyPanelOpen();
}

/**
 * 收起面板。
 * @param {{byUser?: boolean}} [opts] byUser=false 用于复位等程序内部收起
 */
export function closePanel({ byUser = true } = {}) {
  if (byUser) userCollapsed = true;
  if (!panelOpen) return;
  panelOpen = false;
  applyPanelOpen();
}

/** 切换开合 */
export function togglePanel() {
  if (panelOpen) closePanel();
  else openPanel();
}

/**
 * 复位到初始态：面板收起，但**不**记住"用户收起过"。
 *
 * 复位是"回到初始全景"的意思，初始状态就是面板收着、且下次搜索还会自动弹。
 * 若在这里保留 userCollapsed，用户点一次"全景"之后就再也等不到自动弹出，
 * 而屏幕上没有任何东西提示这是刚才那次复位造成的。
 */
export function resetPanelState() {
  panelOpen = false;
  userCollapsed = false;
  clearTabNew();
  applyPanelOpen();
}

// ---------------------------------------------------------------------------
// 结果面板抽屉（竖屏手机上可上下拖动）
// ---------------------------------------------------------------------------
/**
 * 抽屉三档高度（占视口高度的比例）。
 *   peek —— 收起：刚好露出一条完整结果，3D 视野最大
 *   half —— 半开：能看到两三条结果（从多条候选里挑中一条后自动到这一档）
 *   full —— 展开：看完整列表 / 详情
 *
 * 为什么 peek 是 0.27 而不是更小：
 * 面板里同时住着四样东西，高度是它们叠出来的 ——
 *   把手 22 + 面板头 44 + 结果卡 101 + 详情卡标题（收起态）约 50 ≈ 217px
 * 217 / 844 ≈ 0.257。取 0.27 留一点余量。
 * 早先设 0.22（186px）时，结果卡会被面板下沿**从中间切断**，
 * 只剩名字、meta 行看不见 —— 看起来像渲染坏了（真机截图确认过）。
 * peek 的语义就是"刚好够确认搜到的是哪一条"，卡被切一半就失去意义了。
 */
const DRAWER_RATIOS = { peek: 0.27, half: 0.5, full: 0.82 };

/** 当前抽屉档位（'peek' | 'half' | 'full'） */
let drawerLevel = 'peek';
/** 面板的交互是否已经绑定过（只绑一次） */
let panelBound = false;

/** 当前是否处于"该启用抽屉"的屏幕（竖屏且偏窄）——横屏是右侧栏，不需要抽屉 */
function drawerApplies() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 820px)').matches
    && !window.matchMedia('(orientation: landscape) and (max-height: 560px)').matches;
}

/** 把档位写成 CSS 变量，真正的高度由 styles.css 的 --drawer-h 决定 */
function applyDrawer() {
  if (typeof document === 'undefined') return;
  const panel = document.getElementById('panel');
  if (!panel) return;
  if (!drawerApplies()) {
    // 横屏 / 桌面：交回 CSS 自己管，不要留变量干扰
    panel.style.removeProperty('--drawer-h');
    panel.dataset.drawer = 'off';
    return;
  }
  const ratio = DRAWER_RATIOS[drawerLevel] ?? DRAWER_RATIOS.peek;
  panel.style.setProperty('--drawer-h', Math.round(ratio * 100) + 'vh');
  panel.dataset.drawer = drawerLevel;
}

/**
 * 设置抽屉档位。
 * @param {'peek'|'half'|'full'} level
 */
export function setDrawerLevel(level) {
  if (!(level in DRAWER_RATIOS)) return;
  drawerLevel = level;
  applyDrawer();
}

/** 当前抽屉档位 */
export function getDrawerLevel() {
  return drawerLevel;
}

/**
 * 让结果"看得见"：面板收着就弹出来，竖屏下多条结果再顺手把抽屉推到半开。
 *
 * 两个职责合在一个函数里，是因为它们回答的是同一个问题 ——
 * "搜完之后，用户该看到多少列表"。拆开就会出现"弹了面板但没升档"
 * 或者"升了档但面板还关着"的半截状态。
 *
 * 唯一的例外：**用户主动收起过面板**（userCollapsed）就什么都不做。
 * 那时搜索只在标签上更新条数、点一颗红点（在 setResultCount 里），
 * 绝不撞开面板 —— 这是用户明确要的行为。
 *
 * ⚠️ 下面有个反直觉的判断，是实测踩出来的：
 * **只有"结果不止一条、用户需要挑"时才把抽屉推高。**
 *
 * 原因：定位的主任务是"看清这个箱子在哪"，3D 才是主角。
 * 单条命中是搜索自动定位（没什么可挑的，面包屑 + 详情卡已经说明白是哪一条），
 * 此时把面板从 peek 推到 half，只会白白吃掉一半屏幕 ——
 * 自动化实测：单条命中后 3D 舞台只剩 324px / 844px = **38%**，
 * 比改造前的 76% 还差，正好撞在用户投诉的"3D 被挤成一条缝"上。
 *
 * 多条命中就相反：用户必须看见列表才能选，这时面板不升起来才是问题。
 *
 * 为什么不推到 full：即便多条，3D 也仍要占主要画面；
 * half 能看见两三条足够挑，想看全部用户自己再往上拖。
 */
export function revealResults() {
  // 用户主动收起过 → 不撞开面板。条数和红点由 setResultCount 负责。
  if (userCollapsed) return;

  openPanel();

  // 竖屏才有"档位"这回事；桌面/横屏的面板是全高悬浮窗，不需要升档
  if (!drawerApplies()) return;
  // 只数真实卡片，骨架块 / 提示块不算
  const cards = document.querySelectorAll('#results .result-item.is-card').length;
  if (cards <= 1) return;
  if (drawerLevel === 'peek') setDrawerLevel('half');
}

/**
 * 绑定面板的全部交互：开合（收起按钮 / 常驻标签）+ 竖屏抽屉拖拽。
 * 只做一次（重复调用会被忽略）。
 *
 * 抽屉的交互设计（对齐手机上的系统级底部抽屉）：
 *   - 按住把手上下拖动 → 跟手改变高度
 *   - 松手 → 吸附到最近的一档（不是停在半路，避免留在一个别扭的高度）
 *   - 快速上滑 / 下滑 → 直接到相邻档（轻扫即换档，不用精确拖到位置）
 */
export function initPanel() {
  if (panelBound || typeof document === 'undefined') return;
  const grip = document.getElementById('panel-grip');
  const panel = document.getElementById('panel');
  if (!grip || !panel) return;
  panelBound = true;

  // ---- 开合：收起按钮 + 常驻标签 ----
  // 两个入口都只改状态，显隐一律交给 CSS 消费 data-open。
  // 这样"面板长什么样"只有 styles.css 一个地方说了算，改版不用翻 JS。
  el.collapse()?.addEventListener('click', () => closePanel());
  el.tab()?.addEventListener('click', () => openPanel());
  // 把内部状态刷到 DOM 上一次。初值和 HTML 上的 data-open 一致，
  // 这一步是为了让"没有这个属性"的情况（例如老版本 HTML 缓存）也能对齐。
  applyPanelOpen();

  let dragging = false;
  let startY = 0;
  let startH = 0;
  let lastY = 0;
  let lastT = 0;
  let vy = 0;              // 抬手时的速度（px/ms），用来判断"轻扫换档"

  const vh = () => window.innerHeight;

  function currentH() {
    return panel.getBoundingClientRect().height;
  }

  function onDown(e) {
    if (!drawerApplies()) return;
    dragging = true;
    startY = e.clientY;
    lastY = e.clientY;
    lastT = performance.now();
    vy = 0;
    startH = currentH();
    panel.classList.add('drawer-dragging');
    try { grip.setPointerCapture?.(e.pointerId); } catch (_) { /* 捕获失败不影响拖拽 */ }
  }

  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const now = performance.now();
    const dy = lastY - e.clientY;          // 往上拖 = 变高
    if (now > lastT) vy = dy / (now - lastT);
    lastY = e.clientY;
    lastT = now;

    const h = Math.max(vh() * 0.12, Math.min(vh() * 0.9, startH + (startY - e.clientY)));
    panel.style.setProperty('--drawer-h', Math.round(h) + 'px');
    panel.dataset.drawer = 'drag';
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('drawer-dragging');

    // 轻扫（速度够快）→ 换一档；否则按"离哪一档近"吸附
    const order = ['peek', 'half', 'full'];
    const idx = order.indexOf(drawerLevel);
    if (Math.abs(vy) > 0.5) {
      const next = vy > 0 ? Math.min(order.length - 1, idx + 1) : Math.max(0, idx - 1);
      setDrawerLevel(order[next]);
      return;
    }
    const h = currentH();
    let best = order[0];
    let bestD = Infinity;
    for (const lv of order) {
      const d = Math.abs(h - DRAWER_RATIOS[lv] * vh());
      if (d < bestD) { bestD = d; best = lv; }
    }
    setDrawerLevel(best);
  }

  grip.addEventListener('pointerdown', onDown);
  grip.addEventListener('pointermove', onMove, { passive: false });
  grip.addEventListener('pointerup', onUp);
  grip.addEventListener('pointercancel', onUp);

  // 键盘可达：把手聚焦后，上下键换档（无障碍）
  grip.addEventListener('keydown', (e) => {
    const order = ['peek', 'half', 'full'];
    const idx = order.indexOf(drawerLevel);
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setDrawerLevel(order[Math.min(order.length - 1, idx + 1)]);
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setDrawerLevel(order[Math.max(0, idx - 1)]);
    }
  });

  // 旋屏 / 改窗口大小后，档位要按新视口重新算
  window.addEventListener('resize', applyDrawer);
  window.addEventListener('orientationchange', applyDrawer);

  applyDrawer();
}
