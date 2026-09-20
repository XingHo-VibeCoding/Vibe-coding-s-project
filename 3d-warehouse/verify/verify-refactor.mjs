// 重构验收脚本：用真浏览器跑一遍核心功能，确认行为与重构前一致。
// 运行：NODE_PATH=<workspace>/node_modules node verify-refactor.mjs
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8010/';
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// 收集控制台错误（模块解析失败、循环依赖都会在这里暴露）
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__diag && window.__diag.ready === true, { timeout: 15000 });

// ---- 1. 启动与场景构建 ----
const diag = await page.evaluate(() => ({
  slots: window.__diag.totalSlots,
  occupied: window.__diag.occupiedCount,
  items: window.__diag.itemCount,
  camera: window.__diag.cameraPos(),
}));
check('场景构建：箱位 / 占用 / 数据条数', diag.slots === 27 && diag.occupied === 26 && diag.items === 26,
  `slots=${diag.slots} occupied=${diag.occupied} items=${diag.items}`);
check('主相机已摆位', Array.isArray(diag.camera) && diag.camera.length === 3, JSON.stringify(diag.camera));

// ---- 2. 编号精确搜索 + 高亮 ----
await page.fill('#search', 'FZ-SP-00001');
await page.press('#search', 'Enter');
await page.waitForTimeout(1200);
let st = await page.evaluate(() => window.__api.getState());
const hi1 = await page.evaluate(() => window.__diag.highlight());
check('编号搜索命中并高亮', st.highlightBoxId === 'A-01-02' && hi1 && hi1.outline === 1,
  `boxId=${st.highlightBoxId} outline=${hi1 ? hi1.outline : 'null'}`);
check('面包屑可见', await page.isVisible('#breadcrumb'), await page.textContent('#breadcrumb-text'));
check('详情卡可见', await page.isVisible('#selinfo'));
check('结果数 = 1', (await page.textContent('#result-count')) === '1');

// ---- 3. 名称模糊搜索（多结果，不自动定位） ----
await page.fill('#search', '餐');
await page.press('#search', 'Enter');
await page.waitForTimeout(900);
const multi = await page.evaluate(() => ({
  count: document.getElementById('result-count').textContent,
  items: document.querySelectorAll('.result-item').length,
}));
check('名称模糊搜索返回列表', +multi.count >= 2 && multi.items === +multi.count, `count=${multi.count}`);

// ---- 4. 点击列表项定位 ----
await page.click('.result-item');
await page.waitForTimeout(1100);
st = await page.evaluate(() => window.__api.getState());
check('点击结果项触发定位', !!st.highlightBoxId, `boxId=${st.highlightBoxId}`);
check('结果项 active 样式生效', (await page.locator('.result-item.active').count()) === 1);

// ---- 5. 空结果提示 ----
await page.fill('#search', 'zzz不存在的物资');
await page.press('#search', 'Enter');
await page.waitForTimeout(700);
const nohit = await page.evaluate(() => ({
  visible: !document.getElementById('nohit').classList.contains('hidden'),
  nohit: window.__diag.nohit(),
  title: document.getElementById('nohit-title').textContent,
}));
check('空结果提示出现', nohit.visible && nohit.nohit === true, nohit.title);

// ---- 6. 区域搜索 ----
await page.fill('#search', 'B区');
await page.press('#search', 'Enter');
await page.waitForTimeout(800);
const zoneCount = +(await page.textContent('#result-count'));
check('区域搜索 B区', zoneCount > 0, `命中 ${zoneCount} 条`);

// ---- 7. 排号搜索 A1 ----
await page.fill('#search', 'A1');
await page.press('#search', 'Enter');
await page.waitForTimeout(800);
check('排号搜索 A1', +(await page.textContent('#result-count')) > 0, `命中 ${await page.textContent('#result-count')} 条`);

// ---- 8. 复位（按钮 + R 键） ----
const beforeReset = await page.evaluate(() => window.__diag.target());
await page.click('#btn-reset');
await page.waitForTimeout(1200);
st = await page.evaluate(() => window.__api.getState());
check('复位清空高亮与提示', st.highlightBoxId === null && st.nohit === false,
  `highlight=${st.highlightBoxId} nohit=${st.nohit}`);
check('复位后搜索框清空', (await page.inputValue('#search')) === '');
check('复位后面包屑隐藏', !(await page.isVisible('#breadcrumb')));

await page.evaluate(() => window.__api.locateById('FZ-SP-00001'));
await page.waitForTimeout(1000);
await page.keyboard.press('r');
await page.waitForTimeout(1200);
check('R 键复位', (await page.evaluate(() => window.__api.getState())).highlightBoxId === null);

// ---- 9. 鼠标交互：拖拽旋转 / 滚轮缩放 ----
await page.evaluate(() => window.__api.reset());
await page.waitForTimeout(1200);
const cam0 = await page.evaluate(() => window.__diag.cameraPos());
await page.mouse.move(640, 400);
await page.mouse.down();
await page.mouse.move(820, 400, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(400);
const cam1 = await page.evaluate(() => window.__diag.cameraPos());
check('拖拽旋转改变相机位置', JSON.stringify(cam0) !== JSON.stringify(cam1),
  `${JSON.stringify(cam0)} → ${JSON.stringify(cam1)}`);

await page.mouse.move(640, 400);
await page.mouse.wheel(0, -400);
await page.waitForTimeout(400);
const cam2 = await page.evaluate(() => window.__diag.cameraPos());
check('滚轮缩放改变相机距离', JSON.stringify(cam1) !== JSON.stringify(cam2));

// ---- 10. 渲染无异常 ----
check('无控制台报错', errors.length === 0, errors.slice(0, 3).join(' | '));

// ---- 11. 手机端适配（390x844） ----
const mobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true, isMobile: true, deviceScaleFactor: 3,
});
const mErrors = [];
mobile.on('pageerror', (e) => mErrors.push(String(e)));
await mobile.goto(BASE, { waitUntil: 'load' });
await mobile.waitForFunction(() => window.__diag && window.__diag.ready === true, { timeout: 15000 });

const inputH = await mobile.evaluate(() => {
  const r = document.getElementById('search').getBoundingClientRect();
  return { h: Math.round(r.height), fs: getComputedStyle(document.getElementById('search')).fontSize };
});
check('手机端输入框高度 ≥44px 且字号 16px', inputH.h >= 44 && inputH.fs === '16px',
  `h=${inputH.h}px fs=${inputH.fs}`);

await mobile.fill('#search', '餐盘');
await mobile.press('#search', 'Enter');
await mobile.waitForTimeout(1200);
check('手机端搜索可用', !!(await mobile.evaluate(() => window.__diag.highlight())),
  JSON.stringify(await mobile.evaluate(() => window.__diag.highlight())));
check('手机端无报错', mErrors.length === 0, mErrors.slice(0, 2).join(' | '));

await page.screenshot({ path: 'shot-desktop.png' });
await mobile.screenshot({ path: 'shot-mobile.png' });

await browser.close();

// ---- 汇总 ----
const failed = results.filter((r) => !r.pass);
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  - ' + f.name + (f.detail ? '  → ' + f.detail : '')));
  process.exit(1);
}
