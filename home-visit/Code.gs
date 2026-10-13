/**
 * 재택의료 사회복지 방문상담 체크리스트 — Google Apps Script 서버 코드
 *
 * 휴대폰에서 체크한 상담 내용을 받아
 *   1) 구글 시트(방문기록)에 한 줄씩 누적하고
 *   2) 방문 건마다 구글 문서 「방문기록지_환자명_작성자_날짜」를 지정한 드라이브 폴더에 만듭니다.
 *
 * 설치 방법은 같은 폴더의 README.md를 보세요.
 */

const APP_TITLE = '재택의료 사회복지 상담기록';
// 방문기록지를 저장할 구글 드라이브 폴더 (「환자별 방문기록지 (사회복지)」)
// 폴더 주소 https://drive.google.com/drive/folders/ 뒤의 ID 부분입니다.
const TARGET_FOLDER_ID = '1LA6KMNOLoPhVf8H1qza6v6voN-U-PfeG';
const FOLDER_NAME = '재택의료 상담기록'; // TARGET_FOLDER_ID를 비워두면 이 이름으로 새 폴더를 만듦
const SHEET_FILE_NAME = '재택의료 방문상담 기록부';
const SHEET_NAME = '방문기록';
const BASE_HEADERS = ['기록ID', '전송시각', '작성자', '구글계정'];
const LINK_HEADER = '방문기록지';
const DOC_TITLE = '재택의료 방문기록지';
const CREATE_DOC = true; // 방문 건별 방문기록지(구글 문서)가 필요 없으면 false

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** 처음 한 번 편집기에서 실행: 권한 승인 + 드라이브 폴더/시트 생성 */
function setup() {
  const { folder, ss } = ensureStorage_();
  Logger.log('저장 폴더: ' + folder.getUrl());
  Logger.log('기록 시트: ' + ss.getUrl());
}

/** 화면을 열 때 환자 목록(지난 기록 포함)과 저장 위치를 돌려줌 */
function getInitData() {
  const { folder, ss } = ensureStorage_();
  const sh = getSheet_(ss);
  const patients = {};
  const lastRow = sh.getLastRow();
  if (lastRow > 1) {
    const values = sh.getRange(1, 1, lastRow, sh.getLastColumn()).getDisplayValues();
    const header = values[0];
    const nameCol = header.indexOf('환자명');
    const birthCol = header.indexOf('생년월일');
    for (let r = 1; r < values.length; r++) {
      const name = nameCol >= 0 ? values[r][nameCol] : '';
      if (!name) continue;
      const birth = birthCol >= 0 ? values[r][birthCol] : '';
      const last = {};
      header.forEach((h, i) => { if (h && values[r][i] !== '') last[h] = values[r][i]; });
      patients[name + '|' + birth] = { name: name, birth: birth, last: last }; // 아래 행일수록 최신
    }
  }
  return {
    patients: Object.keys(patients).map(k => patients[k]),
    sheetUrl: ss.getUrl(),
    folderUrl: folder.getUrl(),
    user: Session.getActiveUser().getEmail() || ''
  };
}

/**
 * 상담 기록 저장.
 * record = { id, author, meta:{patient,birth,date,visitType}, crisis:[...],
 *            sections:[{title, items:[{label, value}]}] }
 */
function saveVisit(record) {
  if (!record || !record.id || !record.meta || !record.meta.patient || !record.meta.date) {
    throw new Error('환자명과 방문일은 꼭 입력해야 합니다.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const { folder, ss } = ensureStorage_();
    const sh = getSheet_(ss);

    // 같은 기록을 다시 보낸 경우(네트워크 재시도) 중복 저장하지 않음
    if (sh.getLastRow() > 1) {
      const found = sh.getRange(2, 1, sh.getLastRow() - 1, 1)
        .createTextFinder(record.id).matchEntireCell(true).findNext();
      if (found) {
        const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
        const linkCol = header.indexOf(LINK_HEADER);
        const docUrl = linkCol >= 0 ? sh.getRange(found.getRow(), linkCol + 1).getDisplayValue() : '';
        return { ok: true, duplicate: true, docUrl: docUrl, sheetUrl: ss.getUrl() };
      }
    }

    const docUrl = CREATE_DOC ? createDoc_(folder, record) : '';
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

    const data = {};
    data['기록ID'] = record.id;
    data['전송시각'] = now;
    data['작성자'] = record.author || '';
    data['구글계정'] = Session.getActiveUser().getEmail() || '';
    (record.sections || []).forEach(sec => {
      (sec.items || []).forEach(it => { data[it.label] = it.value || ''; });
    });
    data[LINK_HEADER] = docUrl;

    const header = ensureHeaders_(sh, Object.keys(data));
    const row = header.map(h => safeCell_(data[h]));
    const target = sh.getRange(sh.getLastRow() + 1, 1, 1, row.length);
    target.setNumberFormat('@').setValues([row]);
    return { ok: true, docUrl: docUrl, sheetUrl: ss.getUrl() };
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- 내부 함수 ---------------- */

function ensureStorage_() {
  const props = PropertiesService.getScriptProperties();
  const folderId = TARGET_FOLDER_ID || props.getProperty('FOLDER_ID');
  const sheetId = props.getProperty('SHEET_ID');
  let folder, ss;

  if (folderId) {
    try { folder = DriveApp.getFolderById(folderId); }
    catch (e) { throw new Error('방문기록지 폴더에 접근할 수 없습니다. 폴더 주인에게 편집자 공유를 요청하세요.'); }
  } else {
    folder = DriveApp.createFolder(FOLDER_NAME);
    props.setProperty('FOLDER_ID', folder.getId());
  }

  if (sheetId) {
    try { ss = SpreadsheetApp.openById(sheetId); }
    catch (e) { throw new Error('기록 시트에 접근할 수 없습니다. 관리자에게 공유를 요청하세요.'); }
  } else {
    ss = SpreadsheetApp.create(SHEET_FILE_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    ss.getSheets()[0].setName(SHEET_NAME);
    props.setProperty('SHEET_ID', ss.getId());
  }
  return { folder: folder, ss: ss };
}

function getSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, BASE_HEADERS.length).setValues([BASE_HEADERS]);
    sh.setFrozenRows(1);
    sh.getRange('1:1').setFontWeight('bold').setBackground('#e8f0fe');
  }
  return sh;
}

/** 체크리스트 항목이 바뀌어도 새 열을 자동으로 추가 (상담기록지 링크는 항상 맨 끝 쪽) */
function ensureHeaders_(sh, keys) {
  const lastCol = sh.getLastColumn();
  const header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const missing = keys.filter(k => header.indexOf(k) < 0);
  if (missing.length) {
    sh.getRange(1, lastCol + 1, 1, missing.length).setValues([missing])
      .setFontWeight('bold').setBackground('#e8f0fe');
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

/** 방문 건별 방문기록지(구글 문서)를 지정 폴더에 만듦: 방문기록지_환자명_작성자_날짜 */
function createDoc_(folder, record) {
  const m = record.meta;
  const v = {};
  (record.sections || []).forEach(sec => (sec.items || []).forEach(it => { v[it.label] = it.value || ''; }));
  const birth = m.birth || v['생년월일'] || '';
  const clean = t => String(t || '').replace(/[\\/:*?"<>|_]/g, ' ').trim();
  const name = ['방문기록지', clean(m.patient), clean(record.author) || '작성자미상', m.date].join('_');

  const doc = DocumentApp.create(name);
  const body = doc.getBody();
  body.setMarginTop(36).setMarginBottom(36).setMarginLeft(44).setMarginRight(44);

  body.getParagraphs()[0].setText(DOC_TITLE).setHeading(DocumentApp.ParagraphHeading.TITLE)
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  // 머리 표: 인적사항
  const head = body.appendTable([
    ['환자명', m.patient, '생년월일', birth],
    ['방문일', m.date, '방문유형', m.visitType || ''],
    ['장기요양등급', v['장기요양등급'] || '', '장기요양기관', v['장기요양기관명'] || '']
  ]);
  head.setBorderColor('#9aa0a6');
  for (let r = 0; r < head.getNumRows(); r++) {
    [0, 2].forEach(c => head.getRow(r).getCell(c).setBackgroundColor('#f1f3f4').editAsText().setBold(true));
  }

  if (record.crisis && record.crisis.length) {
    body.appendParagraph('⚠ 위기신호: ' + record.crisis.join(', '))
      .setBold(true).setForegroundColor('#c5221f');
  }

  const inHead = ['환자명', '생년월일', '방문일', '방문유형', '장기요양등급', '장기요양기관명', '작성자'];
  (record.sections || []).forEach(sec => {
    const rows = (sec.items || []).filter(it => it.value && inHead.indexOf(it.label) < 0)
      .map(it => [it.label, String(it.value)]);
    if (!rows.length) return;
    body.appendParagraph('■ ' + sec.title).setHeading(DocumentApp.ParagraphHeading.HEADING3);
    const table = body.appendTable(rows);
    table.setBorderColor('#9aa0a6');
    for (let i = 0; i < table.getNumRows(); i++) {
      table.getRow(i).getCell(0).setWidth(110).setBackgroundColor('#f1f3f4').editAsText().setBold(true);
    }
  });

  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  body.appendParagraph('');
  body.appendParagraph('작성일시: ' + now + '        작성자: ' + (record.author || '') + '  (서명)')
    .setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  doc.saveAndClose();

  DriveApp.getFileById(doc.getId()).moveTo(folder);
  return doc.getUrl();
}
