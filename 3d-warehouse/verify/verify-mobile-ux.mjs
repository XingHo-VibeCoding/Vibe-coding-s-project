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
// 三个坑，都踩过了：
//   a) CDP 的 dispatchTouchEvent 会把连续 touchMove 合并（发 10 个只到 2 个），测不准；
//   b) 视角监听器绑在 #canvas-host 里的 <canvas> 上（见 main.js 的 initControls），
//      事件必须派发给 canvas 本身，派给外层 div 是到不了的；
//   c) **必须用有符号位移**，不能取绝对值。初始 theta=0.62，触摸滑 100px 转 -1.1，
//      落到 -0.48；这里 0.62 就在 ±π 边界附近，取绝对值会把 -0.48 折成 0.48，
//      看起来"和鼠标的 0.5 一样"，恰好把 2.2 倍的差距抹平 —— 曾经因此误判成失败。
//      （camera.js 的 rotateBy 现已把 theta 归一化到 (-π, π]，数值不会无限漂。）
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
    window.dispatchEvent(mk('pointerup', 100 + px));
    await new Promise((r) => setTimeout(r, 250));

    // 返回"偏航角的有符号变化量"，这是灵敏度系数唯一直接作用的对象
    return +(st.view.theta - theta0).toFixed(4);
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
  for (let i = 1; i <= 5; i++) canvas.dispatchEvent(mk('pointermove', 100 + i * 10));
  window.dispatchEvent(mk('pointerup', 150));

  await new Promise((r) => setTimeout(r, 400)); // 超过动画剩余时长，确认没被"拉回去"
  return {
    animatingBefore,
    animatingAfter: cam.isAnimating(),
    delta: +(st.view.theta - t0).toFixed(4),
  };
});
check('飞行途中拖动会中断动画（不会被动画覆盖回去）',
  interrupt.animatingBefore && !interrupt.animatingAfter && Math.abs(interrupt.delta) > 0.2,
  `动画中=${interrupt.animatingBefore} → 拖动后=${interrupt.animatingAfter}，theta 变化 ${interrupt.delta} rad`);

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
  stageH: Math.round(document.querySelector('.stage').getBoundingClientRect().height),
  viewportH: window.innerHeight,
}));
check('单条命中详情卡可见', selState.visible);
check('详情卡默认是收起状态', selState.collapsed && selState.expanded === false,
  `collapsed=${selState.collapsed} toggle="${selState.toggleTxt}"`);
check('收起时详情主体不占空间', selState.bodyDisplay === 'none', `display=${selState.bodyDisplay}`);
check('收起后 3D 舞台占屏超过 45%', selState.stageH / selState.viewportH > 0.45,
  `stage=${selState.stageH}px / viewport=${selState.viewportH}px = ${(selState.stageH / selState.viewportH * 100).toFixed(1)}%`);

await mob.screenshot({ path: 'shot-m-fixed-detail.png' });

// 点标题行展开
await mob.click('#selinfo-head');
await mob.waitForTimeout(400);
const afterExpand = await mob.evaluate(() => ({
  expanded: window.__diag.selExpanded(),
  toggleTxt: document.getElementById('selinfo-toggle').textContent,
  bodyDisplay: getComputedStyle(document.getElementById('selinfo-body')).display,
  panelH: Math.round(document.getElementById('panel').getBoundingClientRect().height),
}));
check('点标题行可展开详情', afterExpand.expanded === true && afterExpand.bodyDisplay !== 'none',
  `toggle="${afterExpand.toggleTxt}"`);
check('展开后面板变高（说明折叠确实省了空间）', afterExpand.panelH > selState.panelH,
  `收起 ${selState.panelH}px → 展开 ${afterExpand.panelH}px`);

// 再点一次收起
await mob.click('#selinfo-head');
await mob.waitForTimeout(300);
check('再点一次可收回', (await mob.evaluate(() => window.__diag.selExpanded())) === false);

// 重新搜索应重置为收起
await mob.click('#selinfo-head');
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

await mob.screenshot({ path: 'shot-m-fixed-multi.png' });

// 点列表里的一条 → 应退出地图并聚焦
await mob.click('.result-item');
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

await mob.click('#breadcrumb');
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
check('地图下结果面板压到最矮（让出画面）', inMap.panelH <= 100,
  `地图下面板 ${inMap.panelH}px（非地图时 ${selState.panelH}px）`);
check('竖屏地图横向视野足够装下 A~C 三区', inMap.bounds.right >= 30
  && inMap.bounds.right / inMap.bounds.zoom >= 25,
  `${JSON.stringify(inMap.bounds)} → 可见半宽 ${(inMap.bounds.right / inMap.bounds.zoom).toFixed(1)}（需 ≥25）`);

await mob.screenshot({ path: 'shot-m-fixed-map.png' });

// 再点一次面包屑 → 退出地图
await mob.click('#breadcrumb');
await mob.waitForTimeout(900);
const outMap = await mob.evaluate(() => ({
  mapMode: window.__diag.mapMode(),
  btnTxt: document.querySelector('#btn-map span').textContent,
}));
check('再点面包屑退出地图并还原文字',
  outMap.mapMode === false && outMap.btnTxt === '地图',
  `mapMode=${outMap.mapMode} btn="${outMap.btnTxt}"`);

// ---- 4. 地图点选：重新进地图，点右侧应飞到 C 区 ----
await mob.click('#btn-map');
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

// ---- 4b. 地图上直接点中货架 → 应定位到那一排（层由 3D 呈现） ----
// 说明：俯视时同一排三层箱子垂直重叠，射线必然只打到最上面那层，
//       所以"点箱位"只能确定到排。这里断言落点在 C-03 这一排。
await mob.click('#btn-map');
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
await mob.click('#btn-map');
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

await mob.click('#breadcrumb');
await mob.waitForTimeout(800);

// ---- 6. 全景自适应：竖屏距离要大于固定 52 ----
const overviewRadius = await mob.evaluate(() => window.__diag.mapRadius());
check('竖屏全景距离自适应 > 52', overviewRadius > 52, `radius=${overviewRadius.toFixed(1)}`);

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

check('手机端全程无报错', mErr.length === 0, mErr.slice(0, 3).join(' | '));

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
await desk.click('#btn-map');
await desk.waitForTimeout(900);
const dMap = await desk.evaluate(() => ({
  mapMode: window.__diag.mapMode(),
  bounds: window.__diag.mapBounds(),
}));
check('桌面端点「地图」按钮进入地图', dMap.mapMode === true);
check('桌面端地图视野可见半宽足够装下 A~C',
  dMap.bounds.right / dMap.bounds.zoom >= 25,
  `可见半宽 ${(dMap.bounds.right / dMap.bounds.zoom).toFixed(1)}（需 ≥25）`);

await desk.click('#btn-map');
await desk.waitForTimeout(900);
check('再点一次退出地图', (await desk.evaluate(() => window.__diag.mapMode())) === false);

check('桌面端全程无报错', dErr.length === 0, dErr.slice(0, 3).join(' | '));

await desk.screenshot({ path: 'shot-desktop-fixed.png' });

await browser.close();

// ---- 汇总 ----
const failed = results.filter((r) => !r.pass);
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  - ' + f.name + (f.detail ? '  → ' + f.detail : '')));
  process.exit(1);
}
