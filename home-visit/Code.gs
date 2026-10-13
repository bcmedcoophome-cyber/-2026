/**
 * 재택의료 사회복지 방문상담 체크리스트 — Google Apps Script 서버 코드
 *
 * 휴대폰에서 체크한 상담 내용을 받아
 *   1) 구글 시트(방문기록)에 한 줄씩 누적하고
 *   2) 방문 건마다 구글 문서(상담기록지)를 월별 폴더에 만듭니다.
 *
 * 설치 방법은 같은 폴더의 README.md를 보세요.
 */

const APP_TITLE = '재택의료 사회복지 상담기록';
const FOLDER_NAME = '재택의료 상담기록';
const SHEET_FILE_NAME = '재택의료 방문상담 기록부';
const SHEET_NAME = '방문기록';
const BASE_HEADERS = ['기록ID', '전송시각', '작성자', '구글계정'];
const LINK_HEADER = '상담기록지';
const CREATE_DOC = true; // 방문 건별 구글 문서가 필요 없으면 false

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
    const pidCol = header.indexOf('환자번호');
    for (let r = 1; r < values.length; r++) {
      const name = nameCol >= 0 ? values[r][nameCol] : '';
      if (!name) continue;
      const pid = pidCol >= 0 ? values[r][pidCol] : '';
      const last = {};
      header.forEach((h, i) => { if (h && values[r][i] !== '') last[h] = values[r][i]; });
      patients[name + '|' + pid] = { name: name, pid: pid, last: last }; // 아래 행일수록 최신
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
 * record = { id, author, meta:{patient,date,visitType}, crisis:[...],
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
  const folderId = props.getProperty('FOLDER_ID');
  const sheetId = props.getProperty('SHEET_ID');
  let folder, ss;

  if (folderId) {
    try { folder = DriveApp.getFolderById(folderId); }
    catch (e) { throw new Error('기록 폴더에 접근할 수 없습니다. 관리자에게 "' + FOLDER_NAME + '" 폴더 공유(편집자)를 요청하세요.'); }
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

function getSubFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function createDoc_(folder, record) {
  const m = record.meta;
  const sub = getSubFolder_(folder, String(m.date).slice(0, 7));
  const name = [m.date, m.patient, m.visitType || '방문'].join('_');
  const doc = DocumentApp.create(name);
  const body = doc.getBody();
  body.setMarginTop(40).setMarginBottom(40).setMarginLeft(48).setMarginRight(48);

  body.getParagraphs()[0].setText(APP_TITLE).setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(m.patient + '  |  ' + m.date + '  |  ' + (m.visitType || ''))
    .setHeading(DocumentApp.ParagraphHeading.SUBTITLE);

  if (record.crisis && record.crisis.length) {
    body.appendParagraph('⚠ 위기신호: ' + record.crisis.join(', '))
      .setBold(true).setForegroundColor('#c5221f');
  }

  (record.sections || []).forEach(sec => {
    const rows = (sec.items || []).filter(it => it.value).map(it => [it.label, String(it.value)]);
    if (!rows.length) return;
    body.appendParagraph(sec.title).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    const table = body.appendTable(rows);
    table.setBorderColor('#dadce0');
    for (let i = 0; i < table.getNumRows(); i++) {
      const c = table.getRow(i).getCell(0);
      c.setWidth(120).setBackgroundColor('#f1f3f4');
      c.editAsText().setBold(true);
    }
  });

  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  body.appendParagraph('작성자: ' + (record.author || '') + '   ·   전송: ' + now)
    .setForegroundColor('#5f6368').setFontSize(9);
  doc.saveAndClose();

  DriveApp.getFileById(doc.getId()).moveTo(sub);
  return doc.getUrl();
}
