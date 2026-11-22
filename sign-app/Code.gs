/**
 * 문자서명 — 문자로 보낸 링크에서 "서명만" 받는 작은 앱
 *  - 이 앱은 개인정보를 읽지도 보여 주지도 않습니다. (이름·생년월일·전화번호 없음)
 *  - 받은 서명 그림은 방문기록지 폴더 안 「문자서명」 폴더에 "<링크번호>.png"로만 저장됩니다.
 *  - 방문기록지 앱이 그 링크번호로 서명을 찾아 동의서 서명란에 넣습니다.
 *  - 링크는 3일 뒤 만료되고, 한 번 서명하면 다시 쓸 수 없습니다.
 */
const TARGET_FOLDER_ID = '1LA6KMNOLoPhVf8H1qza6v6voN-U-PfeG'; // 방문기록지와 같은 폴더
const SIGN_FOLDER_NAME = '문자서명';
const MAX_DAYS = 3;
const FORM_NAMES = {
  primary: '「일차의료 방문진료 수가 시범사업」 참여 및 개인정보 수집·이용·제3자 제공 동의서',
  disabled: '「장애인 건강 주치의 시범사업」 참여 및 개인정보 수집·이용·제3자 제공 동의서',
  nhis: '「장기요양 재택의료센터 시범사업」 신청서 및 개인정보 수집·이용 및 제공 동의서',
  clinic: '「장기요양 재택의료센터 시범사업」 신청서 및 개인정보 수집·이용·제3자 제공 동의서'
};

/** 처음 한 번 실행: 폴더 확인·권한 승인 */
function setup() {
  Logger.log('서명 저장 폴더: ' + signFolder_().getUrl());
}

function signFolder_() {
  const parent = DriveApp.getFolderById(TARGET_FOLDER_ID);
  const it = parent.getFoldersByName(SIGN_FOLDER_NAME);
  return it.hasNext() ? it.next() : parent.createFolder(SIGN_FOLDER_NAME);
}

/** 링크번호: 무작위 24자리 + '-' + 만든 시각(36진수) */
function tokenOk_(t) {
  const m = /^([a-f0-9]{24})-([a-z0-9]{6,12})$/.exec(String(t || ''));
  if (!m) return false;
  const ts = parseInt(m[2], 36), now = Date.now();
  return ts > 0 && now - ts < MAX_DAYS * 864e5 && ts - now < 864e5;
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  const t = String(p.t || '');
  let state = 'ok';
  if (!tokenOk_(t)) state = 'bad';
  else if (signFolder_().getFilesByName(t + '.png').hasNext()) state = 'done';
  return HtmlService.createHtmlOutput(page_(t, FORM_NAMES[p.f] || '동의서', state))
    .setTitle('동의서 서명')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

/** 서명 받기 (서명 그림만) */
function submitSign(t, dataUrl) {
  if (!tokenOk_(t)) throw new Error('링크가 만료되었거나 올바르지 않습니다. 담당자에게 새 링크를 요청해 주세요.');
  const m = /^data:image\/png;base64,([A-Za-z0-9+\/=]+)$/.exec(String(dataUrl || ''));
  if (!m || m[1].length > 800000) throw new Error('서명을 읽을 수 없습니다. 다시 서명해 주세요.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const folder = signFolder_();
    if (folder.getFilesByName(t + '.png').hasNext()) throw new Error('이미 서명이 전달되었습니다.');
    folder.createFile(Utilities.newBlob(Utilities.base64Decode(m[1]), 'image/png', t + '.png'));
  } finally {
    lock.releaseLock();
  }
  return true;
}

function esc_(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* 화면 (주의: 아래 script 안에는 슬래시 두 개를 쓰지 않음 — 구글이 그 뒤를 잘라 버림) */
function page_(t, formName, state) {
  const msg = state === 'bad' ? '링크가 만료되었거나 올바르지 않습니다.<br>담당자에게 새 링크를 요청해 주세요.'
    : state === 'done' ? '이미 서명이 전달되었습니다.<br>감사합니다. 창을 닫으셔도 됩니다.' : '';
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<style>
  *{box-sizing:border-box} body{margin:0;font-family:-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;background:#f3f5f9;color:#1b2333}
  .wrap{max-width:560px;margin:0 auto;padding:18px 14px 28px}
  h1{font-size:20px;margin:6px 0 12px;color:#1f2f57}
  .card{background:#fff;border-radius:14px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:12px}
  p{font-size:16px;line-height:1.55;margin:0 0 8px} .small{font-size:13px;color:#5a6476}
  .pad{position:relative;border:2px dashed #9aa6bd;border-radius:12px;background:#fff;height:220px;touch-action:none}
  canvas{width:100%;height:100%;display:block;border-radius:12px}
  .ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#9aa6bd;font-size:17px;pointer-events:none}
  .row{display:flex;gap:10px;margin-top:12px}
  button{flex:1;font-size:18px;padding:14px;border-radius:12px;border:0;font-weight:700}
  #clear{background:#e7ebf3;color:#1b2333} #send{background:#1f2f57;color:#fff} button:disabled{opacity:.5}
  .msg{font-size:18px;text-align:center;padding:30px 10px;line-height:1.6}
  .err{color:#c62828;font-size:15px;margin-top:10px;min-height:1em}
</style></head><body><div class="wrap">
<h1>동의서 서명</h1>
${msg ? `<div class="card msg">${msg}</div>` : `
<div id="main">
<div class="card">
  <p><b>${esc_(formName)}</b>에 들어갈 서명입니다.</p>
  <p>담당자에게 내용을 설명 들으신 뒤, 아래 칸에 손가락으로 서명해 주세요.</p>
  <p class="small">이 화면에는 개인정보가 표시되지 않으며, 서명은 담당 의료기관에만 전달됩니다.</p>
</div>
<div class="card">
  <div class="pad"><canvas id="cv"></canvas><div class="ph" id="ph">여기에 서명해 주세요</div></div>
  <div class="row"><button id="clear" type="button">지우기</button><button id="send" type="button">서명 보내기</button></div>
  <div class="err" id="err"></div>
</div>
</div>
<div class="card msg" id="ok" hidden>서명이 전달되었습니다.<br>감사합니다. 창을 닫으셔도 됩니다.</div>`}
</div>
${msg ? '' : `<script>
(function () {
  var T = ${JSON.stringify(t)};
  var cv = document.getElementById('cv'), ph = document.getElementById('ph'), g = cv.getContext('2d');
  var drawing = false, last = null, inked = false;
  function fit() {
    var r = cv.getBoundingClientRect();
    cv.width = Math.round(r.width * 2); cv.height = Math.round(r.height * 2);
    g.setTransform(2, 0, 0, 2, 0, 0); g.fillStyle = '#fff'; g.fillRect(0, 0, r.width, r.height);
    g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#111';
    inked = false; ph.hidden = false;
  }
  function pos(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  cv.addEventListener('pointerdown', function (e) { e.preventDefault(); cv.setPointerCapture(e.pointerId); drawing = true; last = pos(e); ph.hidden = true; inked = true;
    g.beginPath(); g.arc(last.x, last.y, 1.4, 0, Math.PI * 2); g.fillStyle = '#111'; g.fill(); });
  cv.addEventListener('pointermove', function (e) { if (!drawing) return; var p = pos(e); g.beginPath(); g.moveTo(last.x, last.y); g.lineTo(p.x, p.y); g.stroke(); last = p; });
  function end() { drawing = false; }
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end); cv.addEventListener('pointerleave', end);
  document.getElementById('clear').addEventListener('click', fit);
  document.getElementById('send').addEventListener('click', function () {
    var err = document.getElementById('err'), btn = this;
    if (!inked) { err.textContent = '서명을 먼저 해 주세요.'; return; }
    err.textContent = ''; btn.disabled = true; btn.textContent = '보내는 중…';
    google.script.run
      .withSuccessHandler(function () { document.getElementById('main').hidden = true; document.getElementById('ok').hidden = false; })
      .withFailureHandler(function (e) { err.textContent = (e && e.message) || '전송하지 못했습니다. 잠시 후 다시 눌러 주세요.'; btn.disabled = false; btn.textContent = '서명 보내기'; })
      .submitSign(T, cv.toDataURL('image/png'));
  });
  window.addEventListener('resize', function () { if (!inked) fit(); });
  fit();
})();
</script>`}
</body></html>`;
}
