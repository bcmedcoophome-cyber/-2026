/**
 * 생애말기활동가기록지 — Google Apps Script 서버 코드
 *
 * 활동가가 휴대폰에서 고른 내용을 받아
 *   1) [저장] 시 구글 시트(활동기록)에 '임시저장'으로 기록하고
 *   2) [전송] 시 같은 줄을 '전송완료'로 바꾸고, 방문 건마다 구글 문서
 *      「생애말기활동가기록지_어르신_활동가_날짜」를 지정 폴더 안의
 *      활동가별/월별 폴더(예: 이명옥/2026-10)에 만듭니다.
 *
 * 설치 방법은 같은 폴더의 README.md를 보세요.
 */

const APP_TITLE = '생애말기 활동기록';
const APP_VERSION = '2026-10-25'; // 휴대폰 화면 아래에 표시됨: 이 날짜가 보이면 최신 코드
// 기록지를 저장할 구글 드라이브 폴더 (「방문기록지」)
// 폴더 주소 https://drive.google.com/drive/folders/ 뒤의 ID 부분입니다.
const TARGET_FOLDER_ID = '10TnjGjVX9ErWWt-uffupolUOcb7M_02_';
const FOLDER_NAME = '생애말기활동가기록지'; // TARGET_FOLDER_ID를 비워두면 이 이름으로 새 폴더를 만듦
const SHEET_FILE_NAME = '생애말기활동가 기록부';
const SHEET_NAME = '활동기록';
const BASE_HEADERS = ['기록ID', '전송시각', '활동가', '팀', '구글계정', '상태'];
const STATUS_HEADER = '상태';
const STATUS_DRAFT = '임시저장';
const STATUS_SENT = '전송완료';
const LINK_HEADER = '기록지';
const DOC_TITLE = '생애말기활동가기록지';
const FILE_PREFIX = '생애말기활동가기록지';
const PROP_SHEET = 'EOL_SHEET_ID';
const PROP_FOLDER = 'EOL_FOLDER_ID';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** 처음 한 번 편집기에서 실행: 권한 승인 + 드라이브 폴더/시트 생성 */
function setup() {
  const { folder, ss } = ensureStorage_();
  getSheet_(ss);
  Logger.log('저장 폴더: ' + folder.getUrl());
  Logger.log('기록 시트: ' + ss.getUrl());
}

/**
 * 화면을 열 때: 어르신 이름 목록(활동가별 최근 방문순)과 버전을 돌려줌
 * elders = [{ name, author, date }]  (아래 행일수록 최신)
 */
function getInitData() {
  const { ss } = ensureStorage_();
  const sh = getSheet_(ss);
  const elders = [];
  const lastRow = sh.getLastRow();
  if (lastRow > 1) {
    const values = sh.getRange(1, 1, lastRow, sh.getLastColumn()).getDisplayValues();
    const header = values[0];
    const nameCol = header.indexOf('어르신 이름');
    const authorCol = header.indexOf('활동가');
    const dateCol = header.indexOf('방문날짜');
    for (let r = 1; r < values.length; r++) {
      const name = nameCol >= 0 ? values[r][nameCol] : '';
      if (!name) continue;
      elders.push({
        name: name,
        author: authorCol >= 0 ? values[r][authorCol] : '',
        date: dateCol >= 0 ? values[r][dateCol] : ''
      });
    }
  }
  return { elders: elders, version: APP_VERSION };
}

/**
 * [저장] 버튼: 시트에 '임시저장'으로 기록 (같은 기록ID는 같은 줄을 덮어씀, 문서는 만들지 않음)
 * record = { id, author, team, meta:{ elder, date }, items:[{ label, value }] }
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
    const sh = getSheet_(ss);

    // 이미 있는 기록(저장했던 기록, 또는 다시 보내기)은 같은 줄을 찾아 갱신
    let rowNo = 0;
    if (sh.getLastRow() > 1) {
      const found = sh.getRange(2, 1, sh.getLastRow() - 1, 1)
        .createTextFinder(String(record.id)).matchEntireCell(true).findNext();
      if (found) rowNo = found.getRow();
    }
    if (rowNo) {
      const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      const cell = name => header.indexOf(name) >= 0 ? sh.getRange(rowNo, header.indexOf(name) + 1).getDisplayValue() : '';
      if (cell(STATUS_HEADER) === STATUS_SENT) {
        // 이미 전송 완료된 기록: 중복 문서를 만들지 않음
        return { ok: true, duplicate: true, docUrl: cell(LINK_HEADER), status: STATUS_SENT };
      }
    }

    const docUrl = final ? createDoc_(folder, record) : '';
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

    const data = {};
    data['기록ID'] = record.id;
    data['전송시각'] = now;
    data['활동가'] = record.author || '';
    data['팀'] = record.team || '';
    data['구글계정'] = Session.getActiveUser().getEmail() || '';
    data[STATUS_HEADER] = final ? STATUS_SENT : STATUS_DRAFT;
    (record.items || []).forEach(it => { if (it && it.label) data[it.label] = it.value || ''; });
    data['방문날짜'] = record.meta.date; // 문서 이름·폴더와 항상 같게
    data['어르신 이름'] = record.meta.elder;
    data[LINK_HEADER] = docUrl;

    const header = ensureHeaders_(sh, Object.keys(data));
    const row = header.map(h => safeCell_(data[h]));
    const target = sh.getRange(rowNo || sh.getLastRow() + 1, 1, 1, row.length);
    target.setNumberFormat('@');
    target.setValues([row]);
    return { ok: true, docUrl: docUrl, status: data[STATUS_HEADER] };
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- 내부 함수 ---------------- */

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
    ss.getSheets()[0].setName(SHEET_NAME);
    props.setProperty(PROP_SHEET, ss.getId());
  }
  return { folder: folder, ss: ss };
}

function getSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    const head = sh.getRange(1, 1, 1, BASE_HEADERS.length);
    head.setValues([BASE_HEADERS]);
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
  const v = {};
  (record.items || []).forEach(it => { if (it && it.label) v[it.label] = it.value || ''; });
  const author = clean_(record.author) || '작성자미상';
  const name = [FILE_PREFIX, clean_(m.elder), author, m.date].join('_');

  const doc = DocumentApp.create(name);
  try {
    const body = doc.getBody();
    body.setMarginTop(40);
    body.setMarginBottom(40);
    body.setMarginLeft(48);
    body.setMarginRight(48);

    // 주의: Paragraph.setText()는 아무것도 돌려주지 않으므로 이어 쓰지(체이닝) 않음
    const title = body.getParagraphs()[0];
    title.setText(DOC_TITLE);
    title.setHeading(DocumentApp.ParagraphHeading.TITLE);
    title.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    const head = body.appendTable([
      ['방문날짜', m.date, '어르신', m.elder],
      ['활동가', record.author || '', '팀', record.team || '']
    ]);
    head.setBorderColor('#9aa0a6');
    for (let r = 0; r < head.getNumRows(); r++) {
      [0, 2].forEach(c => styleLabelCell_(head.getRow(r).getCell(c)));
    }

    const medical = v['의료진 전달사항'] === '있음';
    if (medical) {
      body.appendParagraph('');
      const warn = body.appendParagraph('⚠ 의료진 전달사항 있음: ' + (v['전달 내용'] || '(내용 없음)'));
      warn.editAsText().setBold(true);
      warn.editAsText().setForegroundColor('#c5221f');
    }

    const skip = ['방문날짜', '어르신 이름'];
    const rows = (record.items || [])
      .filter(it => it && it.label && skip.indexOf(it.label) < 0)
      .map(it => [it.label, String(it.value || '-')]);
    if (rows.length) {
      const h = body.appendParagraph('■ 활동 내용');
      h.setHeading(DocumentApp.ParagraphHeading.HEADING3);
      const table = body.appendTable(rows);
      table.setBorderColor('#9aa0a6');
      for (let i = 0; i < table.getNumRows(); i++) {
        const cell = table.getRow(i).getCell(0);
        cell.setWidth(120);
        styleLabelCell_(cell);
        if (medical && rows[i][0] === '의료진 전달사항') {
          table.getRow(i).getCell(1).editAsText().setForegroundColor('#c5221f');
          table.getRow(i).getCell(1).editAsText().setBold(true);
        }
      }
    }

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
