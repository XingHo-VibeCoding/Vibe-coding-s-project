// WCAG 2.1 相对亮度 / 对比度复算脚本
function srgbToLin(c) {
  c = c / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function lum(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}
function ratio(fg, bg) {
  const l1 = lum(fg), l2 = lum(bg);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
const r = (a, b) => ratio(a, b).toFixed(2);

console.log('=== 现状复算 ===');
const bg = '#eceff3', panel = '#ffffff', accentSoft = '#e6eef5', miniHead = '#f6f9fc';
const muted = '#6b7785', highlight = '#e8543b', ink = '#1f2933', accent = '#2f6f9f';
console.log('muted/accent-soft :', r(muted, accentSoft));
console.log('muted/bg          :', r(muted, bg));
console.log('muted/#f6f9fc     :', r(muted, miniHead));
console.log('muted/panel(白)   :', r(muted, panel));
console.log('highlight/白      :', r(highlight, panel));
console.log('ink/白            :', r(ink, panel));
console.log('accent/白         :', r(accent, panel));
console.log('topbar-ink/topbar :', r('#e8edf3', '#222e3a'));

console.log('\n=== 背景亮度排序（越亮越有利）===');
[['#ffffff', panel], ['#f6f9fc', miniHead], ['#eceff3', bg], ['#e6eef5', accentSoft]].forEach(
  ([n, c]) => console.log(n, lum(c).toFixed(4))
);

console.log('\n=== --muted 候选（需同时过 accent-soft ≥4.5）===');
['#6b7785', '#667380', '#626f7c', '#5f6b78', '#5c6874', '#596572', '#56626e', '#5a6673', '#5b6774'].forEach(
  (c) => {
    console.log(
      c,
      'accent-soft', r(c, accentSoft),
      '| bg', r(c, bg),
      '| #f6f9fc', r(c, miniHead),
      '| 白', r(c, panel),
      '| vs ink 层次', r(c, ink)
    );
  }
);

console.log('\n=== --highlight 候选（白底文字/图标）===');
['#e8543b', '#d94a2f', '#cf4426', '#c8401f', '#c0392b', '#c2410c', '#b83b1f', '#cc4020'].forEach((c) => {
  console.log(c, '白底', r(c, panel), '| highlight-soft 底', r(c, '#fdeae6'), '| topbar底', r(c, '#222e3a'));
});

console.log('\n=== 其他关键对 ===');
console.log('tagInk #b06a00 / tagBg #fbf2dd :', r('#b06a00', '#fbf2dd'));
console.log('errorInk #8f3320 / #fdeae6    :', r('#8f3320', '#fdeae6'));
console.log('accentInk #235a82 / accent-soft:', r('#235a82', accentSoft));
console.log('brand-sub #9fb0c0 / topbar    :', r('#9fb0c0', '#222e3a'));
console.log('search placeholder #9fb0c0/#2c3a48:', r('#9fb0c0', '#2c3a48'));
console.log('hint-bar muted / #f5f7f9      :', r(muted, '#f5f7f9'));
console.log('demo-flag #ffd28a / #3a3018   :', r('#ffd28a', '#3a3018'));
