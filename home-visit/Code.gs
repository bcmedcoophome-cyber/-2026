/**
 * 재택의료 사회복지 방문상담 체크리스트 — Google Apps Script 서버 코드
 *
 * 휴대폰에서 체크한 상담 내용을 받아
 *   1) [저장] 시 구글 시트(방문기록)에 '임시저장'으로 기록하고
 *   2) [전송] 시 같은 줄을 '전송완료'로 바꾸고, 방문 건마다 구글 문서 「방문기록지_환자명_작성자_날짜」를
 *      지정한 드라이브 폴더 안의 작성자별/월별 폴더(예: 김민정/2026-10)에 만듭니다.
 *
 * 설치 방법은 같은 폴더의 README.md를 보세요.
 */

const APP_TITLE = '재택의료 사회복지 상담기록';
const APP_VERSION = '2026-10-18'; // 휴대폰 화면 아래에 표시됨: 이 날짜가 보이면 최신 코드
// 방문기록지를 저장할 구글 드라이브 폴더 (「환자별 방문기록지 (사회복지)」)
// 폴더 주소 https://drive.google.com/drive/folders/ 뒤의 ID 부분입니다.
const TARGET_FOLDER_ID = '1LA6KMNOLoPhVf8H1qza6v6voN-U-PfeG';
const FOLDER_NAME = '재택의료 상담기록'; // TARGET_FOLDER_ID를 비워두면 이 이름으로 새 폴더를 만듦
const SHEET_FILE_NAME = '재택의료 방문상담 기록부';
const SHEET_NAME = '방문기록';
const BASE_HEADERS = ['기록ID', '전송시각', '작성자', '구글계정', '상태'];
const STATUS_HEADER = '상태';
const STATUS_DRAFT = '임시저장';
const STATUS_SENT = '전송완료';
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
    user: Session.getActiveUser().getEmail() || '',
    version: APP_VERSION
  };
}

/**
 * [저장] 버튼: 시트에 '임시저장' 상태로 기록 (같은 기록은 같은 줄을 덮어씀, 문서는 만들지 않음)
 * record = { id, author, meta:{patient,birth,date,visitType}, crisis:[...],
 *            sections:[{title, items:[{label, value}]}] }
 */
function saveDraft(record) {
  return upsertVisit_(record, false);
}

/** [전송] 버튼: 방문기록지 문서를 만들고 같은 줄을 '전송완료'로 바꿈 */
function saveVisit(record) {
  return upsertVisit_(record, true);
}

function upsertVisit_(record, final) {
  if (!record || !record.id || !record.meta || !record.meta.patient || !record.meta.date) {
    throw new Error('환자명과 방문일은 꼭 입력해야 합니다.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const { folder, ss } = ensureStorage_();
    const sh = getSheet_(ss);

    // 이미 있는 기록(저장했던 기록, 또는 네트워크 재시도)은 같은 줄을 찾아 갱신
    let rowNo = 0;
    if (sh.getLastRow() > 1) {
      const found = sh.getRange(2, 1, sh.getLastRow() - 1, 1)
        .createTextFinder(record.id).matchEntireCell(true).findNext();
      if (found) rowNo = found.getRow();
    }
    if (rowNo) {
      const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      const cell = name => header.indexOf(name) >= 0 ? sh.getRange(rowNo, header.indexOf(name) + 1).getDisplayValue() : '';
      if (cell(STATUS_HEADER) === STATUS_SENT) {
        // 이미 전송 완료된 기록: 중복 문서를 만들지 않음
        return { ok: true, duplicate: true, docUrl: cell(LINK_HEADER), sheetUrl: ss.getUrl() };
      }
    }

    const docUrl = final && CREATE_DOC ? createDoc_(folder, record) : '';
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

    const data = {};
    data['기록ID'] = record.id;
    data['전송시각'] = now;
    data['작성자'] = record.author || '';
    data['구글계정'] = Session.getActiveUser().getEmail() || '';
    data[STATUS_HEADER] = final ? STATUS_SENT : STATUS_DRAFT;
    (record.sections || []).forEach(sec => {
      (sec.items || []).forEach(it => { data[it.label] = it.value || ''; });
    });
    data[LINK_HEADER] = docUrl;

    const header = ensureHeaders_(sh, Object.keys(data));
    const row = header.map(h => safeCell_(data[h]));
    const target = sh.getRange(rowNo || sh.getLastRow() + 1, 1, 1, row.length);
    target.setNumberFormat('@').setValues([row]);
    return { ok: true, docUrl: docUrl, sheetUrl: ss.getUrl(), status: data[STATUS_HEADER] };
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

/** 하위 폴더를 이름으로 찾고, 없으면 만듦 */
function getSubFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/**
 * 방문기록지(구글 문서)를 작성자별·월별 폴더에 만듦
 *   지정 폴더 / 김민정 / 2026-10 / 방문기록지_환자명_작성자_날짜
 */
function createDoc_(folder, record) {
  const m = record.meta;
  const v = {};
  (record.sections || []).forEach(sec => (sec.items || []).forEach(it => { v[it.label] = it.value || ''; }));
  const birth = m.birth || v['생년월일'] || '';
  const clean = t => String(t || '').replace(/[\\/:*?"<>|_]/g, ' ').trim();
  const name = ['방문기록지', clean(m.patient), clean(record.author) || '작성자미상', m.date].join('_');

  const doc = DocumentApp.create(name);
  try {
    const body = doc.getBody();
    body.setMarginTop(36);
    body.setMarginBottom(36);
    body.setMarginLeft(44);
    body.setMarginRight(44);

    // 주의: Paragraph.setText()는 아무것도 돌려주지 않으므로 이어 쓰지(체이닝) 않음
    const title = body.getParagraphs()[0];
    title.setText(DOC_TITLE);
    title.setHeading(DocumentApp.ParagraphHeading.TITLE);
    title.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    // 머리 표: 인적사항
    const head = body.appendTable([
      ['환자명', m.patient, '생년월일', birth],
      ['방문일', m.date, '방문유형', m.visitType || ''],
      ['장기요양등급', v['장기요양등급'] || '', '장기요양기관', v['장기요양기관명'] || ''],
      ['장애정도', v['장애정도'] || '', '장애유형', v['장애유형'] || '']
    ]);
    head.setBorderColor('#9aa0a6');
    for (let r = 0; r < head.getNumRows(); r++) {
      [0, 2].forEach(c => styleLabelCell_(head.getRow(r).getCell(c)));
    }

    if (record.crisis && record.crisis.length) {
      const warn = body.appendParagraph('⚠ 위기신호: ' + record.crisis.join(', '));
      warn.editAsText().setBold(true);
      warn.editAsText().setForegroundColor('#c5221f');
    }

    const inHead = ['환자명', '생년월일', '방문일', '방문유형', '장기요양등급', '장기요양기관명', '장애정도', '장애유형', '작성자'];
    (record.sections || []).forEach(sec => {
      const rows = (sec.items || []).filter(it => it.value && inHead.indexOf(it.label) < 0)
        .map(it => [it.label, String(it.value)]);
      if (!rows.length) return;
      const h = body.appendParagraph('■ ' + sec.title);
      h.setHeading(DocumentApp.ParagraphHeading.HEADING3);
      const table = body.appendTable(rows);
      table.setBorderColor('#9aa0a6');
      for (let i = 0; i < table.getNumRows(); i++) {
        const cell = table.getRow(i).getCell(0);
        cell.setWidth(110);
        styleLabelCell_(cell);
      }
    });

    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    body.appendParagraph('');
    const sign = body.appendParagraph('작성일시: ' + now + '        작성자: ' + (record.author || '') + '  (서명)');
    sign.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
    doc.saveAndClose();

    const authorFolder = getSubFolder_(folder, clean(record.author) || '작성자미상');
    const monthFolder = getSubFolder_(authorFolder, String(m.date).slice(0, 7));
    DriveApp.getFileById(doc.getId()).moveTo(monthFolder);
  } catch (e) {
    // 실패하면 빈 문서가 내 드라이브에 남지 않도록 휴지통으로
    try { DriveApp.getFileById(doc.getId()).setTrashed(true); } catch (e2) {}
    throw e;
  }
  return doc.getUrl();
}

function styleLabelCell_(cell) {
  cell.setBackgroundColor('#f1f3f4');
  cell.editAsText().setBold(true);
}

/* =====================================================================
 *  동의서 — 「장기요양 재택의료센터 시범사업」 신청서 및 개인정보 수집·이용 및 제공 동의서(공단용)
 *  저장 위치: 지정 폴더 / 동의서 / YYYY-MM / 동의서_성명_YYYY-MM-DD.pdf
 *  시트: 같은 기록부의 '동의서' 탭에 한 줄씩
 * ===================================================================== */
const CONSENT_SHEET = '동의서';
const CONSENT_FOLDER = '동의서';
const CONSENT_TITLE = '「장기요양 재택의료센터 시범사업」 참여를 위한\n신청서 및 개인정보 수집·이용 및 제공 동의서 (공단용)';

function saveConsent(c) {
  if (!c || !c.id || !c.person || !c.person.name) throw new Error('성명을 입력해 주세요.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const { folder, ss } = ensureStorage_();
    let sh = ss.getSheetByName(CONSENT_SHEET);
    if (!sh) {
      sh = ss.insertSheet(CONSENT_SHEET);
      sh.getRange(1, 1, 1, 4).setValues([['기록ID', '전송시각', '담당자', '구글계정']]);
      sh.setFrozenRows(1);
      sh.getRange('1:1').setFontWeight('bold').setBackground('#e8f0fe');
    }
    // 같은 동의서를 다시 보낸 경우 중복 저장하지 않음
    if (sh.getLastRow() > 1) {
      const found = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(c.id).matchEntireCell(true).findNext();
      if (found) {
        const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
        const col = header.indexOf('동의서PDF');
        return { ok: true, duplicate: true, pdfUrl: col >= 0 ? sh.getRange(found.getRow(), col + 1).getDisplayValue() : '' };
      }
    }

    const pdfUrl = createConsentPdf_(folder, c);
    const p = c.person, px = c.proxy;
    const data = {
      '기록ID': c.id,
      '전송시각': Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
      '담당자': c.staff || '',
      '구글계정': Session.getActiveUser().getEmail() || '',
      '서식': (c.form && c.form.label) || '공단용',
      '동의일': c.date, '성명': p.name, '생년월일': p.birth, '장기요양인정번호': p.ltcNo,
      '연락처': p.phone, '주소(주민등록지)': p.addr, '실제 거주지': p.addr2
    };
    (c.self || []).forEach(it => { data['본인 ' + it.title.replace(/^\d+\.\s*/, '').replace(/\s*내역$/, '')] = it.answer || ''; });
    data['대리인 작성'] = px ? '예' : '아니오';
    data['대리인 성명'] = px ? px.name : '';
    data['대리인 연락처'] = px ? px.phone : '';
    data['신청인과의 관계'] = px ? px.relation : '';
    ((px && px.items) || []).forEach(it => { data['대리인 ' + it.title.replace(/^\d+\.\s*/, '').replace(/\s*내역$/, '')] = it.answer || ''; });
    data['행정정보 공동이용'] = px ? (px.admin || '') : '';
    data['동의서PDF'] = pdfUrl;

    const header = ensureHeaders_(sh, Object.keys(data));
    const row = header.map(h => safeCell_(data[h]));
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    return { ok: true, pdfUrl: pdfUrl };
  } finally {
    lock.releaseLock();
  }
}

function sigBlob_(dataUrl, name) {
  const m = String(dataUrl || '').match(/^data:image\/png;base64,(.+)$/);
  return m ? Utilities.newBlob(Utilities.base64Decode(m[1]), 'image/png', name) : null;
}

function para_(body, text, opt) {
  opt = opt || {};
  const p = body.appendParagraph(text);
  if (opt.heading) p.setHeading(opt.heading);
  if (opt.align) p.setAlignment(opt.align);
  const t = p.editAsText();
  if (opt.bold) t.setBold(true);
  if (opt.size) t.setFontSize(opt.size);
  if (opt.color) t.setForegroundColor(opt.color);
  return p;
}

/** 서명 줄: "본인 성명  홍길동  [서명 이미지]  (서명 또는 인)" */
function signLine_(body, label, name, dataUrl) {
  const p = body.appendParagraph(label + '   ' + name + '   ');
  p.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  p.editAsText().setBold(true);
  const blob = sigBlob_(dataUrl, 'sign.png');
  if (blob) {
    const img = p.appendInlineImage(blob);
    const w = 150;
    img.setWidth(w);
    img.setHeight(Math.round(w * img.getHeight() / img.getWidth()));
  }
  p.appendText('  (서명 또는 인)');
}

function consentItems_(body, items) {
  // 서식처럼 [내 역 | 확인(√ 체크)] 표
  const rows = [['내                    역', '확 인\n(√ 체크)']];
  items.forEach(it => {
    const yes = it.answer === '동의함';
    rows.push([it.title + '\n' + it.lines.join('\n'), (yes ? '☑' : '☐') + '\n동의함\n\n' + (yes ? '☐' : '☑') + '\n동의안함']);
  });
  const t = body.appendTable(rows);
  t.setBorderColor('#5f6368');
  const head = t.getRow(0);
  [0, 1].forEach(k => {
    const cell = head.getCell(k);
    cell.setBackgroundColor('#dfe9f7');
    cell.editAsText().setBold(true).setFontSize(10);
    cell.getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  });
  for (let r = 1; r < t.getNumRows(); r++) {
    const left = t.getRow(r).getCell(0), right = t.getRow(r).getCell(1);
    left.editAsText().setFontSize(9);
    left.getChild(0).asParagraph().editAsText().setBold(true);
    right.setWidth(70);
    right.editAsText().setFontSize(10).setBold(true);
    right.getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    const yes = items[r - 1].answer === '동의함';
    right.editAsText().setForegroundColor(yes ? '#188038' : '#c5221f');
  }
  head.getCell(1).setWidth(70);
}

function labelTable_(body, rows, labelCols) {
  const t = body.appendTable(rows);
  t.setBorderColor('#5f6368');
  for (let r = 0; r < t.getNumRows(); r++) {
    labelCols.forEach(k => { if (k < t.getRow(r).getNumCells()) styleLabelCell_(t.getRow(r).getCell(k)); });
  }
  return t;
}

/** 휴대폰에서 원본 서식 위에 찍어 보낸 페이지 이미지들로 PDF를 만듦 */
function createImagePdf_(folder, c, name) {
  const doc = DocumentApp.create(name);
  try {
    const body = doc.getBody();
    body.setPageWidth(595.3);
    body.setPageHeight(841.9);
    body.setMarginTop(0);
    body.setMarginBottom(0);
    body.setMarginLeft(0);
    body.setMarginRight(0);
    c.pages.forEach((url, i) => {
      const m = String(url).match(/^data:image\/(jpeg|png);base64,(.+)$/);
      if (!m) throw new Error('서식 이미지가 올바르지 않습니다.');
      const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), 'image/' + m[1], 'page' + (i + 1) + '.' + (m[1] === 'png' ? 'png' : 'jpg'));
      const para = i === 0 ? body.getParagraphs()[0] : body.appendParagraph('');
      para.setSpacingBefore(0);
      para.setSpacingAfter(0);
      para.setLineSpacing(1);
      const img = para.appendInlineImage(blob);
      img.setWidth(594);
      img.setHeight(840);
    });
    doc.saveAndClose();
    const monthFolder = getSubFolder_(getSubFolder_(folder, CONSENT_FOLDER), String(c.date).slice(0, 7));
    const pdf = monthFolder.createFile(DriveApp.getFileById(doc.getId()).getAs('application/pdf'));
    pdf.setName(name + '.pdf');
    DriveApp.getFileById(doc.getId()).setTrashed(true);
    return pdf.getUrl();
  } catch (e) {
    try { DriveApp.getFileById(doc.getId()).setTrashed(true); } catch (e2) {}
    throw e;
  }
}

function createConsentPdf_(folder, c) {
  const p = c.person, px = c.proxy, f = c.form || {};
  if (c.pages && c.pages.length) {
    const cl = t => String(t || '').replace(/[\\/:*?"<>|_]/g, ' ').trim();
    return createImagePdf_(folder, c, ['동의서(' + (f.label || '공단용') + ')', cl(p.name), c.date].join('_'));
  }
  const clean = t => String(t || '').replace(/[\\/:*?"<>|_]/g, ' ').trim();
  const name = ['동의서(' + (f.label || '공단용') + ')', clean(p.name), c.date].join('_');
  const doc = DocumentApp.create(name);
  try {
    const body = doc.getBody();
    body.setMarginTop(32);
    body.setMarginBottom(32);
    body.setMarginLeft(40);
    body.setMarginRight(40);
    const H = DocumentApp.ParagraphHeading, A = DocumentApp.HorizontalAlignment;
    const ymd = String(c.date).split('-');
    const dateText = ymd[0] + ' 년  ' + ymd[1] + ' 월  ' + ymd[2] + ' 일';

    const first = body.getParagraphs()[0];
    first.setText(f.no || '[별지 제1호 서식]');
    first.editAsText().setFontSize(8);
    const titleTable = body.appendTable([[f.title || CONSENT_TITLE]]);
    titleTable.setBorderColor('#000000');
    const tc = titleTable.getRow(0).getCell(0);
    tc.editAsText().setBold(true).setFontSize(15);
    tc.getChild(0).asParagraph().setAlignment(A.CENTER);

    para_(body, '[ 신청서 ]', { heading: H.HEADING2 });
    labelTable_(body, [
      ['성명', p.name, '장기요양인정번호', p.ltcNo || 'L'],
      ['생년월일', p.birth, '연락처', p.phone || ''],
      ['주소 (주민등록지)', p.addr || '', '실제 거주지', p.addr2 || '']
    ], [0, 2]);
    para_(body, '※ 실제 거주지는 주민등록지와 동일한 경우에는 적지 않습니다.', { size: 8 });
    para_(body, '※ 본 사업은 거동이 불편하여 병원 등 의료서비스 이용이 어려운 분에게 월 1회 방문진료, 월 2회 방문간호를 기본 제공하고 지역 내 복지 서비스를 연계해주는 사업으로 본인부담금이 일부 발생합니다.', { size: 9 });

    para_(body, '□ 시범사업 서비스 제공 사항', { bold: true });
    labelTable_(body, [
      ['포괄평가', '질병 등 건강문제와 사회·환경적 문제 등 포괄적으로 평가'],
      ['케어플랜', '포괄평가 후 효율적인 질환 관리 및 돌봄 가능하도록 계획 수립'],
      ['직종별 서비스', '방문진료: 의사가 방문하여 진찰, 처방, 검사, 상담 등을 제공\n방문간호: 간호사가 방문하여 진료보조, 교육·상담, 투약지도 등을 제공\n정기상담: 사회복지사가 방문 또는 유선으로 상담 및 욕구 파악'],
      ['지역사회 자원연계', '지역 내 장기요양기관, 지자체, 복지관 등의 요양·돌봄 서비스 연계']
    ], [0]).editAsText().setFontSize(9);

    para_(body, f.section || '[ 개인정보 수집·이용 및 제공 동의서 ]', { heading: H.HEADING2 });
    if (f.intro) para_(body, f.intro, { size: 9 });
    consentItems_(body, c.self || []);
    para_(body, dateText, { align: A.RIGHT, bold: true });
    signLine_(body, '본인 성명', p.name, c.selfSig);
    para_(body, f.addressee || '국민건강보험공단 귀중', { bold: true, size: 13 });

    if (px) {
      body.appendPageBreak();
      para_(body, f.proxySection || '[ 대리인의 개인정보 수집·이용 및 제공 동의서 ]', { heading: H.HEADING2 });
      para_(body, f.proxyNote || '', { size: 9, bold: true });
      labelTable_(body, [['대리인(가족) 성명', px.name, '연락처', px.phone || ''], ['신청인과의 관계', px.relation || '', '', '']], [0, 2]);
      consentItems_(body, px.items || []);
      para_(body, dateText, { align: A.RIGHT, bold: true });
      signLine_(body, '대리인 성명', px.name, px.sig);
      para_(body, '- 주민등록번호, 외국인등록번호는 국민건강보험법 시행령 제81조(민감정보 및 고유식별 정보의 처리), 노인장기요양법 시행령 제28조의3(민감정보 및 고유식별정보의 처리)등에 따라 처리합니다.', { size: 8 });
      para_(body, '- 대리인의 범위는 노인장기요양보험법 제22조(장기요양인정 신청 등에 대한 대리) 및 민법 제779조(가족의 범위)에 따른 가족으로서 배우자, 직계혈족 및 형제자매, 생계를 같이하는 직계혈족의 배우자, 생계를 같이하는 배우자의 직계혈족 및 배우자의 형제자매를 뜻하며 신청 시 대리인 신분증 확인 및 위임장 제출이 필요합니다.', { size: 8 });
      if (f.methodTable) {
        const mt = body.appendTable([
          ['신청방법', '신청자', '증빙서류 확인방법'],
          ['지사방문(내방)', '신청인(본인)', '- 신청인의 신분증 제시'],
          ['지사방문(내방)', '대리인(가족)', '- 신청인 및 대리인(가족)의 신분증 제시\n- 신청인(본인)의 개인정보 수집·이용·제3자 제공 동의에 대한 위임장'],
          ['우편접수', '신청인(본인)', '- 신청인의 신분증 사본 제출'],
          ['우편접수', '대리인(가족)', '- 신청인 및 대리인(가족)의 신분증 사본 제출\n- 신청인(본인)의 개인정보 수집·이용·제3자 제공 동의에 대한 위임장']
        ]);
        mt.setBorderColor('#5f6368');
        mt.editAsText().setFontSize(8);
        [0, 1, 2].forEach(k => styleLabelCell_(mt.getRow(0).getCell(k)));
        para_(body, '- 대리인(가족)이 신청서 및 개인정보 수집·이용·제3자 제공 동의서를 작성할 경우에만 대리인의 정보를 수집·이용·제3자 제공합니다.', { size: 8 });
      }

      if (px.adminText) {
        para_(body, '행정정보 공동이용 동의서', { heading: H.HEADING2, align: A.CENTER });
        para_(body, px.adminText);
        const ok = px.admin === '동의함';
        para_(body, (ok ? '☑' : '☐') + ' 동의함     ' + (ok ? '☐' : '☑') + ' 동의안함', { bold: true, color: ok ? '#188038' : '#c5221f' });
        para_(body, px.adminNote || '', { size: 9 });
        signLine_(body, '대리인 성명', px.name, px.adminSig);
      }
      para_(body, f.addressee || '국민건강보험공단 귀중', { bold: true, size: 13 });
    }

    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    para_(body, '전자 서명 접수: ' + now + ' · 담당자 ' + (c.staff || ''), { size: 8, color: '#5f6368' });
    doc.saveAndClose();

    const monthFolder = getSubFolder_(getSubFolder_(folder, CONSENT_FOLDER), String(c.date).slice(0, 7));
    const pdf = monthFolder.createFile(DriveApp.getFileById(doc.getId()).getAs('application/pdf'));
    pdf.setName(name + '.pdf');
    DriveApp.getFileById(doc.getId()).setTrashed(true); // PDF만 남김
    return pdf.getUrl();
  } catch (e) {
    try { DriveApp.getFileById(doc.getId()).setTrashed(true); } catch (e2) {}
    throw e;
  }
}
