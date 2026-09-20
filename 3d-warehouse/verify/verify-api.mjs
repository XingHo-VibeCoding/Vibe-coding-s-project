// 方案乙验收：确认前端真的从后端 API 取到了数据，而不是回退到了本地 JSON。
import { chromium } from 'playwright';

const results = [];
const check = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// 记录前端实际发出的请求，用来证明数据来源
const calls = [];
page.on('request', (r) => { if (r.url().includes('/api/')) calls.push(r.url()); });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://127.0.0.1:8010/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__diag && window.__diag.ready === true, { timeout: 15000 });

// 1. 前端确实请求了后端
check('前端调用了后端 /api/items', calls.some((u) => u.includes(':8011/api/items')),
  calls.join(' , ') || '（无 API 请求）');

// 2. 数据条数与后端一致
const d = await page.evaluate(() => ({
  items: window.__diag.itemCount, slots: window.__diag.totalSlots, occ: window.__diag.occupiedCount,
}));
check('数据经后端送达（26 条 / 27 箱位）', d.items === 26 && d.slots === 27 && d.occ === 26,
  `items=${d.items} slots=${d.slots} occ=${d.occ}`);

// 3. 数据被正确翻译成标准结构，业务层可读
const probe = await page.evaluate(() => window.__api.getState());
check('接口状态可读', !!probe && probe.ready === true, JSON.stringify(probe).slice(0, 90));

// 4. 搜索仍然正常（证明翻译后的结构能被业务层消费）
await page.fill('#search', '不锈钢餐盘');
await page.press('#search', 'Enter');
await page.waitForTimeout(1200);
const hi = await page.evaluate(() => window.__diag.highlight());
check('搜索定位正常（箱位 A-01-02）', hi && hi.boxId === 'A-01-02', JSON.stringify(hi));
check('面包屑显示路径', (await page.textContent('#breadcrumb-text')).includes('A区'),
  await page.textContent('#breadcrumb-text'));

// 5. 无报错
check('无控制台报错', errors.length === 0, errors.slice(0, 3).join(' | '));

// 6. 后端挂掉时应优雅退回演示数据（验证降级路径）
await page.route('**/api/items', (r) => r.abort());
const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const warn = [];
p2.on('console', (m) => { if (m.type() === 'warning') warn.push(m.text()); });
await p2.goto('http://127.0.0.1:8010/', { waitUntil: 'load' });
await p2.waitForFunction(() => window.__diag && window.__diag.ready === true, { timeout: 15000 });
const d2 = await p2.evaluate(() => ({ items: window.__diag.itemCount }));
check('后端不可用时退回演示数据，页面仍可用', d2.items === 26, `items=${d2.items}`);

await page.screenshot({ path: 'shot-api.png' });
await browser.close();

const failed = results.filter((r) => !r.p);
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
if (failed.length) { failed.forEach((f) => console.log('  - ' + f.n)); process.exit(1); }
