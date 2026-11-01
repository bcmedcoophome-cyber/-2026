process.env.CODE_GS = '/home/user/-2026/end-of-life/Code.gs';
const assert = require('assert');
const { makeEnv } = require(__dirname + '/gasmock.cjs');
const rec = (id, extra = {}) => Object.assign({
  id, kind: '방문기록지', filePrefix: '생애말기활동가기록지', docTitle: '생애말기활동가기록지',
  author: '이명옥', team: '따품안', meta: { elder: '홍길동', date: '2026-10-25' },
  alerts: ['의료진 전달사항 있음: 허리 통증'],
  sections: [{ title: '활동 내용', items: [
    { label: '방문날짜', value: '2026-10-25' }, { label: '어르신 이름', value: '홍길동' },
    { label: '대화상대', value: '대상자 본인, 자녀' }, { label: '의료진 전달사항', value: '있음', alert: true },
    { label: '전달 내용', value: '=허리 통증' }] }]
}, extra);
const rows = sh => sh.cells.slice(1).map(r => Object.fromEntries(sh.cells[0].map((h, i) => [h, r[i]])));

let E = makeEnv(); E.api.setup();
const ss = Object.values(E.spreadsheets)[0];
assert.equal(ss.sheets[0].name, '전체목록', '맨 앞 탭이 전체목록');
assert.equal(E.path(E.files[ss.id].parent), '방문기록지');
E.api.saveDraft(rec('a1'));
const list = ss.getSheetByName('전체목록'), det = ss.getSheetByName('방문기록지');
assert.equal(rows(list)[0]['상태'], '임시저장');
assert.equal(Object.keys(E.docs).length, 0);
let r = E.api.saveVisit(rec('a1'));
assert.equal(r.status, '전송완료');
assert.equal(list.getLastRow(), 2); assert.equal(det.getLastRow(), 2);
const L = rows(list)[0], D = rows(det)[0];
assert.equal(L['상태'], '전송완료'); assert.equal(D['상태'], '전송완료');
assert.equal(L['기록종류'], '방문기록지');
assert.equal(L['알림'], '의료진 전달사항 있음: 허리 통증');
assert.ok(L['기록지'].startsWith('https://docs/')); assert.equal(L['기록지'], D['기록지']);
assert.equal(D['전달 내용'], "'=허리 통증");
assert.ok(!list.unformatted && !det.unformatted);
const doc = Object.values(E.docs)[0];
assert.equal(doc.name, '생애말기활동가기록지_홍길동_이명옥_2026-10-25');
assert.equal(E.path(E.files[Object.keys(E.docs)[0]].parent), '방문기록지/이명옥/2026-10');
assert.ok(doc.content.find(c => c.text === '⚠ 의료진 전달사항 있음: 허리 통증' && c.bold && c.color === '#c5221f'));
const t = doc.content.filter(c => c.type === 'table')[1];
assert.deepEqual(t.rows.map(x => x[0]), ['대화상대', '의료진 전달사항', '전달 내용']);
assert.equal(t.style['1,1'].color, '#c5221f');
// 중복 방지
assert.ok(E.api.saveVisit(rec('a1')).duplicate); assert.ok(E.api.saveDraft(rec('a1')).duplicate);
assert.equal(Object.keys(E.docs).length, 1); assert.equal(list.getLastRow(), 2);
// 다른 종류(첫방문) → 새 탭, 목록엔 한 줄 추가
E.api.saveVisit(rec('f1', { kind: '첫방문', filePrefix: '생애말기첫방문기록지', author: '홍경기', team: '햇살동행', meta: { elder: '김순자', date: '2026-11-02' }, alerts: [] }));
assert.ok(ss.getSheetByName('첫방문'));
assert.equal(list.getLastRow(), 3);
assert.equal(rows(list)[1]['기록종류'], '첫방문');
assert.equal(Object.values(E.docs)[1].name, '생애말기첫방문기록지_김순자_홍경기_2026-11-02');
assert.equal(E.path(E.files[Object.keys(E.docs)[1]].parent), '방문기록지/홍경기/2026-11');
// kind로 전체목록 탭을 덮어쓰지 못함
E.api.saveDraft(rec('x1', { kind: '전체목록' }));
assert.equal(rows(det).length, 2);
// getInitData
const init = E.api.getInitData();
assert.equal(init.version, '2026-11-01');
assert.deepEqual(init.elders, [], '저장된 정보는 화면으로 보내지 않음');
assert.ok(!('docUrl' in E.api.saveVisit(rec('a1'))), '문서 주소도 보내지 않음');
// 필수값
assert.throws(() => E.api.saveVisit(rec('c3', { author: '' })), /꼭 입력/);
// 문서 실패 → 휴지통, 줄 없음
const F = makeEnv({ failDoc: true }); F.api.setup();
assert.throws(() => F.api.saveVisit(rec('z9')));
assert.equal(Object.values(F.files).find(f => f.kind === 'doc').trashed, true);
assert.equal(Object.values(F.spreadsheets)[0].getSheetByName('전체목록').getLastRow(), 1);
// doGet: GitHub 화면 + 5분 저장, GitHub 실패 시 예비 화면
const G = makeEnv({ githubHtml: '<html>google.script.run GITHUB</html>' });
assert.match(G.api.doGet({ parameter: {} }).html, /GITHUB/);
G.api.doGet({ parameter: {} }); assert.equal(G.fetchCount.n, 1, '캐시 사용');
G.api.doGet({ parameter: { fresh: '1' } }); assert.equal(G.fetchCount.n, 2);
assert.equal(makeEnv({ githubDown: true }).api.doGet({}).html, 'LOCAL-INDEX');
assert.equal(makeEnv({ githubHtml: '404: Not Found' }).api.doGet({}).html, 'LOCAL-INDEX');
// ---- 중요도 ----
{
  const K = makeEnv(); K.api.setup();
  const mk = (id, items, extra = {}) => Object.assign(rec(id, { alerts: [] }), { sections: [{ title: '활동 내용', items }] }, extra);
  K.api.saveVisit(mk('p1', [{ label: '대상자 기분·상태', value: '통증, 우울' }, { label: '활동 내용·특이사항', value: '말벗 해드림.' }]));
  K.api.saveVisit(mk('p2', [{ label: '대상자 기분·상태', value: '활발' }, { label: '활동 내용·특이사항', value: '어제 화장실에서 넘어지셨다고 함' }], { meta: { elder: '김순자', date: '2026-10-26' } }));
  K.api.saveVisit(mk('p3', [{ label: '대상자 기분·상태', value: '활발' }, { label: '활동 내용·특이사항', value: '산책 함께 함.' }], { meta: { elder: '박영희', date: '2026-10-27' } }));
  K.api.saveVisit(mk('p4', [{ label: '활동 내용·특이사항', value: '특이사항 없음' }], { meta: { elder: '통증', date: '2026-10-28' } })); // 이름은 판정 안 함
  const ss = Object.values(K.spreadsheets)[0];
  const L = rows(ss.getSheetByName('전체목록'));
  assert.deepEqual(L.map(r => r['중요도'] + '/' + r['중요 키워드']), ['보통/통증, 우울', '높음/넘어', '/', '/']);
  const D = rows(ss.getSheetByName('방문기록지'));
  assert.equal(D[1]['중요도'], '높음');
  // 키워드 탭 + 중요기록 탭 + 색 표시
  const kw = ss.getSheetByName('중요키워드');
  assert.ok(kw && kw.cells.length > 20, '기본 키워드');
  const list = ss.getSheetByName('전체목록');
  const lc = list.cells[0].indexOf('중요도') + 1;
  const letter = String.fromCharCode(64 + lc);
  assert.equal(list.cfRules.length, 2);
  assert.equal(list.cfRules[0].formula, '=$' + letter + '2="높음"');
  const focus = ss.getSheetByName('중요기록');
  assert.equal(ss.sheets.indexOf(focus), 1, '전체목록 바로 뒤');
  assert.match(focus.formulas['1,1'], new RegExp("QUERY\\(전체목록!A:[A-Z]+,\"select \\* where " + letter + " = '높음' or " + letter + " = '보통' order by " + letter + ' asc'));
  // 키워드를 고치면 지난 기록도 다시 판정
  kw.cells.push(['높음', '산책', '시험']);
  K.api.saveDraft(mk('p5', [{ label: '활동 내용·특이사항', value: '없음' }], { meta: { elder: '이말순', date: '2026-10-29' } }));
  const L2 = rows(ss.getSheetByName('전체목록'));
  assert.equal(L2[2]['중요도'], '높음', '지난 기록 다시 판정');
  assert.equal(L2[2]['중요 키워드'], '산책');
  assert.equal(rows(ss.getSheetByName('방문기록지'))[2]['중요도'], '높음');
  // 키워드 탭의 '중요도' 칸 오타는 무시
  kw.cells.push(['아주높음', '말벗', '']);
  K.api.saveDraft(mk('p6', [{ label: '활동 내용·특이사항', value: '말벗' }], { meta: { elder: '최', date: '2026-10-30' } }));
  assert.equal(rows(ss.getSheetByName('전체목록'))[5]['중요도'], '');
  assert.ok(!list.unformatted, '@ 서식');
  K.api.saveDraft(mk('x9', [{ label: '활동 내용·특이사항', value: '해킹' }], { kind: '중요키워드' }));
  assert.equal(kw.cells.filter(r => r[0] === 'x9').length, 0, '키워드 탭 보호');
}
console.log('서버 시험 모두 통과');
