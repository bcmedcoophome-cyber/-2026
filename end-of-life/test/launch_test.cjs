const { chromium } = require('playwright'); const assert = require('assert');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('https://script.google.com/**', r => r.fulfill({ body: 'APP' }));
  await p.goto('file:///home/user/-2026/pages/eol/index.html');
  assert.match(await p.getAttribute('#openBtn', 'href'), /AKfycbxJB7/);
  await p.screenshot({ path: __dirname + '/shots/launch.png' });
  // 홈 화면(독립 실행)으로 열면 앱으로 넘어감
  const p2 = await b.newPage();
  await p2.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); });
  await p2.route('https://script.google.com/**', r => r.fulfill({ body: 'APP' }));
  await p2.goto('file:///home/user/-2026/pages/eol/index.html');
  await p2.waitForTimeout(300);
  assert.match(p2.url(), /script\.google\.com/);
  assert.deepEqual(errs, []);
  await b.close(); console.log('시작 페이지 시험 통과');
})().catch(e => { console.error(e); process.exit(1); });
