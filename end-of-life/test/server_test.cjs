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
assert.equal(init.version, '2026-11-21f');
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
// ---- 계정·로그인·내 기록 ----
{
  const A = makeEnv({ autoAuth: false }); A.api.setup();
  const raw = (id, extra = {}) => Object.assign(rec(id), extra);
  // 로그인 없이 저장 불가
  assert.throws(() => A.api.saveVisit(raw('n1')), /로그인이 필요/);
  // 계정 탭: 처음엔 기존 기록 활동가로 자동 생성 + 비밀번호 자동 발급
  const B = makeEnv(); B.api.setup();
  B.api.saveVisit(rec('b1'));                       // 이명옥(자동 계정)
  const ssB = Object.values(B.spreadsheets)[0];
  const acc = ssB.getSheetByName('활동가계정');
  assert.ok(acc, '계정 탭');
  // 새 활동가: 이름만 적으면 비밀번호 자동
  acc.cells.push(['박새로', '해바라기', '', 'O']);
  assert.throws(() => B.api.login({ name: '박새로', pin: '0000' }), /맞지 않습니다/);
  const pin = acc.cells.find(r => r[0] === '박새로')[2];
  assert.match(pin, /^\d{6}$/, '자동 비밀번호');
  const t = B.api.login({ name: ' 박 새로 ', pin });
  assert.equal(t.name, '박새로'); assert.equal(t.team, '해바라기'); assert.ok(t.token);
  // 작성자는 계정으로 고정 (화면에서 다른 이름을 보내도)
  B.api.saveVisit(Object.assign(rec('b2', { author: '가짜이름', team: 'x', meta: { elder: '홍길동', date: '2026-11-02' } }), { auth: { name: '박새로', token: t.token } }));
  const L = rows(ssB.getSheetByName('전체목록'));
  assert.equal(L[1]['활동가'], '박새로'); assert.equal(L[1]['팀'], '해바라기');
  // 틀린 증표 / 사용 X / 비밀번호 변경 → 다시 로그인
  assert.throws(() => B.api.myData({ name: '박새로', token: 'zzz' }), /로그인이 필요/);
  acc.cells.find(r => r[0] === '박새로')[2] = '9999';
  assert.throws(() => B.api.myData({ name: '박새로', token: t.token }), /로그인이 필요/, '비밀번호 바꾸면 증표 무효');
  // 5번 틀리면 잠김
  for (let i = 0; i < 5; i++) assert.throws(() => B.api.login({ name: '박새로', pin: '0000' }));
  assert.throws(() => B.api.login({ name: '박새로', pin: '9999' }), /잠겼습니다/);
  // 사용 X
  B.api.addAccount('정막힘', '따품안', '2222');
  acc.cells.find(r => r[0] === '정막힘')[3] = 'X';
  assert.throws(() => B.api.login({ name: '정막힘', pin: '2222' }), /맞지 않습니다/);
}
{
  // 내 기록: 내가 쓴 기록 + 내가 방문했거나 담당인 어르신의 방문 내역(같은 조 포함), 남의 어르신은 안 보임
  const C = makeEnv(); C.api.setup();
  const mk = (id, author, elder, date, memo) => Object.assign(rec(id, { author, team: '햇살동행', meta: { elder, date }, alerts: [] }),
    { sections: [{ title: '활동 내용', items: [{ label: '대화상대', value: '자녀' }, { label: '활동 내용·특이사항', value: memo }, { label: '활동 시간', value: '30분' }] }] });
  const c1 = mk('c1', '김은아', '이정임', '2026-11-01', '말벗 해드림.');
  c1.sections[0].items.push({ label: '지급물품', value: '돌봄키트, 활동가키트' });
  C.api.saveVisit(c1);
  C.api.saveVisit(mk('c2', '양승미', '이정임.', '2026-11-03', '가'.repeat(200)));  // 같은 어르신(점 붙음), 다른 활동가
  C.api.saveVisit(mk('c3', '양승미', '윤묘섭', '2026-11-04', '남의 어르신'));
  const ss = Object.values(C.spreadsheets)[0];
  // 기초정보: 사회복지사가 입력 (담당 활동가에 김은아)
  C.api.addAccount('김은아2', '', '1'); // 계정 탭 존재 보장용
  const info = ss.getSheetByName('어르신기초정보') || (C.api.myData && null);
  const tok = C.api.login({ name: '김은아', pin: ss.getSheetByName('활동가계정').cells.find(r => r[0] === '김은아')[2] }).token;
  let d = C.api.myData({ name: '김은아', token: tok });
  const infoSh = ss.getSheetByName('어르신기초정보');
  assert.ok(infoSh, '기초정보 탭 자동 생성');
  const put = o => infoSh.cells.push(infoSh.cells[0].map(h => o[h] || ''));
  put({ '어르신 이름': '김새분', '담당 활동가1': '김은아', '담당 활동가2': '양승미', '성별': '여', '나이': '90세', '주요 질환·건강': '고혈압', '주의할 점': '낙상 주의' });
  put({ '어르신 이름': '윤묘섭', '담당 활동가1': '양승미', '성별': '남' });
  d = C.api.myData({ name: '김은아', token: tok });
  assert.deepEqual(d.mine.map(x => x.id), ['c1']);
  assert.equal(d.mine[0].supplies, '돌봄키트, 활동가키트');
  const names = d.elders.map(e => e.name).sort();
  assert.deepEqual(names, ['김새분', '이정임'], '방문한 어르신 + 담당 어르신, 남의 어르신 제외');
  const ej = d.elders.find(e => e.name === '이정임');
  assert.deepEqual(ej.visits.map(v => v.author), ['양승미', '김은아'], '같은 조 기록 포함, 최근 순');
  assert.ok(ej.visits[0].memo.length <= 81 && ej.visits[0].memo.endsWith('…'), '요약본');
  const ks = d.elders.find(e => e.name === '김새분');
  assert.equal(ks.count, 0);
  assert.deepEqual(ks.info.map(f => f.label), ['성별', '나이', '주요 질환·건강', '주의할 점'], '빈 칸은 안 보냄');
  assert.equal(ks.helpers, '김은아, 양승미');
  // 예전 탭에도 상태·종결일 칸이 붙고, 종결 표시는 closed로
  const ih = infoSh.cells[0];
  assert.ok(ih.includes('상태') && ih.includes('종결일'), '상태·종결일 칸');
  const row = infoSh.cells.find(r => r[0] === '김새분');
  row[ih.indexOf('상태')] = '종결'; row[ih.indexOf('종결일')] = '2026-11-20';
  d = C.api.myData({ name: '김은아', token: tok });
  const ks2 = d.elders.find(e => e.name === '김새분');
  assert.equal(ks2.closed, true); assert.equal(ks2.closedOn, '2026-11-20');
  assert.ok(!ks2.info.some(f => f.label === '상태' || f.label === '종결일'), '상태는 info에서 빠짐');
  assert.equal(d.elders[d.elders.length - 1].name, '김새분', '종결은 맨 뒤');
  // 특수 탭 보호
  C.api.saveDraft(Object.assign(mk('c9', '김은아', 'x', '2026-11-05', 'y'), { kind: '활동가계정' }));
  assert.ok(!ss.getSheetByName('활동가계정').cells.some(r => r[0] === 'c9'));
}
{
  const T = makeEnv(); T.api.setup();
  T.api.saveVisit(rec('t1'));
  const ss = Object.values(T.spreadsheets)[0];
  ss.sheets.splice(ss.sheets.findIndex(x => x.name === '활동가계정'), 1); // 아직 없다고 치고
  T.props['EOL_TABS_READY'] && delete T.props['EOL_TABS_READY'];
  T.api.getInitData();
  const acc = ss.getSheetByName('활동가계정');
  assert.ok(acc && acc.cells.some(r => r[0] === '이명옥' && /^\d{6}$/.test(r[2])), '앱 열면 계정 탭 + 비밀번호');
  assert.ok(ss.getSheetByName('어르신기초정보'), '앱 열면 기초정보 탭');
}
{
  // 예전 칸 구성(담당 활동가 한 칸, 성별·나이 한 칸, 오른쪽 사용법)에 입력해 둔 내용 → 새 칸으로 자동 옮김
  const O = makeEnv(); O.api.setup();
  O.api.saveVisit(rec('o1', { author: '김은아' }));
  const ss = Object.values(O.spreadsheets)[0];
  const old = ss.insertSheet('어르신기초정보');
  old.cells.push(['어르신 이름', '담당 활동가', '성별·나이', '사는 곳', '주요 질환·건강', '가족·보호자', '돌봄 상황', '주의할 점', '전달 메모', '', '사용법']);
  old.cells.push(['박옛날', '김은아, 이명옥', '여 · 88세', '○○동', '', '', '', '낙상 주의', '', '', '· 한 어르신 = 한 줄']);
  old.cells.push(['허준녀', '', '여', '', '', '', '', '', '', '', '· 담당 활동가로']);
  old.cells.push(['채원근', '', '남', '', '', '', '', '', '', '', '']);
  const tok = O.api.login({ name: '김은아', pin: '1111' }).token;
  let d = O.api.myData({ name: '김은아', token: tok });
  const H = old.cells[0];
  assert.deepEqual(H.slice(0, 7), ['어르신 이름', '담당 활동가1', '담당 활동가2', '상태', '종결일', '성별', '나이']);
  const row = n => Object.fromEntries(H.map((h, i) => [h, old.cells.find(r => r[0] === n)[i]]));
  assert.equal(row('박옛날')['담당 활동가1'], '김은아'); assert.equal(row('박옛날')['담당 활동가2'], '이명옥');
  assert.equal(row('박옛날')['성별'], '여'); assert.equal(row('박옛날')['나이'], '88세');
  assert.equal(row('박옛날')['사는 곳'], '○○동'); assert.equal(row('박옛날')['주의할 점'], '낙상 주의');
  assert.equal(row('허준녀')['성별'], '여'); assert.equal(row('채원근')['성별'], '남');
  assert.equal(old.cells.filter(r => r[0] && r[0] !== '어르신 이름' && r[0] !== '' && !/^·|사용법/.test(r[0])).length, 3, '21분 그대로(여기선 3분)');
  assert.ok(!H.includes('성별·나이') && !H.includes('담당 활동가'));
  const e = d.elders.find(x => x.name === '박옛날');
  assert.ok(e, '담당 활동가1에 있으니 보임');
  assert.deepEqual(e.info.map(f => f.label + '=' + f.value), ['성별=여', '나이=88세', '사는 곳=○○동', '주의할 점=낙상 주의']);
  assert.ok(!e.info.some(f => /사용법|·/.test(f.label + f.value)), '사용법 안 섞임');
  // 담당 활동가2로도 보임, 종결
  const t2 = (O.api.addAccount('이명옥', '따품안', '2222'), O.api.login({ name: '이명옥', pin: '2222' }).token);
  assert.ok(O.api.myData({ name: '이명옥', token: t2 }).elders.some(x => x.name === '박옛날'), '담당 활동가2');
  old.cells.find(r => r[0] === '채원근')[H.indexOf('담당 활동가1')] = '김은아';
  old.cells.find(r => r[0] === '채원근')[H.indexOf('상태')] = '종결';
  d = O.api.myData({ name: '김은아', token: tok });
  assert.equal(d.elders.find(x => x.name === '채원근').closed, true);
  // 두 번째에는 다시 옮기지 않음(그대로)
  const snap = JSON.stringify(old.cells);
  O.api.myData({ name: '김은아', token: tok });
  assert.equal(JSON.stringify(old.cells), snap);
}
{
  // 사람이 만든 다른 탭(예: 박남식용)은 건드리지 않음
  const P = makeEnv(); P.api.setup();
  const ss = Object.values(P.spreadsheets)[0];
  const other = ss.insertSheet('박남식용');
  other.cells.push(['', '', '']); other.cells.push(['봉사활동 등록 관리', '', '']); other.cells.push(['활동가', '방문날짜', '대상 어르신']);
  other.cells.push(['심윤재', '2026-10-27', '허준녀']);
  const before = JSON.stringify(other.cells);
  P.api.saveVisit(rec('p1'));
  P.api.getInitData();
  ss.getSheetByName('중요키워드').cells.push(['높음', '새키워드', '']);
  P.api.saveDraft(rec('p2'));
  assert.equal(JSON.stringify(other.cells), before, '다른 탭 그대로');
  // 한글 조합 방식이 달라도 같은 이름
  const nfd = '이명옥'.normalize('NFD');
  const tk = P.api.login({ name: nfd, pin: '1111' });
  assert.equal(tk.name, '이명옥');
}
{
  // 실제 시트 상태: 새 칸 + 점 모양이 다른 예전 칸(성별ㆍ나이 등)이 뒤에 남음 → 값을 제자리로 합치고 남는 칸 정리
  const Q = makeEnv(); Q.api.setup();
  Q.api.saveVisit(rec('q1', { author: '심윤재' }));
  const ss = Object.values(Q.spreadsheets)[0];
  const sh = ss.insertSheet('어르신기초정보');
  const NEW = ['어르신 이름', '담당 활동가1', '담당 활동가2', '상태', '종결일', '성별', '나이', '사는 곳', '주요 질환·건강', '가족·보호자', '돌봄 상황', '주의할 점', '전달 메모'];
  sh.cells.push(NEW.concat(['성별ㆍ나이', '주요 질환ㆍ건강', '가족ㆍ보호자', '', '사용법']));
  const blank = () => NEW.map(() => '');
  const r1 = blank(); r1[0] = '김상례'; r1[1] = '이명옥'; r1[2] = '심윤재'; r1[7] = '오정구 ○○로';
  sh.cells.push(r1.concat(['여', '', '', '', '· 한 어르신']));
  const r2 = blank(); r2[0] = '채원근'; r2[1] = '임종하'; r2[5] = '남'; r2[8] = '간경변';
  sh.cells.push(r2.concat(['남 · 80세', '예전 값', '', '', '']));
  const tok = Q.api.login({ name: '심윤재', pin: '1111' }).token;
  const d = Q.api.myData({ name: '심윤재', token: tok });
  const NEW2 = ['어르신 이름', '담당 활동가1', '담당 활동가2', '상태', '종결일', '성별', '나이', '장기요양등급', '대화·활동', '사는 곳', '주요 질환·건강', '가족·보호자', '돌봄 상황', '주의할 점', '전달 메모'];
  assert.deepEqual(sh.cells[0].slice(0, 15), NEW2, '새 칸 구성');
  assert.ok(!sh.cells[0].some(x => /ㆍ/.test(x)), '남는 칸 정리');
  const row = n => Object.fromEntries(sh.cells[0].map((h, i) => [h, sh.cells.find(r => r[0] === n)[i]]));
  assert.equal(row('김상례')['성별'], '여', '성별 칸으로 옮김');
  assert.equal(row('김상례')['사는 곳'], '오정구 ○○로');
  assert.equal(row('김상례')['담당 활동가2'], '심윤재');
  assert.equal(row('채원근')['성별'], '남'); assert.equal(row('채원근')['나이'], '80세');
  assert.equal(row('채원근')['주요 질환·건강'], '간경변', '새 칸 값이 우선');
  const e = d.elders.find(x => x.name === '김상례');
  assert.deepEqual(e.info.map(f => f.label + '=' + f.value), ['성별=여', '사는 곳=오정구 ○○로']);
  assert.equal(d.elders.filter(x => x.name === '김상례').length, 1, '한 번만');
  const snap = JSON.stringify(sh.cells); Q.api.myData({ name: '심윤재', token: tok });
  assert.equal(JSON.stringify(sh.cells), snap, '다시는 안 건드림');
}
{
  // 기초정보추가.csv → 빈 칸만 채우고, 없는 어르신 추가, 파일 순서대로 정렬, 파일 이름 '반영됨'
  const R = makeEnv(); R.api.setup();
  R.api.saveVisit(rec('r1', { author: '이명옥' }));
  const ss = Object.values(R.spreadsheets)[0];
  const tok = R.api.login({ name: '이명옥', pin: '1111' }).token;
  R.api.myData({ name: '이명옥', token: tok });          // 기초정보 탭 생성
  const sh = ss.getSheetByName('어르신기초정보');
  const H = sh.cells[0];
  const put = o => sh.cells.push(H.map(h => o[h] || ''));
  put({ '어르신 이름': '감상례', '담당 활동가1': '이명옥', '사는 곳': '오정구', '성별': '여' });
  put({ '어르신 이름': '허준녀', '담당 활동가1': '이명옥', '성별': '여', '주의할 점': '원래 값' });
  put({ '어르신 이름': '김명순(부부)', '담당 활동가1': '김동수' });
  const f = R.api.putFile('기초정보추가.csv', '﻿어르신 이름,예전 이름,성별,나이,장기요양등급,주요 질환ㆍ건강,주의할 점,대화ㆍ활동\n' +
    '허준녀,,여,95세,2등급,치매,"와상, 대화불가",전혀불가\n김상례,감상례,여,91세,,"치매, 심부전",,"대화, 활동가능"\n김명순,,여,88세,3등급,치매,,대화가능\n정건우,,남,85세,2등급,"고혈압,협심증",,"대화, 활동가능"\n');
  const d = R.api.myData({ name: '이명옥', token: tok });
  const rows = sh.cells.slice(1).filter(r => r[0]);
  assert.deepEqual(rows.map(r => r[0]), ['허준녀', '김상례', '김명순(부부)', '정건우'], '파일 순서대로, 새 어르신 추가, 괄호 이름 매칭');
  const H2 = sh.cells[0];
  const g = (n, h) => sh.cells.find(r => r[0] === n)[H2.indexOf(h)];
  assert.equal(g('허준녀', '주의할 점'), '원래 값', '이미 있는 값은 그대로');
  assert.equal(g('허준녀', '나이'), '95세'); assert.equal(g('허준녀', '장기요양등급'), '2등급');
  assert.equal(g('김상례', '주요 질환·건강'), '치매, 심부전', '점 모양 달라도 같은 칸');
  assert.equal(g('김상례', '사는 곳'), '오정구'); assert.equal(g('김상례', '대화·활동'), '대화, 활동가능');
  assert.equal(g('김명순(부부)', '나이'), '88세');
  assert.equal(g('정건우', '주요 질환·건강'), '고혈압,협심증');
  assert.match(f.name, /^기초정보추가\(반영됨 .+\)\.csv$/, '파일 이름 바뀜');
  const e = d.elders.find(x => x.name === '김상례');
  assert.ok(e.info.some(x => x.label === '대화·활동' && x.value === '대화, 활동가능'));
  assert.ok(!sh.cells[0].includes('예전 이름'), '예전 이름 칸은 시트에 안 생김');
  assert.ok(!sh.cells.some(r => r[0] === '감상례'), '감상례 → 김상례로 바뀜');
  // 기록의 '김명순'과 기초정보의 '김명순(부부)'는 같은 어르신
  R.api.saveVisit(rec('r2', { author: '김동수', team: '임종하면', meta: { elder: '김명순', date: '2026-11-20' } }));
  const t2 = R.api.login({ name: '김동수', pin: '1111' }).token;
  const d2 = R.api.myData({ name: '김동수', token: t2 });
  assert.equal(d2.elders.length, 1, '김명순 = 김명순(부부)');
  assert.equal(d2.elders[0].count, 1);
  // 다시 열어도 다시 반영하지 않음
  const snap = JSON.stringify(sh.cells); R.api.myData({ name: '이명옥', token: tok });
  assert.equal(JSON.stringify(sh.cells), snap);
}
{
  // 활동가계정에 같은 이름이 두 줄(한글 조합 방식만 다름) → 첫 줄만 남김
  const S = makeEnv(); S.api.setup();
  S.api.saveVisit(rec('s1', { author: '심윤재' }));
  const acc = Object.values(S.spreadsheets)[0].getSheetByName('활동가계정');
  acc.cells.push(['이명옥', '따품안', '111111', 'O', '']);
  acc.cells.push(['박동옥', '따품안', '333333', 'O', '']);
  acc.cells.push(['이명옥'.normalize('NFD'), '따품안', '222222', 'O', '']);
  const t = S.api.login({ name: '이명옥', pin: '111111' });
  const names = acc.cells.slice(1).map(r => r[0]).filter(Boolean);
  assert.deepEqual(names.map(n => n.normalize('NFC')), ['심윤재', '이명옥', '박동옥'], '두 번째 이명옥 줄 정리');
  assert.ok(!acc.cells.some(r => r[2] === '222222'));
  assert.equal(t.name, '이명옥');
}
console.log('서버 시험 모두 통과');
