/**
 * 생애말기활동가기록지 — Google Apps Script 서버 코드
 *
 * ▶ 휴대폰 화면(Index.html)은 GitHub에서 자동으로 불러옵니다.
 *   그래서 화면·항목·명단을 고칠 때는 이 프로젝트를 다시 배포할 필요가 없습니다.
 *   (GitHub를 못 읽을 때만 이 프로젝트 안의 Index 파일을 대신 씁니다)
 *
 * 활동가가 휴대폰에서 고른 내용을 받아
 *   1) [저장] 시 구글 시트에 '임시저장'으로 기록 (기록 종류별 탭: 방문기록지, 첫방문 …)
 *   2) [전송] 시 같은 줄을 '전송완료'로 바꾸고, 구글 문서 기록지를
 *      지정 폴더 안의 활동가별/월별 폴더(예: 이명옥/2026-10)에 만듭니다.
 *
 * 설치 방법은 같은 폴더의 README.md를 보세요.
 */

const APP_TITLE = '생애말기 활동기록';
const APP_VERSION = '2026-11-01'; // 서버 코드 버전 (휴대폰 화면 맨 아래에 표시)
// 휴대폰 화면을 불러올 주소 (GitHub의 이 앱 전용 브랜치 — main은 건드리지 않음)
const HTML_URL = 'https://raw.githubusercontent.com/bcmedcoophome-cyber/-2026/refs/heads/claude/end-of-life-record/end-of-life/Index.html';
const HTML_CACHE_SECONDS = 300; // 5분마다 GitHub에서 새로 읽음
// 기록지를 저장할 구글 드라이브 폴더 (「방문기록지」)
// 폴더 주소 https://drive.google.com/drive/folders/ 뒤의 ID 부분입니다.
const TARGET_FOLDER_ID = '10TnjGjVX9ErWWt-uffupolUOcb7M_02_';
const FOLDER_NAME = '생애말기활동가기록지'; // TARGET_FOLDER_ID를 비워두면 이 이름으로 새 폴더를 만듦
const SHEET_FILE_NAME = '생애말기활동가 기록부';
const DEFAULT_KIND = '방문기록지'; // 기록 종류 = 시트 탭 이름 (항목 전체)
const LIST_SHEET = '전체목록';     // 맨 앞 탭: 모든 기록을 한 줄씩 (기록지 링크 포함)
const LIST_HEADERS = ['기록ID', '전송시각', '기록종류', '방문날짜', '어르신 이름', '활동가', '팀', '상태', '중요도', '중요 키워드', '알림', '기록지'];

/* ---------- 중요도: 기록 내용에서 키워드를 찾아 '높음/보통'으로 표시 ----------
 * 키워드는 시트의 「중요키워드」 탭에서 직접 고칠 수 있습니다(처음 저장할 때 아래 기본값으로 만들어짐).
 * 키워드를 고치면 다음 저장 때 지난 기록까지 모두 다시 판정합니다. */
const KEYWORD_SHEET = '중요키워드';
const FOCUS_SHEET = '중요기록';
const LEVEL_HEADER = '중요도';
const KEYWORD_HEADER = '중요 키워드';
const LEVELS = ['높음', '보통']; // 앞쪽이 더 중요
const DEFAULT_KEYWORDS = [
  ['높음', '자살', '위기'], ['높음', '죽고 싶', '위기'], ['높음', '학대', '위기'], ['높음', '방임', '위기'],
  ['높음', '낙상', '안전'], ['높음', '넘어', '안전'], ['높음', '호흡곤란', '응급'], ['높음', '숨이 차', '응급'],
  ['높음', '의식', '응급'], ['높음', '응급', '응급'], ['높음', '출혈', '응급'], ['높음', '욕창', '건강'],
  ['높음', '식사 못', '건강'], ['높음', '못 드심', '건강'], ['높음', '탈수', '건강'], ['높음', '돌봄 공백', '돌봄'],
  ['높음', '임종', '돌봄'],
  ['보통', '통증', '건강'], ['보통', '아프', '건강'], ['보통', '우울', '정서'], ['보통', '무기력', '정서'],
  ['보통', '불안', '정서'], ['보통', '외로', '정서'], ['보통', '불면', '수면'], ['보통', '잠을 못', '수면'],
  ['보통', '식욕', '건강'], ['보통', '변비', '건강'], ['보통', '부종', '건강'], ['보통', '갈등', '가족'],
  ['보통', '의료진', '필수 전달사항'], ['보통', '사회복지사', '필수 전달사항'], ['보통', '대상자 가족', '필수 전달사항']
];
// 키워드를 찾지 않는 칸 (이름·날짜·시간 등)
const NO_SCAN = ['기록ID', '전송시각', '기록종류', '활동가', '팀', '구글계정', '상태', '기록지', '방문날짜', '어르신 이름',
  '시작 시간', '끝 시간', '활동 시간', '다음 방문 날짜', LEVEL_HEADER, KEYWORD_HEADER];
const PROP_KW_HASH = 'EOL_KW_HASH';
const PROP_VIEW = 'EOL_VIEW';
const BASE_HEADERS = ['기록ID', '전송시각', '활동가', '팀', '구글계정', '상태'];
const STATUS_HEADER = '상태';
const STATUS_DRAFT = '임시저장';
const STATUS_SENT = '전송완료';
const LINK_HEADER = '기록지';
const DEFAULT_PREFIX = '생애말기활동가기록지';
const PROP_SHEET = 'EOL_SHEET_ID';
const PROP_FOLDER = 'EOL_FOLDER_ID';

function doGet(e) {
  const fresh = e && e.parameter && e.parameter.fresh;
  return HtmlService.createHtmlOutput(loadHtml_(!!fresh))
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** GitHub의 최신 화면을 읽음 (5분 저장). 실패하면 프로젝트 안의 Index 파일 */
function loadHtml_(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    const hit = cache.get('html');
    if (hit) return hit;
  }
  try {
    const res = UrlFetchApp.fetch(HTML_URL, { muteHttpExceptions: true, followRedirects: true });
    const html = res.getResponseCode() === 200 ? res.getContentText('UTF-8') : '';
    if (html.indexOf('</html>') > 0 && html.indexOf('google.script.run') > 0) {
      try { cache.put('html', html, HTML_CACHE_SECONDS); } catch (err) {} // 100KB 넘으면 저장만 생략
      return html;
    }
  } catch (err) { /* 아래 예비 화면 사용 */ }
  return HtmlService.createHtmlOutputFromFile('Index').getContent();
}

/** 처음 한 번 편집기에서 실행: 권한 승인 + 드라이브 폴더/시트 생성 + 화면 불러오기 확인 */
function setup() {
  const { folder, ss } = ensureStorage_();
  getSheet_(ss, LIST_SHEET, LIST_HEADERS);
  getSheet_(ss, DEFAULT_KIND);
  Logger.log('저장 폴더: ' + folder.getUrl());
  Logger.log('기록 시트: ' + ss.getUrl());
  const code = UrlFetchApp.fetch(HTML_URL, { muteHttpExceptions: true }).getResponseCode();
  Logger.log(code === 200 ? '화면: GitHub에서 불러옴' : '화면: GitHub 읽기 실패(' + code + ') → 프로젝트 안 Index 파일 사용');
}

/**
 * 화면을 열 때: 버전만 돌려줌.
 * 앱은 로그인 없이 누구나 열 수 있으므로, 시트의 어르신 이름 등 저장된 정보는 절대 돌려주지 않음.
 * (전에 만난 어르신 목록은 각 휴대폰에 남은 기록으로만 보여 줌)
 */
function getInitData() {
  return { elders: [], version: APP_VERSION };
}

/**
 * [저장] 버튼: 시트에 '임시저장'으로 기록 (같은 기록ID는 같은 줄을 덮어씀, 문서는 만들지 않음)
 * record = {
 *   id, kind:'방문기록지'|'첫방문'|…, filePrefix, docTitle, author, team,
 *   meta:{ elder, date },
 *   sections:[{ title, items:[{ label, value }] }],   // 문서에 섹션별 표로 들어감
 *   items:[{ label, value }],                          // (sections 대신 써도 됨)
 *   alerts:['의료진 전달사항 있음: …']                  // 문서 위쪽에 빨간 글씨
 * }
 */
function saveDraft(record) {
  return upsertRecord_(record, false);
}

/** [전송] 버튼: 기록지 문서를 만들고 같은 줄을 '전송완료'로 바꿈 */
function saveVisit(record) {
  return upsertRecord_(record, true);
}

function upsertRecord_(record, final) {
  if (!record || !record.id || !record.meta || !record.meta.elder || !record.meta.date || !record.author) {
    throw new Error('활동가 이름, 방문날짜, 어르신 이름은 꼭 입력해야 합니다.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const { folder, ss } = ensureStorage_();
    const kind = kindOf_(record);
    const sh = getSheet_(ss, kind);
    const list = getSheet_(ss, LIST_SHEET, LIST_HEADERS);

    // 이미 전송 완료된 기록(다시 보내기 등)은 중복 문서를 만들지 않음
    const prev = findRow_(list, record.id);
    if (prev && prev.get(STATUS_HEADER) === STATUS_SENT) {
      return { ok: true, duplicate: true, status: STATUS_SENT };
    }

    const docUrl = final ? createDoc_(folder, record) : '';
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    const status = final ? STATUS_SENT : STATUS_DRAFT;
    const keywords = loadKeywords_(ss);
    const texts = allItems_(record).filter(it => NO_SCAN.indexOf(it.label) < 0).map(it => it.value)
      .concat(record.alerts || []);
    const pr = judge_(texts, keywords);

    // 1) 기록 종류별 탭: 항목 전체
    const data = {};
    data['기록ID'] = record.id;
    data['전송시각'] = now;
    data['활동가'] = record.author || '';
    data['팀'] = record.team || '';
    data['구글계정'] = Session.getActiveUser().getEmail() || '';
    data[STATUS_HEADER] = status;
    allItems_(record).forEach(it => { data[it.label] = it.value || ''; });
    data['방문날짜'] = record.meta.date; // 문서 이름·폴더와 항상 같게
    data['어르신 이름'] = record.meta.elder;
    data[LEVEL_HEADER] = pr.level;
    data[KEYWORD_HEADER] = pr.words;
    data[LINK_HEADER] = docUrl;
    writeRow_(sh, data);

    // 2) 전체목록 탭: 한 건 한 줄
    writeRow_(list, {
      '기록ID': record.id, '전송시각': now, '기록종류': kind,
      '방문날짜': record.meta.date, '어르신 이름': record.meta.elder,
      '활동가': record.author || '', '팀': record.team || '', '상태': status,
      '중요도': pr.level, '중요 키워드': pr.words,
      '알림': (record.alerts || []).filter(Boolean).join(' / '), '기록지': docUrl
    });
    // 키워드가 바뀌었으면 지난 기록도 다시 판정, 색 표시·중요기록 탭 맞추기
    refreshPriorityIfChanged_(ss, keywords);
    ensureViews_(ss, list);
    return { ok: true, status: status };
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- 내부 함수 ---------------- */

/** 「중요키워드」 탭을 읽음 (없으면 기본값으로 만듦) → [{ level, word }] */
function loadKeywords_(ss) {
  let sh = ss.getSheetByName(KEYWORD_SHEET);
  if (!sh) {
    sh = ss.insertSheet(KEYWORD_SHEET);
    const rows = [['중요도', '키워드', '분류(메모)']].concat(DEFAULT_KEYWORDS);
    const r = sh.getRange(1, 1, rows.length, 3);
    r.setNumberFormat('@');
    r.setValues(rows);
    const head = sh.getRange(1, 1, 1, 3);
    head.setFontWeight('bold');
    head.setBackground('#e8f0fe');
    sh.setFrozenRows(1);
    sh.getRange(1, 5, 4, 1).setValues([['사용법'], ['· 중요도 칸에는 높음 또는 보통만 적어 주세요.'],
      ['· 키워드가 기록 내용 어디에든 들어 있으면 그 중요도로 표시됩니다.'], ['· 고치면 다음 기록을 저장할 때 지난 기록까지 다시 판정합니다.']]);
  }
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 2).getDisplayValues()
    .map(r => ({ level: String(r[0]).trim(), word: String(r[1]).trim() }))
    .filter(k => k.word && LEVELS.indexOf(k.level) >= 0);
}

/** 글들에서 키워드를 찾아 { level: '높음'|'보통'|'', words: '통증, 우울' } */
function judge_(texts, keywords) {
  const text = texts.filter(Boolean).join(' \n ').toLowerCase();
  let best = LEVELS.length;
  const found = [];
  keywords.forEach(k => {
    if (text.indexOf(k.word.toLowerCase()) < 0) return;
    if (found.indexOf(k.word) < 0) found.push(k.word);
    best = Math.min(best, LEVELS.indexOf(k.level));
  });
  return { level: best < LEVELS.length ? LEVELS[best] : '', words: found.join(', ') };
}

/** 키워드 목록이 바뀌었으면 모든 기록의 중요도를 다시 계산 */
function refreshPriorityIfChanged_(ss, keywords) {
  const props = PropertiesService.getScriptProperties();
  const hash = keywords.map(k => k.level + ':' + k.word).join('|');
  if (props.getProperty(PROP_KW_HASH) === hash) return;
  const byId = {};
  ss.getSheets().forEach(sh => {
    const name = sh.getName();
    if (name === LIST_SHEET || name === KEYWORD_SHEET || name === FOCUS_SHEET || sh.getLastRow() < 2) return;
    const header = ensureHeaders_(sh, [LEVEL_HEADER, KEYWORD_HEADER]);
    const values = sh.getRange(2, 1, sh.getLastRow() - 1, header.length).getDisplayValues();
    const li = header.indexOf(LEVEL_HEADER), ki = header.indexOf(KEYWORD_HEADER);
    const out = values.map(row => {
      const pr = judge_(row.filter((v, i) => header[i] && NO_SCAN.indexOf(header[i]) < 0), keywords);
      byId[row[0]] = pr;
      return pr;
    });
    writeColumn_(sh, li + 1, out.map(p => p.level));
    writeColumn_(sh, ki + 1, out.map(p => p.words));
  });
  const list = ss.getSheetByName(LIST_SHEET);
  if (list && list.getLastRow() > 1) {
    const header = ensureHeaders_(list, [LEVEL_HEADER, KEYWORD_HEADER, '알림']);
    const values = list.getRange(2, 1, list.getLastRow() - 1, header.length).getDisplayValues();
    const ai = header.indexOf('알림');
    const out = values.map(row => byId[row[0]] || judge_([row[ai]], keywords));
    writeColumn_(list, header.indexOf(LEVEL_HEADER) + 1, out.map(p => p.level));
    writeColumn_(list, header.indexOf(KEYWORD_HEADER) + 1, out.map(p => p.words));
  }
  props.setProperty(PROP_KW_HASH, hash);
}

function writeColumn_(sh, col, vals) {
  if (!vals.length) return;
  const r = sh.getRange(2, col, vals.length, 1);
  r.setNumberFormat('@');
  r.setValues(vals.map(v => [safeCell_(v)]));
}

/** 「전체목록」 줄 색(높음 빨강·보통 노랑)과 「중요기록」 탭(높음·보통만, 최근 순) */
function ensureViews_(ss, list) {
  const header = list.getRange(1, 1, 1, list.getLastColumn()).getValues()[0].map(String);
  const col = header.indexOf(LEVEL_HEADER) + 1;
  const dateCol = header.indexOf('방문날짜') + 1;
  if (col < 1) return;
  const letter = colLetter_(col), dateLetter = colLetter_(dateCol), lastLetter = colLetter_(header.length);
  const key = [letter, dateLetter, lastLetter].join('|');
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(PROP_VIEW) === key && ss.getSheetByName(FOCUS_SHEET)) return;

  const whole = list.getRange('A2:' + lastLetter + '2000');
  list.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + letter + '2="높음"')
      .setBackground('#fde2e1').setRanges([whole]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + letter + '2="보통"')
      .setBackground('#fff4cc').setRanges([whole]).build()
  ]);

  let focus = ss.getSheetByName(FOCUS_SHEET);
  if (!focus) focus = ss.insertSheet(FOCUS_SHEET, 1);
  focus.clear();
  // 수식은 앱이 만든 고정 문장(사용자 입력 아님)
  focus.getRange('A1').setFormula('=IFERROR(QUERY(' + LIST_SHEET + '!A:' + lastLetter + ',"select * where ' + letter +
    " = '높음' or " + letter + " = '보통' order by " + letter + ' asc, ' + dateLetter + ' desc",1),"아직 중요 기록이 없습니다")');
  props.setProperty(PROP_VIEW, key);
}

function colLetter_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** 기록ID로 줄 찾기 → { row, get(열이름) } 또는 null */
function findRow_(sh, id) {
  if (sh.getLastRow() < 2) return null;
  const found = sh.getRange(2, 1, sh.getLastRow() - 1, 1)
    .createTextFinder(String(id)).matchEntireCell(true).findNext();
  if (!found) return null;
  const row = found.getRow();
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  return { row: row, get: name => header.indexOf(name) >= 0 ? sh.getRange(row, header.indexOf(name) + 1).getDisplayValue() : '' };
}

/** 같은 기록ID 줄이 있으면 덮어쓰고, 없으면 맨 아래에 추가 (없는 열은 자동 추가) */
function writeRow_(sh, data) {
  const prev = findRow_(sh, data['기록ID']);
  const header = ensureHeaders_(sh, Object.keys(data));
  const row = header.map(h => safeCell_(data[h]));
  const target = sh.getRange(prev ? prev.row : sh.getLastRow() + 1, 1, 1, row.length);
  target.setNumberFormat('@');
  target.setValues([row]);
}

function kindOf_(record) {
  const k = clean_(record.kind).slice(0, 40) || DEFAULT_KIND;
  return [LIST_SHEET, KEYWORD_SHEET, FOCUS_SHEET].indexOf(k) >= 0 ? DEFAULT_KIND : k;
}

/** 섹션·항목을 한 줄로 펼침 (label 없는 것은 버림) */
function allItems_(record) {
  const out = [];
  (record.sections || []).forEach(s => (s && s.items || []).forEach(it => { if (it && it.label) out.push(it); }));
  (record.items || []).forEach(it => { if (it && it.label) out.push(it); });
  return out;
}

function ensureStorage_() {
  const props = PropertiesService.getScriptProperties();
  const folderId = TARGET_FOLDER_ID || props.getProperty(PROP_FOLDER);
  const sheetId = props.getProperty(PROP_SHEET);
  let folder, ss;

  if (folderId) {
    try { folder = DriveApp.getFolderById(folderId); }
    catch (e) { throw new Error('기록지 폴더에 접근할 수 없습니다. 폴더 주인(bcmedcoophome@gmail.com)으로 배포했는지 확인하세요.'); }
  } else {
    folder = DriveApp.createFolder(FOLDER_NAME);
    props.setProperty(PROP_FOLDER, folder.getId());
  }

  if (sheetId) {
    try { ss = SpreadsheetApp.openById(sheetId); }
    catch (e) { throw new Error('기록 시트에 접근할 수 없습니다. 관리자에게 확인하세요.'); }
  } else {
    ss = SpreadsheetApp.create(SHEET_FILE_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    ss.getSheets()[0].setName(LIST_SHEET);
    props.setProperty(PROP_SHEET, ss.getId());
  }
  return { folder: folder, ss: ss };
}

function getSheet_(ss, name, headers) {
  headers = headers || BASE_HEADERS;
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    const head = sh.getRange(1, 1, 1, headers.length);
    head.setValues([headers]);
    head.setFontWeight('bold');
    head.setBackground('#e8f0fe');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** 항목이 바뀌어도 새 열을 자동으로 추가 */
function ensureHeaders_(sh, keys) {
  const lastCol = sh.getLastColumn();
  const header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const missing = keys.filter(k => header.indexOf(k) < 0);
  if (missing.length) {
    const r = sh.getRange(1, lastCol + 1, 1, missing.length);
    r.setValues([missing]);
    r.setFontWeight('bold');
    r.setBackground('#e8f0fe');
    return header.concat(missing);
  }
  return header;
}

/** 시트 수식 주입 방지 */
function safeCell_(v) {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/** 파일·폴더 이름에 쓸 수 없는 글자 정리 */
function clean_(t) {
  return String(t || '').replace(/[\\/:*?"<>|_]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 하위 폴더를 이름으로 찾고, 없으면 만듦 */
function getSubFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/**
 * 기록지(구글 문서)를 활동가별·월별 폴더에 만듦
 *   지정 폴더 / 이명옥 / 2026-10 / 생애말기활동가기록지_어르신_이명옥_2026-10-25
 */
function createDoc_(folder, record) {
  const m = record.meta;
  const author = clean_(record.author) || '작성자미상';
  const prefix = clean_(record.filePrefix) || DEFAULT_PREFIX;
  const name = [prefix, clean_(m.elder), author, m.date].join('_');

  const doc = DocumentApp.create(name);
  try {
    const body = doc.getBody();
    body.setMarginTop(40);
    body.setMarginBottom(40);
    body.setMarginLeft(48);
    body.setMarginRight(48);

    // 주의: Paragraph.setText()는 아무것도 돌려주지 않으므로 이어 쓰지(체이닝) 않음
    const title = body.getParagraphs()[0];
    title.setText(String(record.docTitle || prefix));
    title.setHeading(DocumentApp.ParagraphHeading.TITLE);
    title.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    const head = body.appendTable([
      ['방문날짜', String(m.date), '어르신', String(m.elder)],
      ['활동가', String(record.author || ''), '팀', String(record.team || '')]
    ]);
    head.setBorderColor('#9aa0a6');
    for (let r = 0; r < head.getNumRows(); r++) {
      [0, 2].forEach(c => styleLabelCell_(head.getRow(r).getCell(c)));
    }

    (record.alerts || []).filter(Boolean).forEach(a => {
      const warn = body.appendParagraph('⚠ ' + a);
      warn.editAsText().setBold(true);
      warn.editAsText().setForegroundColor('#c5221f');
    });

    const skip = ['방문날짜', '어르신 이름'];
    const sections = (record.sections && record.sections.length)
      ? record.sections
      : [{ title: '활동 내용', items: record.items || [] }];
    sections.forEach(sec => {
      const items = (sec && sec.items || []).filter(it => it && it.label && skip.indexOf(it.label) < 0);
      if (!items.length) return;
      const h = body.appendParagraph('■ ' + (sec.title || ''));
      h.setHeading(DocumentApp.ParagraphHeading.HEADING3);
      const table = body.appendTable(items.map(it => [String(it.label), String(it.value || '-')]));
      table.setBorderColor('#9aa0a6');
      for (let i = 0; i < table.getNumRows(); i++) {
        const cell = table.getRow(i).getCell(0);
        cell.setWidth(120);
        styleLabelCell_(cell);
        if (items[i].alert) {
          table.getRow(i).getCell(1).editAsText().setForegroundColor('#c5221f');
          table.getRow(i).getCell(1).editAsText().setBold(true);
        }
      }
    });

    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    body.appendParagraph('');
    const sign = body.appendParagraph('작성일시: ' + now + '        활동가: ' + (record.author || '') + '  (서명)');
    sign.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
    doc.saveAndClose();

    const authorFolder = getSubFolder_(folder, author);
    const monthFolder = getSubFolder_(authorFolder, String(m.date).slice(0, 7));
    DriveApp.getFileById(doc.getId()).moveTo(monthFolder);
  } catch (e) {
    // 실패하면 빈 문서가 드라이브에 남지 않도록 휴지통으로
    try { DriveApp.getFileById(doc.getId()).setTrashed(true); } catch (e2) {}
    throw e;
  }
  return doc.getUrl();
}

function styleLabelCell_(cell) {
  cell.setBackgroundColor('#f1f3f4');
  cell.editAsText().setBold(true);
}
