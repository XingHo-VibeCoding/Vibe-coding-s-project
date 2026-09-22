// 手机端体验优化的专项验收脚本。
// 覆盖四项改动：旋转灵敏度 / 详情卡可收起 / 全屏地图 / 全景自适应。
// 运行：把本文件放到 node_modules 同级目录再执行（NODE_PATH 对 ESM import 无效）
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8010/';
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

const browser = await chromium.launch();

// =====================================================================
// A. 手机端（390x844 触屏）
// =====================================================================
const mob = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true, isMobile: true, deviceScaleFactor: 3,
});
const mErr = [];
mob.on('pageerror', (e) => mErr.push(String(e)));
mob.on('console', (m) => { if (m.type() === 'error') mErr.push(m.text()); });

await mob.goto(BASE, { waitUntil: 'load' });
await mob.waitForFunction(() => window.__diag && window.__diag.ready === true, { timeout: 15000 });

// ---- 1. 旋转灵敏度：同样滑动距离，触摸应该转得更多 ----
// 四个坑，都踩过了：
//   a) CDP 的 dispatchTouchEvent 会把连续 touchMove 合并（发 10 个只到 2 个），测不准；
//   b) 视角监听器绑在 #canvas-host 里的 <canvas> 上（见 main.js 的 initControls），
//      事件必须派发给 canvas 本身，派给外层 div 是到不了的；
//   c) **必须用有符号位移**，不能取绝对值。初始 theta=0.62，触摸滑 100px 转 -1.1，
//      落到 -0.48；这里 0.62 就在 ±π 边界附近，取绝对值会把 -0.48 折成 0.48，
//      看起来"和鼠标的 0.5 一样"，恰好把 2.2 倍的差距抹平 —— 曾经因此误判成失败。
//      （camera.js 的 rotateBy 现已把 theta 归一化到 (-π, π]，数值不会无限漂。）
//   d) **抬手后有一段惯性**（flick），theta 还会继续变。
//      必须在抬手后、读数前调 haltInertia()，否则读到的是个还在变的值，
//      断言会随机通过/失败（实测同一个用例一次 2.17、一次 3.60）。
//      为了分离"跟手灵敏度"和"惯性"，这里读的是**抬手瞬间**的值。
async function rotateBy(pointerType, px) {
  return mob.evaluate(async ({ pointerType, px }) => {
    window.__api.reset();
    await new Promise((r) => setTimeout(r, 1200)); // 等复位动画走完

    const st = await import('./src/state.js');
    const canvas = document.querySelector('#canvas-host canvas');
    const theta0 = st.view.theta;

    const mk = (type, x) => new PointerEvent(type, {
      pointerId: 95, pointerType, isPrimary: true, bubbles: true,
      cancelable: true, button: 0, clientX: x, clientY: 420,
    });

    canvas.dispatchEvent(mk('pointerdown', 100));
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      canvas.dispatchEvent(mk('pointermove', 100 + (px * i) / steps));
    }
    // 读"抬手前"的值 = 手指实际拖出来的转量，不含惯性
    const dragged = st.view.theta - theta0;
    window.dispatchEvent(mk('pointerup', 100 + px));
    window.__api.haltInertia();          // 掐掉惯性，避免污染后续用例
    await new Promise((r) => setTimeout(r, 120));

    // 返回"偏航角的有符号变化量"，这是灵敏度系数唯一直接作用的对象
    return +dragged.toFixed(4);
  }, { pointerType, px });
}

const DRAG_PX = 100;
const touchRotate = await rotateBy('touch', DRAG_PX);
const mouseRotate = await rotateBy('mouse', DRAG_PX);
// 方向由 dx 的正负决定，两种指针必然同号；比较时取量值
const touchMag = Math.abs(touchRotate);
const mouseMag = Math.abs(mouseRotate);

check('触摸旋转比鼠标旋转更灵敏（比值约 2.2 倍）',
  touchMag > 0 && mouseMag > 0 && touchMag > mouseMag * 1.8,
  `滑动 ${DRAG_PX}px 偏航角变化：touch=${touchMag} rad，mouse=${mouseMag} rad，比值=${(touchMag / mouseMag).toFixed(2)}`);
check('触摸滑动 100px 能转约 1 弧度（够一次到位）', touchMag > 0.8,
  `${touchMag} rad ≈ ${(touchMag * 57.3).toFixed(0)}°`);

// ---- 1b. 飞行途中拖动必须能抢断动画（真实缺陷的回归锁） ----
// 背景：步进动画 stepAnimation 每帧都会把 view.theta 重写成插值结果。
// 若动画没播完用户就拖，手指算出的 theta 下一帧就被覆盖 —— 表现为"划了没反应"。
// 这正是用户反馈"要大角度得划好多下"的第二个原因，这里专门锁住它。
const interrupt = await mob.evaluate(async () => {
  window.__api.reset();
  await new Promise((r) => setTimeout(r, 200)); // 故意**不等**动画播完

  const st = await import('./src/state.js');
  const cam = await import('./src/camera.js');
  const canvas = document.querySelector('#canvas-host canvas');
  const animatingBefore = cam.isAnimating();
  const t0 = st.view.theta;

  const mk = (type, x) => new PointerEvent(type, {
    pointerId: 96, pointerType: 'touch', isPrimary: true, bubbles: true,
    cancelable: true, button: 0, clientX: x, clientY: 420,
  });
  canvas.dispatchEvent(mk('pointerdown', 100));
  // 拖得长一点（10 步 × 15px = 150px），保证转量明显超过阈值
  for (let i = 1; i <= 10; i++) canvas.dispatchEvent(mk('pointermove', 100 + i * 15));
  window.dispatchEvent(mk('pointerup', 250));
  window.__api.haltInertia();

  await new Promise((r) => setTimeout(r, 400)); // 超过动画剩余时长，确认没被"拉回去"
  return {
    animatingBefore,
    animatingAfter: cam.isAnimating(),
    delta: +(st.view.theta - t0).toFixed(4),
  };
});
check('飞行途中拖动会中断动画（不会被动画覆盖回去）',
  interrupt.animatingBefore && !interrupt.animatingAfter && Math.abs(interrupt.delta) > 0.5,
  `动画中=${interrupt.animatingBefore} → 拖动后=${interrupt.animatingAfter}，theta 变化 ${interrupt.delta} rad`);

// ---- 1c. 无限拖拽：横向能一直转、纵向能转到接近垂直 ----
// 这是用户明确要的"不管手指怎么移动都能无限拖拽"。
// 分两块验证：
//   横向（theta）—— 数学上无界，连续 4 大圈都该转得动，不能出现"转不动了"；
//   纵向（phi）—— 球坐标下有点顶（转过去就是头顶），但必须能一直推到接近垂直，
//                 且在边界处平滑减速而不是一步卡死。
const infinite = await mob.evaluate(async () => {
  window.__api.reset();
  await new Promise((r) => setTimeout(r, 1000));

  const st = await import('./src/state.js');
  const cam = await import('./src/camera.js');
  const canvas = document.querySelector('#canvas-host canvas');
  const mk = (type, x, y) => new PointerEvent(type, {
    pointerId: 98, pointerType: 'touch', isPrimary: true, bubbles: true,
    cancelable: true, button: 0, clientX: x, clientY: y,
  });

  // 用 panBy/rotateBy 直接驱动更可控（测的是"有没有上限"，不是事件管线）
  // 横向：连续转 4 圈（4 × 2π ≈ 25.1 rad），分 40 次推进
  let thetaTotal = 0;
  let prev = st.view.theta;
  const perStep = (Math.PI * 2 * 4) / 40;
  for (let i = 0; i < 40; i++) {
    cam.rotateBy(perStep, 0);
    let d = st.view.theta - prev;
    // 归一化后的跨度要折回 [-π, π] 才能累加
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    thetaTotal += d;
    prev = st.view.theta;
  }

  // 纵向：从默认 phi 一路往上推 400 次，看能不能到接近垂直（phi → 0）
  st.view.phi = 0.95;
  for (let i = 0; i < 400; i++) cam.rotateBy(0, -0.02);
  const phiAtTop = st.view.phi;
  // 再一路往下推，看能不能到接近水平（phi → π/2）
  for (let i = 0; i < 400; i++) cam.rotateBy(0, 0.02);
  const phiAtBottom = st.view.phi;

  // 边界手感：贴边时一小步位移应该被明显削弱（平滑减速，不是硬撞停）
  st.view.phi = 0.06;                    // 已经贴近上边界
  cam.rotateBy(0, -0.02);
  const phiNearEdgeStep = Math.abs(0.06 - st.view.phi);
  st.view.phi = 1.0;                     // 远离边界
  cam.rotateBy(0, -0.02);
  const phiMidStep = Math.abs(1.0 - st.view.phi);

  window.__api.haltInertia();
  return {
    thetaTotal: +thetaTotal.toFixed(2),
    phiAtTop: +phiAtTop.toFixed(4),
    phiAtBottom: +phiAtBottom.toFixed(4),
    range: window.__diag.phiRange(),
    phiNearEdgeStep: +phiNearEdgeStep.toFixed(5),
    phiMidStep: +phiMidStep.toFixed(5),
  };
});
check('横向可以一直转（连续 4 圈 ≈ 25.1 rad 全部转出来了）',
  Math.abs(infinite.thetaTotal) > 24,
  `累计转过 ${infinite.thetaTotal} rad ≈ ${(infinite.thetaTotal * 57.3 / 360).toFixed(1)} 圈`);
check('纵向能一直推到接近垂直俯视（phi 到下限）',
  Math.abs(infinite.phiAtTop - infinite.range.min) < 0.01,
  `推到 phi=${infinite.phiAtTop}（下限 ${infinite.range.min.toFixed(3)}，0 即正上方）`);
check('纵向能一直拉到接近水平平视（phi 到上限）',
  Math.abs(infinite.phiAtBottom - infinite.range.max) < 0.01,
  `拉到 phi=${infinite.phiAtBottom}（上限 ${infinite.range.max.toFixed(3)}）`);
check('贴边时位移被平滑削弱（是"越转越沉"而不是硬卡住）',
  infinite.phiNearEdgeStep < infinite.phiMidStep * 0.6 && infinite.phiNearEdgeStep > 0,
  `贴边一步 ${infinite.phiNearEdgeStep}，远离边界一步 ${infinite.phiMidStep}，比值 ${(infinite.phiNearEdgeStep / infinite.phiMidStep).toFixed(2)}`);

// ---- 2. 详情卡：搜单条 → 默认收起；搜多条 → 自动进地图 ----
await mob.evaluate(() => window.__api.reset());
await mob.waitForTimeout(1200);
// 用编号搜，只命中 1 条，才会自动定位并弹详情卡
await mob.fill('#search', 'FZ-SP-00008');
await mob.press('#search', 'Enter');
await mob.waitForTimeout(1600);

const selState = await mob.evaluate(() => ({
  visible: !document.getElementById('selinfo').classList.contains('hidden'),
  collapsed: document.getElementById('selinfo').classList.contains('collapsed'),
  expanded: window.__diag.selExpanded(),
  toggleTxt: document.getElementById('selinfo-toggle').textContent,
  bodyDisplay: getComputedStyle(document.getElementById('selinfo-body')).display,
  panelH: Math.round(document.getElementById('panel').getBoundingClientRect().height),
  resultsH: Math.round(document.getElementById('results').getBoundingClientRect().height),
  stageH: Math.round(document.querySelector('.stage').getBoundingClientRect().height),
  viewportH: window.innerHeight,
}));
check('单条命中详情卡可见', selState.visible);
check('详情卡默认是收起状态', selState.collapsed && selState.expanded === false,
  `collapsed=${selState.collapsed} toggle="${selState.toggleTxt}"`);
check('收起时详情主体不占空间', selState.bodyDisplay === 'none', `display=${selState.bodyDisplay}`);
check('收起后 3D 舞台占屏超过 45%', selState.stageH / selState.viewportH > 0.45,
  `stage=${selState.stageH}px / viewport=${selState.viewportH}px = ${(selState.stageH / selState.viewportH * 100).toFixed(1)}%`);

await mob.screenshot({ path: 'verify/shots/shot-m-fixed-detail.png' });

/**
 * 用元素中心点的真实坐标点击。
 *
 * 为什么不用 `page.click(sel)`：body 设了 `position: fixed` 之后，
 * Playwright 的"可点性检查"（等元素稳定、可滚入视口）会一直认为它不可点，
 * 即使 `elementFromPoint` 拿到的最顶层元素就是目标本身，也会 5 秒超时。
 * 实测布局完全正常（head 在 684~717px，视口 727px，没有被任何元素遮挡）。
 * 改用"先取坐标、再派发真实鼠标事件"就稳定了。
 */
async function tapAt(page, sel, { requireInView = false } = {}) {
  const pt = await page.evaluate(({ s, needVisible }) => {
    const els = [...document.querySelectorAll(s)];
    if (!els.length) return null;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (needVisible) {
        // 中心点必须真的落在视口里，且命中测试拿到的就是自己（没被裁切/遮挡）
        if (cy < 0 || cy > window.innerHeight) continue;
        const hit = document.elementFromPoint(cx, cy);
        if (!(hit === el || el.contains(hit))) continue;
      }
      return { x: Math.round(cx), y: Math.round(cy) };
    }
    // 回退：取第一个有尺寸的
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }
    return null;
  }, { s: sel, needVisible: requireInView });
  if (!pt) throw new Error('找不到可点的元素: ' + sel);
  await page.mouse.click(pt.x, pt.y);
  return pt;
}

// 点标题行展开
await tapAt(mob, '#selinfo-head');
await mob.waitForTimeout(400);
const afterExpand = await mob.evaluate(() => ({
  expanded: window.__diag.selExpanded(),
  toggleTxt: document.getElementById('selinfo-toggle').textContent,
  bodyDisplay: getComputedStyle(document.getElementById('selinfo-body')).display,
  panelH: Math.round(document.getElementById('panel').getBoundingClientRect().height),
  resultsH: Math.round(document.getElementById('results').getBoundingClientRect().height),
}));
check('点标题行可展开详情', afterExpand.expanded === true && afterExpand.bodyDisplay !== 'none',
  `toggle="${afterExpand.toggleTxt}"`);
// ⚠️ 断言对象从 .panel 改成 .results（Day 8 抽屉改造后必须这样测）：
// 抽屉接管了面板高度之后，面板高度由档位（peek/half/full）钉死，
// 折叠详情卡**不再**改变面板高度 —— 但它省下的空间仍然真实存在，
// 只是被 .results（flex:1）吸走了，表现为"结果列表可视区变高"。
// 也就是说"折叠确实省了空间"这个用户价值没变，只是度量点该跟着布局走。
// 若继续断言 panelH，测的就是一个已经被设计取代的实现细节，会永远失败。
check('展开详情卡后结果列表被挤矮（说明折叠确实省了空间）',
  afterExpand.resultsH < selState.resultsH,
  `收起时列表 ${selState.resultsH}px → 展开后 ${afterExpand.resultsH}px（面板高 ${selState.panelH}→${afterExpand.panelH} 由抽屉档位决定，不再随内容变）`);

// 再点一次收起
await tapAt(mob, '#selinfo-head');
await mob.waitForTimeout(300);
check('再点一次可收回', (await mob.evaluate(() => window.__diag.selExpanded())) === false);

// 重新搜索应重置为收起
await tapAt(mob, '#selinfo-head');
await mob.waitForTimeout(300);
await mob.fill('#search', 'FZ-SP-00001');
await mob.press('#search', 'Enter');
await mob.waitForTimeout(1600);
check('重新搜索后详情卡回到收起状态',
  (await mob.evaluate(() => window.__diag.selExpanded())) === false);

// ---- 2b. 多条命中 → 自动切全屏地图（看空间分布） ----
await mob.fill('#search', '杯子');
await mob.press('#search', 'Enter');
await mob.waitForTimeout(1600);
const multiHits = await mob.evaluate(() => ({
  count: +(document.getElementById('result-count').textContent),
  mapMode: window.__diag.mapMode(),
  outline: window.__diag.highlight() ? window.__diag.highlight().outline : 0,
  items: document.querySelectorAll('.result-item').length,
}));
check('搜「杯子」命中 2 条', multiHits.count === 2 && multiHits.items === 2,
  `count=${multiHits.count} items=${multiHits.items}`);
check('多条命中自动切到全屏地图', multiHits.mapMode === true, `mapMode=${multiHits.mapMode}`);

// 地图模式下结果项必须仍然可点。
// 这里锁住一个踩过的坑：为了"把画面让给地图"把面板压到 92px，
// 而结果项本身有 101px 高 —— 整项被裁到面板外，元素在、看着也在，
// 但手指点上去毫无反应（命中测试拿不到它）。
// 断言方式：用 elementFromPoint 验证有结果项的中心点确实命中它自己。
const itemHittable = await mob.evaluate(() => {
  const items = [...document.querySelectorAll('.result-item')];
  const ok = items.filter((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cy < 0 || cy > window.innerHeight) return false;
    const hit = document.elementFromPoint(cx, cy);
    return hit === el || el.contains(hit);
  });
  const r0 = items[0]?.getBoundingClientRect();
  return {
    total: items.length,
    hittable: ok.length,
    firstItemH: r0 ? Math.round(r0.height) : 0,
    resultsH: Math.round(document.querySelector('.results')?.getBoundingClientRect().height || 0),
  };
});
check('地图模式下结果项仍可点中（面板没把内容裁掉）',
  itemHittable.hittable >= 1,
  `可点 ${itemHittable.hittable}/${itemHittable.total} 项，单项高 ${itemHittable.firstItemH}px，列表可视高 ${itemHittable.resultsH}px`);

await mob.screenshot({ path: 'verify/shots/shot-m-fixed-multi.png' });

// 点列表里的一条 → 应退出地图并聚焦
// 注意：结果项在底部面板里，panel 有 max-height + 滚动，
// 直接取 .result-item 的中心点可能落在被裁切的位置（点不中，甚至会穿到画布上去）。
// 所以先挑"确实完整落在面板可视区内"的那一项再点。
await tapAt(mob, '.result-item', { requireInView: true });
await mob.waitForTimeout(1400);
const afterPick = await mob.evaluate(() => ({
  mapMode: window.__diag.mapMode(),
  hi: window.__diag.highlight(),
  selVisible: !document.getElementById('selinfo').classList.contains('hidden'),
}));
check('点结果项后退出地图并聚焦', afterPick.mapMode === false && afterPick.hi && afterPick.hi.outline === 1,
  `mapMode=${afterPick.mapMode} hi=${JSON.stringify(afterPick.hi)}`);

// ---- 3. 全屏地图：点面包屑进入 / 退出 ----
await mob.evaluate(() => window.__api.reset());
await mob.waitForTimeout(1300);
// 复位后面包屑是隐藏的，先搜单条让它出现
await mob.fill('#search', 'FZ-SP-00008');
await mob.press('#search', 'Enter');
await mob.waitForTimeout(1600);
check('搜单条后处于 3D 模式（未进地图）',
  (await mob.evaluate(() => window.__diag.mapMode())) === false);

await tapAt(mob, '#breadcrumb');
await mob.waitForTimeout(900);

const inMap = await mob.evaluate(() => ({
  mapMode: window.__diag.mapMode(),
  bounds: window.__diag.mapBounds(),
  bodyClass: document.body.classList.contains('map-mode'),
  btnTxt: document.querySelector('#btn-map span').textContent,
  bcAction: document.querySelector('#breadcrumb .bc-action').textContent,
  mapBarVisible: !document.getElementById('map-bar').classList.contains('hidden'),
  panelH: Math.round(document.getElementById('panel').getBoundingClientRect().height),
}));
check('点面包屑进入全屏地图', inMap.mapMode === true && inMap.bodyClass === true,
  `mapMode=${inMap.mapMode} bodyClass=${inMap.bodyClass}`);
check('按钮文字变为「3D 视角」', inMap.btnTxt === '3D 视角', `"${inMap.btnTxt}"`);
check('面包屑右侧提示变为「返回 3D 视角」', inMap.bcAction === '返回 3D 视角', `"${inMap.bcAction}"`);
check('地图操作提示条出现', inMap.mapBarVisible === true);
// 面板要"明显变矮"把画面让给地图，但**不能矮到装不下一条结果**：
// 结果项约 101px，面板至少得留出这么多，否则整项被裁在可视区外，
// 元素在、看着也在，手指点上去却没反应（见下面那条可点性断言）。
check('地图下结果面板明显变矮、但仍容得下一项',
  inMap.panelH < selState.panelH && inMap.panelH >= 110,
  `地图下面板 ${inMap.panelH}px（非地图时 ${selState.panelH}px，需 ≥110 才放得下一条结果）`);
check('竖屏地图横向视野足够装下 A~C 三区', inMap.bounds.right >= 30
  && inMap.bounds.right / inMap.bounds.zoom >= 25,
  `${JSON.stringify(inMap.bounds)} → 可见半宽 ${(inMap.bounds.right / inMap.bounds.zoom).toFixed(1)}（需 ≥25）`);

await mob.screenshot({ path: 'verify/shots/shot-m-fixed-map.png' });

// 再点一次面包屑 → 退出地图
await tapAt(mob, '#breadcrumb');
await mob.waitForTimeout(900);
const outMap = await mob.evaluate(() => ({
  mapMode: window.__diag.mapMode(),
  btnTxt: document.querySelector('#btn-map span').textContent,
}));
check('再点面包屑退出地图并还原文字',
  outMap.mapMode === false && outMap.btnTxt === '地图',
  `mapMode=${outMap.mapMode} btn="${outMap.btnTxt}"`);

// ---- 4. 地图点选：重新进地图，点右侧应飞到 C 区 ----
await tapAt(mob, '#btn-map');
await mob.waitForTimeout(900);
const pickResult = await mob.evaluate(async () => {
  const host = document.getElementById('canvas-host');
  const r = host.getBoundingClientRect();
  const wx = r.left + r.width * 0.85;
  const wy = r.top + r.height * 0.5;
  const ground = window.__api.screenToGround(wx, wy);
  // 模拟"轻点"：pointerdown 与 click 位置一致
  host.dispatchEvent(new PointerEvent('pointerdown', {
    pointerId: 3, pointerType: 'touch', clientX: wx, clientY: wy, bubbles: true, button: 0,
  }));
  host.dispatchEvent(new MouseEvent('click', {
    clientX: wx, clientY: wy, bubbles: true, button: 0,
  }));
  await new Promise((res) => setTimeout(res, 1300));
  return {
    ground: ground ? { x: +ground.x.toFixed(1), z: +ground.z.toFixed(1) } : null,
    mapMode: window.__diag.mapMode(),
    target: window.__diag.target(),
  };
});
check('地图点选能反算地面坐标', pickResult.ground !== null,
  JSON.stringify(pickResult.ground));
check('点选后自动退出地图回到 3D', pickResult.mapMode === false, `mapMode=${pickResult.mapMode}`);
check('点选右侧位置飞到 C 区（x 为正）', pickResult.target[0] > 5,
  `target=${JSON.stringify(pickResult.target)} ground=${JSON.stringify(pickResult.ground)}`);

// ---- 4a. 每次进地图，俯视相机都必须回到场景中心 ----
// 这条是上面那条"飞到 C 区"能稳定成立的前提，也是真机手感的一部分：
//   进地图 = 看全貌，所以不该"接着上次拖动的位置"。
// 修复前 enterMap() 只在第一次进来时重置 view2d.target，
// 一旦在地图里拖动过（或上一段 flyTo 动画还在往 view2d.target 写值），
// 再进来画面就是偏的 —— 于是"点右侧"换算出来的世界坐标也跟着漂，
// 表现成"同一个位置点两次，落点却不一样"。
const mapCenter1 = await mob.evaluate(() => window.__diag.topCamPos());
check('地图俯视相机对准场景中心（x≈0、z≈5）',
  Math.abs(mapCenter1[0]) < 1 && Math.abs(mapCenter1[2] - 5) < 1,
  `topCam=${JSON.stringify(mapCenter1)}`);

// ---- 4b. 地图上直接点中货架 → 应定位到那一排（层由 3D 呈现） ----
// 说明：俯视时同一排三层箱子垂直重叠，射线必然只打到最上面那层，
//       所以"点箱位"只能确定到排。这里断言落点在 C-03 这一排。
await tapAt(mob, '#btn-map');
await mob.waitForTimeout(1000);
const boxPick = await mob.evaluate(async () => {
  const host = document.getElementById('canvas-host');
  const r = host.getBoundingClientRect();
  const st = await import('./src/state.js');
  const sceneMod = await import('./src/scene.js');

  const mesh = st.state.meshes.get('C-03-01');
  const v = mesh.position.clone();
  v.y = 0;
  v.project(sceneMod.topCam);
  const sx = r.left + ((v.x + 1) / 2) * r.width;
  const sy = r.top + ((1 - v.y) / 2) * r.height;

  host.dispatchEvent(new PointerEvent('pointerdown', {
    pointerId: 11, pointerType: 'touch', clientX: sx, clientY: sy, bubbles: true, button: 0,
  }));
  host.dispatchEvent(new MouseEvent('click', {
    clientX: sx, clientY: sy, bubbles: true, button: 0,
  }));
  await new Promise((res) => setTimeout(res, 1400));
  return {
    screen: [Math.round(sx), Math.round(sy)],
    mapMode: window.__diag.mapMode(),
    hi: window.__diag.highlight(),
    selVisible: !document.getElementById('selinfo').classList.contains('hidden'),
  };
});
check('地图上点中货架能定位到那一排（C-03）',
  boxPick.hi && /^C-03-\d\d$/.test(boxPick.hi.boxId),
  `点(${boxPick.screen}) → highlight=${JSON.stringify(boxPick.hi)}`);
check('点中货架后退出地图并弹出详情卡',
  boxPick.mapMode === false && boxPick.selVisible === true,
  `mapMode=${boxPick.mapMode} selVisible=${boxPick.selVisible}`);

// 拖拽不应该被误判为点选
await tapAt(mob, '#btn-map');
await mob.waitForTimeout(900);
const dragTest = await mob.evaluate(async () => {
  const host = document.getElementById('canvas-host');
  const r = host.getBoundingClientRect();
  const x0 = r.left + r.width * 0.5, y0 = r.top + r.height * 0.5;
  host.dispatchEvent(new PointerEvent('pointerdown', {
    pointerId: 4, pointerType: 'touch', clientX: x0, clientY: y0, bubbles: true, button: 0,
  }));
  host.dispatchEvent(new PointerEvent('pointermove', {
    pointerId: 4, pointerType: 'touch', clientX: x0 + 60, clientY: y0, bubbles: true, button: 0,
  }));
  host.dispatchEvent(new MouseEvent('click', {
    clientX: x0 + 60, clientY: y0, bubbles: true, button: 0,
  }));
  await new Promise((res) => setTimeout(res, 500));
  return window.__diag.mapMode();
});
check('拖拽平移不会误触发点选（仍在地图里）', dragTest === true, `mapMode=${dragTest}`);

// 退出地图，回到 3D。这里**必须带超时**：
// 之前的脚本写的是裸 click('#breadcrumb')，一旦面包屑处于 hidden
// （地图模式下会被 CSS 隐藏 / 搜索结果为空时也是隐藏的），
// Playwright 会一直等元素可点，整个测试就永久挂住 —— 排查了很久才定位到。
if (await mob.evaluate(() => window.__diag.mapMode())) {
  await mob.evaluate(() => window.__api.exitMap());
  await mob.waitForTimeout(700);
}

// ---- 6. 全景自适应：竖屏要自动站远到能装下 A~C 三区 ----
// 这条只依赖画布宽高比，和地图状态无关，放在地图外面测更稳
const overviewRadius = await mob.evaluate(() => window.__diag.mapRadius());
check('竖屏全景距离自适应 > 52', overviewRadius > 52, `radius=${overviewRadius.toFixed(1)}`);

// 直接验证"货架两端是否真的在画面里"，而不是只看距离数字。
// 这是真机截图里"C 区标签被右边缘切掉"的正面回归：
// 把最左(A 区)与最右(C 区)的货架下端角点投影到 NDC，
// x 必须都在 [-1, 1] 内，否则就是被裁掉了。
const frustum = await mob.evaluate(async () => {
  const cam = await import('./src/camera.js');
  const sc = await import('./src/scene.js');
  const st = await import('./src/state.js');
  const V3 = sc.camera.position.constructor;
  cam.flyToOverview(0);                 // 立刻到位，不等动画
  await new Promise((r) => setTimeout(r, 250));
  cam.updateCamera();
  // A 区最左 / C 区最右，取货架底部与顶部两处高度
  const pts = [];
  for (const [x, y] of [[-22, 0], [22, 0], [-22, 6], [22, 6]]) {
    const v = new V3(x, y, 5);
    v.project(sc.camera);
    pts.push({ x: +v.x.toFixed(3), y: +v.y.toFixed(3) });
  }
  return { pts, radius: +st.view.radius.toFixed(1), aspect: +sc.camera.aspect.toFixed(2) };
});
const allInside = frustum.pts.every((v) => Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1);
check('竖屏下 A~C 三区货架完整入画（不被左右裁掉）',
  allInside,
  `radius=${frustum.radius} aspect=${frustum.aspect}，货架两端 NDC x=${frustum.pts.map((p) => p.x).join(' / ')}（需都在 ±1 内）`);

// ---- 6b. 页面锁死：手指在画布上滑动不能把整个页面滚走 ----
// 这是真机反馈的核心问题：截图里地址栏收起/放下、页面被顶下去。
// 成因有两层，都要断掉：
//   1) html/body 必须一起 overflow:hidden + overscroll-behavior:none（只设 body 无效）
//   2) 画布必须 touch-action:none，否则浏览器会把纵向滑动解读为滚动页面/下拉刷新
const locked = await mob.evaluate(() => {
  const cs = (el) => getComputedStyle(el);
  const html = document.documentElement;
  const canvas = document.querySelector('#canvas-host canvas');
  // 试着程序化滚动，看能不能滚得动
  window.scrollTo(0, 500);
  const scrolledTo = window.scrollY;
  window.scrollTo(0, 0);
  return {
    htmlOverflow: cs(html).overflow,
    bodyOverflow: cs(document.body).overflow,
    htmlOverscroll: cs(html).overscrollBehavior,
    bodyOverscroll: cs(document.body).overscrollBehavior,
    bodyPosition: cs(document.body).position,
    canvasTouchAction: cs(canvas).touchAction,
    hostTouchAction: cs(document.getElementById('canvas-host')).touchAction,
    scrolledTo,
    docScrollable: html.scrollHeight > html.clientHeight + 1,
  };
});
check('html 与 body 都锁住滚动（不能只设 body）',
  locked.htmlOverflow === 'hidden' && locked.bodyOverflow === 'hidden',
  `html=${locked.htmlOverflow} body=${locked.bodyOverflow}`);
check('关掉回弹与下拉刷新（overscroll-behavior: none）',
  locked.htmlOverscroll === 'none' && locked.bodyOverscroll === 'none',
  `html=${locked.htmlOverscroll} body=${locked.bodyOverscroll}`);
check('3D 画布接管全部触摸（touch-action: none）',
  locked.canvasTouchAction === 'none' && locked.hostTouchAction === 'none',
  `canvas=${locked.canvasTouchAction} host=${locked.hostTouchAction}`);
check('页面在布局层面就滚不动（position: fixed + 程序化滚动无效）',
  locked.bodyPosition === 'fixed' && locked.scrolledTo === 0 && !locked.docScrollable,
  `body=${locked.bodyPosition}，scrollTo(0,500) 后 scrollY=${locked.scrolledTo}，文档可滚=${locked.docScrollable}`);

// ---- 7. M 键切换地图 + Esc 退出 ----
await mob.evaluate(() => window.__api.reset());
await mob.waitForTimeout(1200);
await mob.keyboard.press('m');
await mob.waitForTimeout(600);
const mOn = await mob.evaluate(() => window.__diag.mapMode());
await mob.keyboard.press('Escape');
await mob.waitForTimeout(600);
const mOff = await mob.evaluate(() => window.__diag.mapMode());
check('M 键进入地图、Esc 退出', mOn === true && mOff === false, `M=${mOn} Esc=${mOff}`);

// =====================================================================
// 8. 结果面板抽屉（竖屏手机可上下拖动）
// =====================================================================
// 背景：手机竖屏纵向空间只有 700px 上下，顶栏 + 底部面板一夹，
// 3D 只剩中间一条窄缝。改成三档抽屉，让用户自己决定"看货架还是看列表"。
//
// ⚠️ 这里必须用真实指针事件驱动把手，不能只调 __api.setDrawer()：
// 变量写对 ≠ 高度生效。曾经踩过的坑：CSS 用 max-height 消费变量，
// 而手机网格行是 `auto`（高度由内容决定），max-height 只能往下压不能往上撑 ——
// 变量 82vh 算出来 692px 全对，面板实际却纹丝不动停在 124px。
// 所以断言读的是 getBoundingClientRect().height（用户看到多高），
// 不是 CSS 变量。
await mob.evaluate(() => window.__api.reset());
await mob.waitForTimeout(1300);

const dw0 = await mob.evaluate(() => window.__diag.drawer());
const peekH = Math.round(844 * 0.27);
check('复位后抽屉回到 peek 档（「全景」要把 3D 视野也让回来）',
  dw0.level === 'peek' && dw0.gripVisible === true && Math.abs(dw0.height - peekH) <= 12,
  `level=${dw0.level} height=${dw0.height}（期望≈${peekH}）grip=${dw0.gripVisible}`);

// 三档 → 高度映射必须真的生效（这是"变量写对但高度没动"那个坑的回归锁）
const dwHeights = {};
for (const [lv, ratio] of [['half', 0.5], ['full', 0.82], ['peek', 0.27]]) {
  await mob.evaluate((l) => window.__api.setDrawer(l), lv);
  await mob.waitForTimeout(400);            // 等过渡走完
  const d = await mob.evaluate(() => window.__diag.drawer());
  dwHeights[lv] = { got: d.height, want: Math.round(844 * ratio), attr: d.attr, varH: d.varH };
}
check('三档抽屉高度都真实生效（peek/half/full 依次变高）',
  Math.abs(dwHeights.peek.got - dwHeights.peek.want) <= 12
  && Math.abs(dwHeights.half.got - dwHeights.half.want) <= 12
  && Math.abs(dwHeights.full.got - dwHeights.full.want) <= 12,
  `peek ${dwHeights.peek.got}/${dwHeights.peek.want}、half ${dwHeights.half.got}/${dwHeights.half.want}、full ${dwHeights.full.got}/${dwHeights.full.want}`);

// 真实拖拽：从 peek 慢慢往上拖 → 跟手变高，松手吸附到 full
//
// ⚠️ 两个坑，都踩过：
//   a) 距离要够。拖 300px 只会落到 half —— 486px 离 half 的 422 更近。
//      这是"吸附到最近一档"的正确行为，不是 bug，别把距离给少了。
//   b) **必须带真实时间间隔**。若把 pointermove 全在一个同步循环里发完，
//      540px 会在 1ms 内走完，算出的速度高达 540px/ms —— 而 onUp 里
//      "速度 > 0.5px/ms 就算轻扫"的分支会把它当成 flick，
//      于是只前进一档（peek→half），断言就永远等不到 full。
//      真实手指每帧移动几十像素、间隔约 16ms，速度量级是 1~5px/ms，
//      所以这里用 40px / 100ms（0.4px/ms）模拟"刻意慢慢拖到位"。
//      想测"轻扫换档"请用下面那个 flick 用例，别混在一起。
//
//      这里可以放心用 setTimeout：本环境里它被节流到约 180ms，
//      只会让拖动**更慢**，而"更慢"正是本用例想要的（越慢越不会误判成轻扫），
//      所以节流在这是安全的。反过来需要"更快"的 flick 用例就不能用它了。
const drag = await mob.evaluate(async () => {
  const grip = document.getElementById('panel-grip');
  const panel = document.getElementById('panel');
  window.__api.setDrawer('peek');
  await new Promise((r) => setTimeout(r, 400));

  const before = Math.round(panel.getBoundingClientRect().height);
  const r = grip.getBoundingClientRect();
  const x = r.left + r.width / 2, y0 = r.top + r.height / 2;
  const mk = (t, y) => new PointerEvent(t, {
    pointerId: 71, pointerType: 'touch', isPrimary: true, bubbles: true,
    cancelable: true, button: 0, clientX: x, clientY: y,
  });

  grip.dispatchEvent(mk('pointerdown', y0));
  const steps = 13, step = 40;
  for (let i = 1; i <= steps; i++) {
    grip.dispatchEvent(mk('pointermove', y0 - i * step));
    await new Promise((r) => setTimeout(r, 100));   // 慢拖：约 0.4px/ms，低于轻扫阈值
  }
  const during = Math.round(panel.getBoundingClientRect().height);
  const dragging = panel.classList.contains('drawer-dragging');
  grip.dispatchEvent(mk('pointerup', y0 - steps * step));
  await new Promise((r) => setTimeout(r, 450));

  return { before, during, dragging, level: window.__api.getDrawer() };
});
check('拖拽把手时面板实时跟手变高（不是抬手才动）',
  drag.during > drag.before + 250,
  `${drag.before}px → ${drag.during}px`);
check('拖拽过程中关掉高度过渡（否则手感像拉橡皮筋）',
  drag.dragging === true);
check('慢慢拖到位松手 → 吸附到 full 档（不是停在半路）',
  drag.level === 'full', `level=${drag.level}，拖到 ${drag.during}px`);

// 轻扫换档：从 full 快速下滑 → 到相邻的 half，不用精确拖到位置
//
// ⚠️ 这里**不能用 setTimeout 控制节奏**（实测踩坑）：
// 页面里跑着 WebGL 渲染循环，后台/无头环境下 setTimeout 会被节流 ——
// 写 `setTimeout(8)` 实测每步真实耗时约 **180ms**，
// 于是"快速轻扫"变成了 0.12px/ms 的慢拖，根本触发不了 flick 分支，
// 面板按"吸附到最近一档"停回 full，断言永远失败。
// 改用**忙等**拿精确时间：忙等不受节流影响，performance.now() 照常推进。
// 每步 30px / 20ms = 1.5px/ms，稳稳越过 0.5px/ms 的轻扫阈值。
const flick = await mob.evaluate(async () => {
  const grip = document.getElementById('panel-grip');
  const r = grip.getBoundingClientRect();
  const x = r.left + r.width / 2, y0 = r.top + r.height / 2;
  const mk = (t, y) => new PointerEvent(t, {
    pointerId: 72, pointerType: 'touch', isPrimary: true, bubbles: true,
    cancelable: true, button: 0, clientX: x, clientY: y,
  });
  const spin = (ms) => { const t = performance.now(); while (performance.now() - t < ms) { /* 精确等待 */ } };

  window.__api.setDrawer('full');
  await new Promise((r) => setTimeout(r, 450));

  grip.dispatchEvent(mk('pointerdown', y0));
  for (let i = 1; i <= 5; i++) {
    grip.dispatchEvent(mk('pointermove', y0 + i * 30));
    spin(20);
  }
  grip.dispatchEvent(mk('pointerup', y0 + 150));
  await new Promise((r) => setTimeout(r, 450));
  return window.__api.getDrawer();
});
check('快速下滑轻扫 → 直接换到相邻档（轻扫即换档）',
  flick === 'half', `level=${flick}`);

// 键盘可达：把手可聚焦，上下键换档（无障碍）
const kbDrawer = await mob.evaluate(async () => {
  const grip = document.getElementById('panel-grip');
  grip.focus();
  const focused = document.activeElement === grip;
  grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  return { focused, level: window.__api.getDrawer() };
});
check('把手可聚焦 + 方向键换档（键盘/读屏可用）',
  kbDrawer.focused === true && kbDrawer.level === 'peek',
  `focused=${kbDrawer.focused} level=${kbDrawer.level}`);

// 定位后抽屉该不该自动升起？——分两种情况，且方向**相反**，必须都锁住。
//
// 这是改造中最反直觉的一处，实测踩出来的：
//   单条命中（搜索自动定位）→ 面板**不该**升。主任务是"看清箱子在哪"，
//     没什么可挑的（面包屑 + 详情卡已说明是哪条），
//     把面板从 peek 推到 half 只会白吃掉一半屏幕。
//     实测过：升到 half 后 3D 舞台只剩 324/844 = **38%**，
//     比改造前的 76% 还差，正好撞在用户投诉的"3D 被挤成一条缝"上。
//   多条命中后**手动挑一条** → 面板**该**升。用户刚在列表里选了一条，
//     需要同时看见"我选的是哪条"和"它在哪"，half 才够用。
await mob.evaluate(() => { window.__api.setDrawer('peek'); });
await mob.evaluate(() => window.__api.search('FZ-SP-00001'));   // 单条命中
await mob.waitForTimeout(1600);
const single = await mob.evaluate(() => ({
  drawer: window.__diag.drawer(),
  stageH: Math.round(document.querySelector('.stage').getBoundingClientRect().height),
  viewportH: window.innerHeight,
  selVisible: !document.getElementById('selinfo').classList.contains('hidden'),
}));
// 断言两条，比单看百分比更能说明意图：
//   ① 舞台占屏 ≥55%（顶栏 98px + peek 228px 之后，剩下的都给 3D）
//   ② 舞台至少是面板的 2 倍高 —— 直接表达"3D 才是主角，面板只是配角"
check('单条命中（搜索自动定位）不把面板推高，3D 舞台仍是主角',
  single.drawer.level === 'peek' && single.selVisible
  && single.stageH / single.viewportH >= 0.55
  && single.stageH > single.drawer.height * 2,
  `level=${single.drawer.level} 详情卡=${single.selVisible} stage=${single.stageH}/${single.viewportH} = ${(single.stageH / single.viewportH * 100).toFixed(0)}%，面板 ${single.drawer.height}px（舞台是它的 ${(single.stageH / single.drawer.height).toFixed(1)} 倍）`);

// 多条命中：搜「杯子」（数据里命中 2 条）→ 自动进地图 → 在列表里挑一条 → 抽屉升到 half
// 注意别用「电池」：它在演示数据里只命中 1 条，会走"单条自动定位"那条路，
// 用例名写着"多条"却测了单条，白测。（踩过）
await mob.evaluate(() => window.__api.reset());
await mob.waitForTimeout(1300);
await mob.evaluate(() => window.__api.search('杯子'));
await mob.waitForTimeout(1600);
const multi = await mob.evaluate(() => ({
  cards: window.__diag.cardCount(),
  mapMode: window.__diag.mapMode(),
}));
check('多条命中会自动进地图，并把候选都列出来',
  multi.cards > 1 && multi.mapMode === true,
  `卡片数=${multi.cards} mapMode=${multi.mapMode}`);

// 点列表里的第一条（等价于用户从多个候选里挑了一个）
await mob.evaluate(() => {
  const card = document.querySelector('#results .result-item.is-card');
  card?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await mob.waitForTimeout(1500);
const picked = await mob.evaluate(() => ({
  drawer: window.__diag.drawer(),
  mapMode: window.__diag.mapMode(),
  hi: window.__diag.highlight(),
}));
check('从多条候选里挑一条后，抽屉升到 half（选中的那条看得见）',
  picked.drawer.level === 'half' && picked.mapMode === false,
  `level=${picked.drawer.level} height=${picked.drawer.height} mapMode=${picked.mapMode}`);

// 地图模式下抽屉被硬压到 168px：进地图时列表本来就该让位
await mob.evaluate(() => window.__api.enterMap());
await mob.waitForTimeout(700);
const mapDrawer = await mob.evaluate(() => window.__diag.drawer());
check('地图模式下面板压到 168px 且把手收起（拖了也没意义）',
  Math.abs(mapDrawer.height - 168) <= 12 && mapDrawer.gripVisible === false,
  `height=${mapDrawer.height} grip=${mapDrawer.gripVisible}`);
await mob.evaluate(() => window.__api.exitMap());
await mob.waitForTimeout(700);
await mob.evaluate(() => window.__api.setDrawer('peek'));
await mob.waitForTimeout(400);

check('手机端全程无报错', mErr.length === 0, mErr.slice(0, 3).join(' | '));

// 手机页用完就关：它一直开着会占住一个 WebGL 上下文和一条 rAF 循环，
// 后面还要开桌面页和横屏页，累积起来会让新页面加载变慢甚至超时（实测遇到过）。
await mob.close();

// =====================================================================
// B. 桌面端：确认没被改坏
// =====================================================================
const desk = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const dErr = [];
desk.on('pageerror', (e) => dErr.push(String(e)));
desk.on('console', (m) => { if (m.type() === 'error') dErr.push(m.text()); });

await desk.goto(BASE, { waitUntil: 'load' });
await desk.waitForFunction(() => window.__diag && window.__diag.ready === true, { timeout: 15000 });

const dOverview = await desk.evaluate(() => window.__diag.mapRadius());
check('宽屏全景距离保持基准 52', Math.abs(dOverview - 52) < 2, `radius=${dOverview.toFixed(1)}`);

await desk.fill('#search', 'FZ-SP-00001');
await desk.press('#search', 'Enter');
await desk.waitForTimeout(1300);
const dState = await desk.evaluate(() => ({
  hi: window.__diag.highlight(),
  selVisible: !document.getElementById('selinfo').classList.contains('hidden'),
  selCollapsed: document.getElementById('selinfo').classList.contains('collapsed'),
}));
check('桌面端搜索定位仍正常', dState.hi && dState.hi.outline === 1, JSON.stringify(dState.hi));
check('桌面端详情卡也默认收起', dState.selVisible && dState.selCollapsed);

// 桌面端点"地图"按钮
await tapAt(desk, '#btn-map');
await desk.waitForTimeout(900);
const dMap = await desk.evaluate(() => ({
  mapMode: window.__diag.mapMode(),
  bounds: window.__diag.mapBounds(),
}));
check('桌面端点「地图」按钮进入地图', dMap.mapMode === true);
check('桌面端地图视野可见半宽足够装下 A~C',
  dMap.bounds.right / dMap.bounds.zoom >= 25,
  `可见半宽 ${(dMap.bounds.right / dMap.bounds.zoom).toFixed(1)}（需 ≥25）`);

await tapAt(desk, '#btn-map');
await desk.waitForTimeout(900);
check('再点一次退出地图', (await desk.evaluate(() => window.__diag.mapMode())) === false);

check('桌面端全程无报错', dErr.length === 0, dErr.slice(0, 3).join(' | '));

// =====================================================================
// H. 结果面板四态（加载中 / 出错 / 空 / 有结果）
// ---------------------------------------------------------------------
// 为什么要专门测这四态：加载态是"最容易不做"的一个 —— demo 模式读本地 JSON
// 快得看不见它，于是很自然就不写了。但换成后端、或在慢手机上首次打开时，
// 它会真的露出来，那时如果显示的是**空态**的文案（"输入…开始定位"），
// 用户会以为页面已就绪、只是自己没输入，而实际数据还在路上。
//
// 这里不真去卡网络（那会让测试变慢且不稳），而是直接调 __api 切状态 ——
// 验证的是"四态各自渲染成什么"，这是渲染层该负责的部分。
// =====================================================================

// ---- H0. 先复位，再验证"数据就绪、还没搜索"的空态 ----
// 必须先 reset()：前面桌面端的用例点过「地图」、搜索过，面板里还留着结果。
// 不复位就断言"空态"，测的是上一个用例的残留状态，不是初始状态。
await desk.evaluate(() => window.__api.reset());
await desk.waitForTimeout(800);
const s0 = await desk.evaluate(() => ({
  state: window.__diag.panelState(),
  cards: window.__diag.cardCount(),
  loading: window.__diag.loading(),
}));
check('复位后面板回到空态（数据已就绪、不在加载中）',
  s0.state === 'empty' && s0.loading === false && s0.cards === 0,
  `state=${s0.state} loading=${s0.loading} cards=${s0.cards}`);

// ---- H1. 有结果：卡片数应等于命中数 ----
await desk.evaluate(() => window.__api.search('杯子'));
await desk.waitForTimeout(700);
const s1 = await desk.evaluate(() => ({
  state: window.__diag.panelState(),
  cards: window.__diag.cardCount(),
  firstCardIsButton: document.querySelector('#results .result-item.is-card')?.getAttribute('role') === 'button',
  firstCardTabIndex: document.querySelector('#results .result-item.is-card')?.tabIndex,
}));
check('搜到结果时渲染出物资卡片（数量 > 0）',
  s1.state === 'list' && s1.cards > 0,
  `state=${s1.state} 卡片数=${s1.cards}`);
check('卡片可被键盘操作（role=button + tabIndex=0）',
  s1.firstCardIsButton && s1.firstCardTabIndex === 0,
  `role=${s1.firstCardIsButton} tabIndex=${s1.firstCardTabIndex}`);

// ---- H2. 加载中：骨架 + 转圈，且不能是空态文案 ----
await desk.evaluate(() => window.__api.setLoading(true));
await desk.waitForTimeout(150);
const s2 = await desk.evaluate(() => ({
  state: window.__diag.panelState(),
  cards: window.__diag.cardCount(),
  skel: document.querySelectorAll('#results .result-item.skeleton').length,
  hintCls: document.querySelector('#results .hint')?.className || '',
  spin: !!document.querySelector('#results .hint-spinner'),
  role: document.querySelector('#results .hint')?.getAttribute('role'),
}));
check('加载态：显示加载提示而不是空态文案',
  s2.state === 'loading' && s2.hintCls.includes('hint-loading'),
  `state=${s2.state} hint="${s2.hintCls}"`);
check('加载态：渲染骨架占位块',
  s2.skel >= 1,
  `骨架块 ${s2.skel} 个`);
check('加载态：有转圈动画，且读屏角色为 status（不打断）',
  s2.spin && s2.role === 'status',
  `转圈=${s2.spin} role=${s2.role}`);
check('加载态下不显示任何物资卡片（避免显示过期数据）',
  s2.cards === 0,
  `卡片数=${s2.cards}`);

// ---- H3. 出错：暖红配色 + role=alert，且要和空态明确区分 ----
await desk.evaluate(() => { window.__api.setLoading(false); window.__api.setLoadError('网络异常，没能取到物资数据'); });
await desk.waitForTimeout(150);
const s3 = await desk.evaluate(() => {
  const h = document.querySelector('#results .hint');
  const bg = h ? getComputedStyle(h).backgroundColor : '';
  return {
    state: window.__diag.panelState(),
    hintCls: h?.className || '',
    role: h?.getAttribute('role'),
    bg,
    text: h?.textContent || '',
  };
});
check('出错态：role=alert（读屏会打断播报，因为这是异常）',
  s3.state === 'error' && s3.role === 'alert',
  `state=${s3.state} role=${s3.role}`);
check('出错态：配色与空态拉开差距（不是中性灰）',
  s3.hintCls.includes('hint-error') && s3.bg !== 'rgba(0, 0, 0, 0)',
  `class="${s3.hintCls}" bg=${s3.bg}`);
check('出错态：文案里带上具体原因，而不是只说"出错了"',
  s3.text.includes('网络异常'),
  `文案="${s3.text.slice(0, 50)}"`);

// ---- H4. 出错时搜索应说明"搜不了"，而不是伪装成"没搜到" ----
// 这是个真实缺陷回归锁：出错时 state.items 是空的，搜索必然返回 0 条，
// 若不拦一下就会显示「未找到"杯子"对应的物资」—— 用户会去改关键词反复重搜，
// 而真正的问题是数据根本没读出来。
await desk.evaluate(() => window.__api.search('杯子'));
await desk.waitForTimeout(500);
const s4 = await desk.evaluate(() => ({
  nohitTitle: document.getElementById('nohit-title')?.textContent || '',
  // 面板应保持错误态（错误信息比"没搜到"更接近真相）
  state: window.__diag.panelState(),
}));
check('数据出错时搜索提示"搜不了"而不是"没搜到"',
  s4.nohitTitle.includes('搜不了'),
  `提示标题="${s4.nohitTitle}"`);

// ---- H5. 清错误后能正常恢复（回归锁住 setLoadError(null) 的坑）----
// setLoadError(null) 走不通 —— 它内部 `msg || '数据读取失败。'` 会把 null 填成默认文案，
// 于是"清错误"变成"换成另一条错误"，页面卡在错误态出不来。所以专门有 clearLoadError()。
await desk.evaluate(() => { window.__api.clearLoadError(); window.__api.reset(); });
await desk.waitForTimeout(700);
await desk.evaluate(() => window.__api.search('杯子'));
await desk.waitForTimeout(700);
const s5 = await desk.evaluate(() => ({
  state: window.__diag.panelState(),
  cards: window.__diag.cardCount(),
}));
check('清掉错误后能恢复正常搜索（不会卡死在错误态）',
  s5.state === 'list' && s5.cards > 0,
  `state=${s5.state} 卡片数=${s5.cards}`);

// ---- H6. 组件抽取没有弄丢无障碍属性 ----
// 这条必须在**加载态下**查：加载结束后转圈元素已被移除，查不到是正常的，
// 拿"查不到"去断言等于什么都没测（上一版就写错了，写成恒真/恒假的死断言）。
await desk.evaluate(() => window.__api.setLoading(true));
await desk.waitForTimeout(150);
const a11y = await desk.evaluate(() => ({
  spinnerHidden: document.querySelector('#results .hint-spinner')?.getAttribute('aria-hidden'),
  skeletonHidden: document.querySelector('#results .result-item.skeleton')?.getAttribute('aria-hidden'),
  spinnerBg: (() => {
    const s = document.querySelector('#results .hint-spinner');
    return s ? getComputedStyle(s).animationName : '';
  })(),
}));
check('转圈与骨架都是纯装饰、对读屏隐藏（aria-hidden=true）',
  a11y.spinnerHidden === 'true' && a11y.skeletonHidden === 'true',
  `转圈 aria-hidden=${a11y.spinnerHidden}，骨架 aria-hidden=${a11y.skeletonHidden}`);
check('转圈真的在动（animationName 不是 none）',
  a11y.spinnerBg && a11y.spinnerBg !== 'none',
  `animation=${a11y.spinnerBg}`);

// 收尾：复位，别把测试状态留给后面
await desk.evaluate(() => { window.__api.setLoading(false); window.__api.clearLoadError(); window.__api.reset(); });
await desk.waitForTimeout(600);

// ---- H7. 地面标记环只在「有目标箱位」时出现 ----
// 这个环的语义是"目标在这里"。没有目标时它若可见，空地正中央就杵着一个红圈，
// 用户会当成错误提示（真机截图反馈过）。所以要锁死三态：初始藏、命中显、复位藏。
const markerAt = () => desk.evaluate(async () => {
  const st = await import('./src/state.js');
  const m = st.state.marker;
  return { visible: m?.visible, x: m?.position.x, z: m?.position.z, hi: st.state.highlightBoxId };
});

const m0 = await markerAt();
check('初始无目标时，地面标记环必须隐藏（空地中央不能有裸奔红圈）',
  m0.visible === false && m0.hi === null,
  `visible=${m0.visible} highlight=${m0.hi}`);

await desk.evaluate(() => window.__api.search('FZ-SP-00008'));
await desk.waitForTimeout(1400);
const m1 = await markerAt();
check('定位到单个箱位后，地面标记环现身且挪到目标脚下',
  m1.visible === true && m1.hi === 'A-03-02' && (m1.x !== 0 || m1.z !== 5),
  `visible=${m1.visible} pos=[${m1.x},${m1.z}] highlight=${m1.hi}`);

await desk.evaluate(() => window.__api.reset());
await desk.waitForTimeout(1400);
const m2 = await markerAt();
check('复位后标记环重新隐藏（不会留下无指代的红圈）',
  m2.visible === false && m2.hi === null,
  `visible=${m2.visible} highlight=${m2.hi}`);

await desk.screenshot({ path: 'verify/shots/shot-desktop-fixed.png' });

// 桌面端用完就关：一是回收 WebGL 上下文，二是下面横屏页要单独加载。
// （本地验收用的是 python -m http.server，**单线程**；
//   多个页面同时拉十几个 ES 模块会互相排队，曾经因此把页面加载卡到超时。
//   所以这里坚持"一个页面测完关掉，再开下一个"。）
await desk.close();

// =====================================================================
// C. 手机横屏：面板变右侧栏，不是底部抽屉
// =====================================================================
// 横屏是"纵向稀缺、横向富余"，所以换一种排法而不是把竖屏压扁：
// 底部面板挪到右侧变成一列，3D 独占左边整块，能拿到约 85% 的高度。
//
// ⚠️ **必须测多个宽度，只测 844 会漏掉真 bug**（实测踩过）：
// 抽屉规则原本写在 `@media (max-width: 820px)` 里，横屏写在
// `@media (orientation: landscape) and (max-height: 560px)` 里，
// 两者在 **740x360 这类机型上会同时命中**，而抽屉那条 `.panel[data-drawer]`
// 优先级更高，把横屏的 `height: 100%` 无声推翻 ——
// 面板高度掉回 40vh = 144px，只占右侧上半截，下面 167px 全空白；
// 连带 `.results` 被压到 48px，一条 119px 的结果卡完全显示不出来。
// 844 宽因为 > 820 不匹配抽屉那条，**完全正常** —— 只测 844 就永远发现不了。
// 所以这里固定跑三档宽度，其中 740 / 600 专门覆盖"重叠区间"。
const LAND_SIZES = [
  { w: 844, h: 390, tag: 'iPhone 横屏' },
  { w: 740, h: 360, tag: '小机横屏(≤820，重叠区间)' },
  { w: 600, h: 360, tag: '极窄横屏(≤600，还命中 map-mode 规则)' },
];

for (const size of LAND_SIZES) {
  const land = await browser.newPage({
    viewport: { width: size.w, height: size.h },
    hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  });
  const lErr = [];
  land.on('pageerror', (e) => lErr.push(String(e)));
  land.on('console', (m) => { if (m.type() === 'error') lErr.push(m.text()); });

  const tag = `${size.w}x${size.h}`;
  await land.goto(BASE, { waitUntil: 'load' });
  // 用 try 包住而不是让它抛：页面初始化失败时，
  // 我们要的是一条明确的 FAIL 和原因，而不是整个脚本崩掉、
  // 后面几十条断言一条都不跑（之前就是这样，很难定位）。
  let landReady = true;
  try {
    await land.waitForFunction(() => window.__diag && window.__diag.ready === true, { timeout: 25000 });
  } catch (e) {
    landReady = false;
    const why = await land.evaluate(
      () => (window.__diag ? JSON.stringify(window.__diag) : 'window.__diag 未挂载')
    ).catch(() => '连 evaluate 都失败（页面可能没加载出来）');
    check(`[${tag}] 横屏页面能正常初始化`, false,
      `等待超时：${why}；控制台报错=${lErr.slice(0, 2).join(' | ') || '无'}`);
  }
  if (landReady) await land.waitForTimeout(600);

  // 页面没起来就跳过这一组断言（上面已经报过 FAIL 了），
  // 免得在空页面上 evaluate 一堆 null 又炸一遍，掩盖真正的原因。
  if (landReady) {
    // 统一的量尺：把"关键区域的盒子"一次量全，后面复用
    const measure = () => land.evaluate(() => {
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width), l: Math.round(r.left) };
      };
      const si = document.getElementById('selinfo');
      const cards = [...document.querySelectorAll('#results .result-item.is-card')];
      return {
        topbar: box(document.querySelector('.topbar')),
        stage: box(document.querySelector('.stage')),
        panel: box(document.getElementById('panel')),
        results: box(document.getElementById('results')),
        selinfo: (si && !si.classList.contains('hidden')) ? box(si) : null,
        gripDisplay: getComputedStyle(document.getElementById('panel-grip')).display,
        drawerAttr: document.getElementById('panel').dataset.drawer,
        drawerVar: document.getElementById('panel').style.getPropertyValue('--drawer-h') || null,
        cards: cards.length,
        cardHs: cards.map((c) => Math.round(c.getBoundingClientRect().height)),
        innerH: window.innerHeight,
        innerW: window.innerWidth,
      };
    });

    const L0 = await measure();
    check(`[${tag}] 顶栏横跨整个宽度（不能只占左半边，否则看着像被劈成两块）`,
      Math.abs(L0.topbar.w - L0.innerW) <= 2,
      `顶栏宽=${L0.topbar.w}，视口宽=${L0.innerW}`);
    // 列表在右、3D 在左：与**桌面端**保持一致（桌面基础层就是 1fr 340px），
    // 同一产品不因为换设备就把列表翻到另一侧。
    // 判据：面板左沿必须落在右半边，且正好接在 3D 舞台的右沿上。
    check(`[${tag}] 结果列表在右、3D 在左（与桌面端一致）`,
      L0.panel.l >= L0.innerW * 0.5 && Math.abs(L0.panel.l - L0.stage.w) <= 2,
      `3D 宽=${L0.stage.w}，面板 left=${L0.panel.l}（宽${L0.panel.w}），视口宽=${L0.innerW}`);
    check(`[${tag}] 面板占满整列高度（顶栏下沿→屏幕底，不留白）`,
      Math.abs(L0.panel.t - L0.topbar.b) <= 2
      && Math.abs(L0.panel.b - L0.innerH) <= 2
      && L0.panel.h >= L0.innerH * 0.75,
      `面板 ${L0.panel.t}~${L0.panel.b} h${L0.panel.h}，顶栏下沿=${L0.topbar.b}，视口高=${L0.innerH}`);
    // 收窄后的下限是 clamp 的 184px（用户要求"侧栏窄一点，把地方让给 3D"）。
    // 这里守 180px：再窄下去卡片会被挤到几乎只剩标题、信息看不全。
    check(`[${tag}] 侧栏不至于窄到放不下卡片（≥180px）`,
      L0.panel.w >= 180, `面板宽=${L0.panel.w}`);
    check(`[${tag}] 把手隐藏、抽屉变量清空（侧栏没有抽屉形态）`,
      L0.gripDisplay === 'none' && L0.drawerAttr === 'off' && L0.drawerVar === null,
      `grip=${L0.gripDisplay} attr=${L0.drawerAttr} var=${L0.drawerVar}`);
    check(`[${tag}] 3D 舞台拿到绝大部分高度（≥80%）`,
      L0.stage.h / L0.innerH >= 0.8,
      `stage=${L0.stage.h}/${L0.innerH} = ${(L0.stage.h / L0.innerH * 100).toFixed(0)}%`);

    // ---- 搜多条 → 自动进地图 → 从列表里挑一条 → 回 3D ----
    // 这一段是核心回归：点击前后**面板高度必须不变**，且列表要仍然装得下结果卡。
    await land.evaluate(() => window.__api.search('杯子'));
    await land.waitForTimeout(1700);
    const L1 = await measure();
    check(`[${tag}] 多条命中自动进地图，候选都列出来`,
      L1.cards > 1 && Math.abs(L1.panel.h - L0.panel.h) <= 2,
      `卡片数=${L1.cards}，面板高=${L1.panel.h}（应保持 ${L0.panel.h}）`);

    await land.evaluate(() => {
      document.querySelector('#results .result-item.is-card')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await land.waitForTimeout(1700);
    const L2 = await measure();
    check(`[${tag}] 点结果回 3D 后面板高度不变（不会被内容顶矮留出空白）`,
      Math.abs(L2.panel.h - L0.panel.h) <= 2,
      `点击前 ${L1.panel.h}px → 点击后 ${L2.panel.h}px`);
    check(`[${tag}] 点结果回 3D 后列表仍能完整看到一条结果（可操作空间没被挤没）`,
      L2.results.h >= Math.max(...L2.cardHs),
      `列表可视高=${L2.results.h}px，单张卡片高=${Math.max(...L2.cardHs)}px，详情卡=${L2.selinfo ? L2.selinfo.h + 'px' : '无'}`);
    check(`[${tag}] 横屏下搜索定位仍正常，且不会误写抽屉变量`,
      L2.drawerAttr === 'off' && L2.results.h > 100,
      `attr=${L2.drawerAttr} 列表高=${L2.results.h}`);

    await land.screenshot({ path: `verify/shots/shot-landscape-${size.w}.png` });
  }
  check(`[${tag}] 横屏全程无报错`, lErr.length === 0, lErr.slice(0, 3).join(' | '));
  await land.close();
}

await browser.close();

// ---- 汇总 ----
const failed = results.filter((r) => !r.pass);
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  - ' + f.name + (f.detail ? '  → ' + f.detail : '')));
  process.exit(1);
}
