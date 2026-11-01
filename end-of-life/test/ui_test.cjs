process.env.CODE_GS = '/home/user/-2026/end-of-life/Code.gs';
const assert = require('assert');
const fs = require('fs');
const { chromium } = require('playwright');
const { makeEnv } = require(__dirname + '/gasmock.cjs');
const SHOT = __dirname + '/shots';
fs.mkdirSync(SHOT, { recursive: true });

(async () => {
  const E = makeEnv(); E.api.setup();
  let offline = false;
  const calls = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' });
  await ctx.exposeBinding('__gas', async (_s, fn, arg) => {
    calls.push(fn);
    if (offline && fn !== 'getInitData') return { __err: '네트워크 오류' };
    try { return { ok: JSON.parse(JSON.stringify(E.api[fn](arg))) }; } catch (e) { return { __err: e.message }; }
  });
  await ctx.addInitScript(() => {
    const mk = (s, f) => new Proxy({}, { get: (_, k) => {
      if (k === 'withSuccessHandler') return h => mk(h, f);
      if (k === 'withFailureHandler') return h => mk(s, h);
      return arg => window.__gas(k, arg).then(r => r.__err ? f && f(new Error(r.__err)) : s && s(r.ok));
    } });
    window.google = { script: { run: mk(null, null) } };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { errors.push('alert/confirm 사용됨: ' + d.message()); d.dismiss(); });
  const url = 'file:///home/user/-2026/end-of-life/Index.html';
  await page.goto(url);
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOT + '/1-start.png', fullPage: true });

  // 큰 글자·버튼 확인
  const fontSize = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  assert.ok(fontSize >= 20);
  // 가로 스크롤 없음
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  // 1. 팀 → 이름
  await page.click('#teamChips .chip[data-team="따품안"]');
  const h = await page.locator('#teamChips .chip').first().boundingBox();
  assert.ok(h.height >= 56, '버튼 높이 ' + h.height);
  assert.ok(await page.locator('#meInput').isVisible(), '팀 누르면 이름 칸');
  await page.screenshot({ path: SHOT + '/0-name.png' });
  await page.click('#meOk');
  assert.ok(await page.locator('#errBanner.show').count(), '빈 이름 막음');
  await page.fill('#meInput', ' 이명옥 ');
  await page.click('#meOk');
  assert.equal(await page.textContent('#meName'), '이명옥');
  assert.equal(await page.inputValue('#f-date'), new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10));

  // 저장: 어르신 이름 없으면 빨간 칸
  await page.click('#saveBtn');
  assert.ok(await page.locator('[data-sec="elder"].missing').count());

  await page.fill('#f-elder', '홍길동');
  await page.click('#saveBtn');
  await page.waitForTimeout(400);
  let sh = Object.values(E.spreadsheets)[0].getSheetByName('방문기록지');
  assert.equal(sh.getLastRow(), 2);
  assert.equal(sh.cells[1][sh.cells[0].indexOf('상태')], '임시저장');

  // 전송: 필수 칸 빨간 표시
  await page.click('#sendBtn');
  assert.equal(await page.locator('section.card.missing').count(), 4, '활동시간·대화상대·기분·전달사항');
  // 활동 시간: 끝이 시작보다 빠르면 경고 + 미완료
  await page.fill('#f-timeStart', '16:00');
  await page.fill('#f-timeEnd', '14:00');
  assert.match(await page.textContent('#timeCalc'), /늦어야/);
  assert.ok(await page.locator('[data-sec="time"].missing').count());
  await page.fill('#f-timeStart', '14:00');
  await page.fill('#f-timeEnd', '16:30');
  assert.equal(await page.textContent('#timeCalc'), '총 2시간 30분 활동');
  assert.equal(await page.locator('[data-sec="time"].missing').count(), 0);
  // 스스로 가능한 것 / 가장 불편한 것 / 다음 방문 날짜
  await page.click('.chip[data-key="selfCare"][data-val="식사"]');
  await page.click('.chip[data-key="selfCare"][data-val="수면·휴식"]');
  await page.fill('#f-discomfort', '허리 통증');
  await page.fill('#f-date', '2026-10-29');
  await page.click('[data-for="nextVisit"][data-days="7"]');
  assert.equal(await page.inputValue('#f-nextVisit'), '2026-11-05', '1주 뒤');
  await page.click('[data-for="nextVisit"][data-days="14"]');
  assert.equal(await page.inputValue('#f-nextVisit'), '2026-11-12', '2주 뒤');
  const order = await page.$$eval('#form section.card', els => els.map(e => e.dataset.sec));
  assert.deepEqual(order, ['date','time','elder','partner','mood','selfCare','discomfort','notice','noticeNote','nextVisit','memo']);
  await page.screenshot({ path: SHOT + '/2-missing.png', fullPage: true });

  await page.click('.chip[data-key="partner"][data-val="대상자 본인"]');
  await page.click('.chip[data-key="partner"][data-val="자녀"]');
  await page.click('.chip[data-key="mood"][data-val="통증"]');
  // 전달 내용 칸은 '있음'일 때만
  assert.ok(await page.locator('[data-sec="noticeNote"]').isHidden());
  await page.click('.chip[data-key="notice"][data-val="의료진"]');
  assert.ok(await page.locator('[data-sec="noticeNote"]').isVisible());
  await page.click('.chip[data-key="notice"][data-val="대상자 가족"]');
  await page.click('#sendBtn');
  assert.ok(await page.locator('[data-sec="noticeNote"].missing').count(), '있음이면 전달 내용 필수');
  await page.fill('#f-noticeNote', '허리 통증이 심해지셨다고 함');
  await page.click('.phrase[data-val="말벗 해드림."]');
  assert.equal(await page.textContent('#progress'), '✓ 다 했어요');
  await page.screenshot({ path: SHOT + '/3-filled.png', fullPage: true });

  // 새로고침해도 남아 있음 (자동 임시저장)
  await page.waitForTimeout(400);
  await page.reload(); await page.waitForTimeout(300);
  assert.equal(await page.inputValue('#f-noticeNote'), '허리 통증이 심해지셨다고 함');
  assert.equal(await page.textContent('#meName'), '이명옥');

  await page.click('#sendBtn');
  assert.ok(await page.locator('#confirmDlg[open]').count());
  await page.screenshot({ path: SHOT + '/4-confirm.png' });
  await page.click('#confirmBtn');
  await page.waitForTimeout(500);
  assert.match(await page.textContent('#okBanner'), /홍길동 어르신 기록을 보냈습니다/);
  assert.equal(sh.getLastRow(), 2, '저장했던 줄이 전송완료로 바뀜');
  const H = sh.cells[0], R = sh.cells[1], c = k => R[H.indexOf(k)];
  assert.equal(c('상태'), '전송완료');
  assert.equal(c('대화상대'), '대상자 본인, 자녀');
  assert.equal(c('필수 전달사항'), '의료진, 대상자 가족');
  const L = Object.values(E.spreadsheets)[0].getSheetByName('전체목록');
  assert.equal(L.cells[1][L.cells[0].indexOf('알림')], '필수 전달사항(의료진, 대상자 가족): 허리 통증이 심해지셨다고 함');
  assert.equal(c('팀'), '따품안');
  assert.equal(c('스스로 가능한 것'), '식사, 수면·휴식'); assert.equal(c('가장 불편한 것'), '허리 통증'); assert.equal(c('다음 방문 날짜'), '2026-11-12');
  assert.equal(c('시작 시간'), '14:00'); assert.equal(c('끝 시간'), '16:30'); assert.equal(c('활동 시간'), '2시간 30분');
  const doc = Object.values(E.docs)[0];
  assert.match(doc.name, /^생애말기활동가기록지_홍길동_이명옥_\d{4}-\d\d-\d\d$/);
  // 전송 후 비워지고, 이름은 기억, 전에 만난 어르신 버튼 생김
  assert.equal(await page.inputValue('#f-elder'), '');
  assert.equal(await page.textContent('#meName'), '이명옥');
  assert.equal(await page.locator('#elderChips .chip[data-elder="홍길동"]').count(), 1);
  await page.screenshot({ path: SHOT + '/5-sent.png', fullPage: true });

  // 버튼으로 어르신 이름 채우기 + 의료진 '없음'이면 전달 내용 저장 안 함
  await page.click('#elderChips .chip[data-elder="홍길동"]');
  assert.equal(await page.inputValue('#f-elder'), '홍길동');
  await page.click('.chip[data-key="partner"][data-val="요양보호사"]');
  await page.click('.chip[data-key="mood"][data-val="활발"]');
  await page.click('[data-now="timeStart"]');
  assert.match(await page.inputValue('#f-timeStart'), /^\d\d:\d\d$/, '지금 버튼');
  await page.fill('#f-timeStart', '10:00'); await page.fill('#f-timeEnd', '10:45');
  assert.equal(await page.textContent('#timeCalc'), '총 45분 활동');
  await page.click('.chip[data-key="notice"][data-val="사회복지사"]');
  await page.fill('#f-noticeNote', '지워져야 할 내용');
  await page.click('.chip[data-key="notice"][data-val="없음"]');
  assert.equal(await page.getAttribute('.chip[data-key="notice"][data-val="사회복지사"]', 'aria-pressed'), 'false', '없음 누르면 나머지 해제');
  assert.ok(await page.locator('[data-sec="noticeNote"]').isHidden());

  // 인터넷 끊김 → 대기열 → 다시 보내기
  offline = true;
  await page.click('#sendBtn'); await page.click('#confirmBtn');
  await page.waitForTimeout(400);
  assert.ok(await page.locator('#queueBanner.show').count());
  assert.match(await page.textContent('#queueText'), /1건/);
  await page.screenshot({ path: SHOT + '/6-queue.png', fullPage: true });
  offline = false;
  await page.click('#retryBtn'); await page.waitForTimeout(500);
  assert.ok(!(await page.locator('#queueBanner.show').count()));
  assert.equal(sh.getLastRow(), 3);
  const R2 = sh.cells[2];
  assert.equal(R2[H.indexOf('전달 내용')] || '', '', '없음이면 전달 내용 비움');
  assert.equal(Object.keys(E.docs).length, 2);
  // 같은 기록 다시 보내도 중복 없음
  const queued = { id: R2[0] };
  const again = E.api.saveVisit({ id: queued.id, author: '이명옥', meta: { elder: '홍길동', date: '2026-10-25' }, items: [] });
  assert.ok(again.duplicate);

  // NEW: 쓰던 기록 보관 → 목록 → 두 번 눌러 지우기
  await page.fill('#f-elder', '김순자');
  await page.click('#newBtn');
  assert.equal(await page.inputValue('#f-elder'), '');
  assert.ok(await page.locator('#savedBanner.show').count());
  await page.click('#savedOpenBtn');
  await page.click('[data-del]');
  assert.equal(await page.locator('.saved-item').count(), 1, '한 번 누르면 안 지워짐');
  await page.screenshot({ path: SHOT + '/7-delete-armed.png' });
  await page.click('[data-del]');
  assert.equal(await page.locator('.saved-item').count(), 0);
  await page.click('#savedCloseBtn');

  // 이름 바꾸기
  await page.click('#changeMe');
  assert.ok(await page.locator('#pickBox').isVisible());
  assert.equal(await page.textContent('#meName'), '');
  await page.click('#teamChips .chip[data-team="햇살동행"]');
  assert.equal(await page.inputValue('#meInput'), '이명옥', '바꾸기 때 이전 이름 채워짐');
  await page.fill('#meInput', '윤서연');
  await page.press('#meInput', 'Enter');
  assert.equal(await page.textContent('#meTeam'), '햇살동행 팀');
  assert.equal(await page.locator('#elderChips .chip').count(), 0, '다른 활동가에겐 남의 어르신 안 보임');

  assert.match(await page.textContent('#footState'), /서버 2026-11-01/);
  assert.deepEqual(errors, []);

  // 미리보기(구글 밖) 모드에서도 오류 없이 열림
  const p2 = await browser.newPage({ viewport: { width: 360, height: 740 } });
  const e2 = []; p2.on('pageerror', e => e2.push(e.message));
  await p2.goto(url); await p2.waitForTimeout(400);
  assert.ok(await p2.locator('#demoBanner.show').count());
  assert.deepEqual(e2, []);

  await browser.close();
  console.log('화면 시험 모두 통과. 서버 호출:', calls.join(','));
})().catch(e => { console.error(e); process.exit(1); });
