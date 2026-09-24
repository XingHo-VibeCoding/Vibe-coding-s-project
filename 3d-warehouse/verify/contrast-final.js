function srgbToLin(c){c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
function lum(hex){const h=hex.replace('#','');const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);return 0.2126*srgbToLin(r)+0.7152*srgbToLin(g)+0.0722*srgbToLin(b);}
function ratio(a,b){const l1=lum(a),l2=lum(b),hi=Math.max(l1,l2),lo=Math.min(l1,l2);return (hi+0.05)/(lo+0.05);}
const r=(a,b)=>ratio(a,b).toFixed(2);

console.log('=== 最终 --muted = #5c6874 全场景复算 ===');
const M='#5c6874';
[['--accent-soft','#e6eef5'],['--bg','#eceff3'],['#f6f9fc 小地图头','#f6f9fc'],['--panel 白','#ffffff'],
 ['#f7f9fb selinfo','#f7f9fb'],['#f5f7f9 hint-bar 等效','#f5f7f9'],['#f4f7fa 加载底','#f4f7fa'],['--highlight-soft','#fdeae6']]
 .forEach(([n,c])=>console.log(n.padEnd(22), r(M,c)));

console.log('\n=== 备选 --muted 供取舍 ===');
['#5f6b78','#5c6874','#5a6673','#596572'].forEach(c=>console.log(c,'worst(accent-soft)',r(c,'#e6eef5'),'| vs ink 层次',r(c,'#1f2933')));

console.log('\n=== --highlight-ink 候选（文字/图标，白底≥4.5）===');
['#c8401f','#c0392b','#c2410c','#b83b1f'].forEach(c=>console.log(c,'白',r(c,'#ffffff'),'| highlight-soft',r(c,'#fdeae6'),'| bg',r(c,'#eceff3')));

console.log('\n=== 额外发现：标签文字 --tagInk #b06a00 on #fbf2dd ===');
console.log('现状', r('#b06a00','#fbf2dd'), '（11px 小字，需 ≥4.5 → 不合格）');
['#8a5200','#8f5600','#945700','#7d4a00','#804d00'].forEach(c=>console.log(c,'on tagBg', r(c,'#fbf2dd'),'| on 白', r(c,'#ffffff')));

console.log('\n=== 3D 高亮/中性 语义色 与 topbar 底对照 ===');
console.log('accent-ink #235a82 / accent-soft :', r('#235a82','#e6eef5'));
console.log('errorInk #8f3320 / highlight-soft:', r('#8f3320','#fdeae6'));
