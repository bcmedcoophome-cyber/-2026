/**
 * 건강리더 주의대상 자동 분류
 * ------------------------------------------------------------------
 * 「2026년 건강리더 사업관리」 스프레드시트의
 *   - 2026년 돌봄데이터  (방문 기록: 혈압·혈당·건강체크·통증)
 *   - 돌봄 명단          (질병·가구형태·등급·장애·진행 상태·지역리더)
 *   - 26년 돌봄방법 확인  (질환 및 특이사항)
 * 을 읽어 주의사항 기준에 걸리는 어르신을 「주의대상」 탭에 정리합니다.
 *
 * 설치: 스프레드시트 → 확장 프로그램 → Apps Script → 이 내용 붙여넣기 → 저장
 *       → 함수 `updateAlertSheet` 실행(처음 한 번 권한 승인)
 * 이후: 스프레드시트 상단 메뉴 「주의대상」 → 「새로고침」
 *
 * 판정 기준 (어르신마다 가장 최근 방문 달의 기록으로 판정)
 *   1. 고혈압     : 그 달 측정 혈압 중 수축기가 가장 낮은 값이 140 이상
 *   2. 당뇨       : 그 달 혈당 수치 중 200 이상이 있음
 *   3. 영양상태   : 그 달 ① 하루 2끼 이상 = 아니오 가 있음
 *   7. 심폐질환   : 질병·특이사항에 심장·폐 질환이 있음
 *   8. 위장관질환 : 질병·특이사항에 위장관 질환이 있음
 *   9. 통증       : 최근 방문에 통증 부위가 있고 ⑧ 밤에 숙면 = 아니오 (수면 방해 통증)
 * 시트에 문항이 없어 제외: 4.낙상, 5.치매, 6.우울증, 10.일상생활 추가 도움,
 *   세부 문항 중 건강검진·음주·흡연·MMSE·CES/GDS·치아·입맛·체중·하지근력 등
 * ------------------------------------------------------------------
 */

const ALERT_CONFIG = {
  outputSheet: '주의대상',
  careSheet: '2026년 돌봄데이터',
  rosterSheet: '돌봄 명단',
  methodSheet: '26년 돌봄방법 확인',
  systolicLimit: 140,
  systolicSevere: 160,
  glucoseLimit: 200,
  glucoseSevere: 300,
  excludeClosed: true // 돌봄 명단에서 '종결'인 분은 제외
};

// 질병·특이사항 글에서 찾는 단어
const KEYWORDS = {
  hypertension: ['고혈압', '혈압'],
  diabetes: ['당뇨'],
  depression: ['우울'],
  cardioPulmonary: ['심부전', '협심증', '심장', '심근', '부정맥', '스텐트', '스탠트', '허혈성', '심혈관', '판막',
    '폐', '기관지', '천식', 'COPD', '만성폐쇄성', '호흡'],
  gastro: ['위염', '위장', '위궤양', '위암', '위출혈', '위절제', '역류', '식도', '소화', '변비', '장염',
    '대장', '십이지장', '과민성', '크론', '설사', '속쓰림'],
  painkiller: ['진통제', '마약성']
};

// 항목별 이름·색 (구분 칸 색과 요약 칸 색)
const CATEGORIES = [
  { key: 'bp', label: '1. 고혈압', color: '#f4cccc', strong: '#cc0000' },
  { key: 'glucose', label: '2. 당뇨', color: '#fce5cd', strong: '#e69138' },
  { key: 'nutrition', label: '3. 영양상태', color: '#fff2cc', strong: '#bf9000' },
  { key: 'cardio', label: '7. 심폐질환', color: '#d9d2e9', strong: '#674ea7' },
  { key: 'gastro', label: '8. 위장관질환', color: '#d0e0e3', strong: '#45818e' },
  { key: 'pain', label: '9. 통증', color: '#d9ead3', strong: '#6aa84f' }
];

/* ================================================================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('주의대상')
    .addItem('새로고침', 'updateAlertSheet')
    .addToUi();
}

function updateAlertSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const read = name => {
    const sh = ss.getSheetByName(name);
    if (!sh) throw new Error('「' + name + '」 탭을 찾지 못했습니다.');
    return sh.getDataRange().getValues();
  };
  const result = buildAlerts_(read(ALERT_CONFIG.careSheet), read(ALERT_CONFIG.rosterSheet),
    ss.getSheetByName(ALERT_CONFIG.methodSheet) ? read(ALERT_CONFIG.methodSheet) : null);
  writeAlertSheet_(ss, result);
  ss.toast('주의대상 ' + result.people + '명 (' + result.rows.length + '건)', '주의대상 새로고침 완료', 5);
}

/* ======================  판정 (시트와 무관한 순수 계산)  ====================== */

/** 값 배열들 → { rows: [...], counts: {key: n}, people: n } */
function buildAlerts_(care, roster, method) {
  const norm = s => String(s == null ? '' : s).replace(/\s/g, '');
  const colOf = (head, names) => {
    const h = head.map(norm);
    for (const n of names) { const i = h.indexOf(norm(n)); if (i >= 0) return i; }
    for (const n of names) { const i = h.findIndex(x => x.indexOf(norm(n)) >= 0); if (i >= 0) return i; }
    return -1;
  };
  const str = v => String(v == null ? '' : v).trim();
  const firstNums = v => {
    if (typeof v === 'number') return [v];
    return (str(v).match(/\d+(\.\d+)?/g) || []).map(Number);
  };
  const hasAny = (text, words) => words.filter(w => text.indexOf(w) >= 0);

  // ---- 돌봄 명단 / 돌봄방법 확인 : 어르신 정보 ----
  const info = {}; const infoByName = {};
  if (roster && roster.length > 1) {
    const h = roster[0];
    const c = {
      id: colOf(h, ['고유번호']), gu: colOf(h, ['구']), name: colOf(h, ['이름']),
      house: colOf(h, ['가구형태']), gradeYn: colOf(h, ['등급유무']), grade: colOf(h, ['등급']),
      dis: colOf(h, ['장애유무']), disType: colOf(h, ['장애종류']), status: colOf(h, ['지역리더진행중']),
      leader: colOf(h, ['지역리더']), note: colOf(h, ['특이사항/의뢰사항', '특이사항']), disease: colOf(h, ['질병'])
    };
    roster.slice(1).forEach(r => {
      const name = str(r[c.name]); if (!name) return;
      const p = {
        id: str(r[c.id]).replace(/\.0$/, ''), gu: str(r[c.gu]), name: name, house: str(r[c.house]),
        grade: str(r[c.gradeYn]) === '유' || str(r[c.grade]) ? (str(r[c.grade]) ? str(r[c.grade]).replace(/\.0$/, '') + '등급' : '있음') : '없음',
        disability: [str(r[c.dis]), str(r[c.disType])].filter(Boolean).join(' '),
        closed: str(r[c.status]) === '종결', leader: str(r[c.leader]),
        text: [str(r[c.disease]), str(r[c.note])].join(' ')
      };
      if (p.id) info[p.id] = p;
      infoByName[name] = p;
    });
  }
  if (method && method.length > 1) {
    const h = method[0];
    const cName = colOf(h, ['이름']); const cText = colOf(h, ['질환및특이사항', '질환']);
    method.slice(1).forEach(r => {
      const p = infoByName[str(r[cName])];
      if (p && cText >= 0) p.text += ' ' + str(r[cText]);
    });
  }

  // ---- 돌봄데이터 : 방문 기록을 어르신별로 묶기 ----
  const h = care[0];
  const c = {
    id: colOf(care[0], ['고유번호']), gu: colOf(h, ['해당구']), month: colOf(h, ['해당월']),
    date: colOf(h, ['방문일']), leader: colOf(h, ['건강리더이름']), name: colOf(h, ['어르신이름']),
    sys: colOf(h, ['혈압_수축기']), dia: colOf(h, ['혈압_이완기']), gType: colOf(h, ['혈당(식전,식후구분)']),
    gVal: colOf(h, ['혈당(수치)']), meal: colOf(h, ['①']), water: colOf(h, ['②']), protein: colOf(h, ['④']), walk: colOf(h, ['⑤']),
    muscle: colOf(h, ['⑥']), med: colOf(h, ['⑦']), sleep: colOf(h, ['⑧']), pain: colOf(h, ['통증'])
  };
  const toDate = v => {
    if (v instanceof Date) return v;
    if (v && v.__date) return new Date(v.__date);
    const m = str(v).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };
  const ymd = d => d ? d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) : '';
  const groups = {};
  care.slice(1).forEach(r => {
    const name = str(r[c.name]);
    const id = str(r[c.id]).replace(/\.0$/, '');
    if (!name && !id) return;
    const d = toDate(r[c.date]);
    let ym = d ? d.getFullYear() * 100 + d.getMonth() + 1 : 0;
    if (!ym) { const m = str(r[c.month]).match(/(\d{1,2})/); if (m) ym = 202600 + +m[1]; }
    const key = id || name;
    (groups[key] = groups[key] || { id: id, name: name, gu: str(r[c.gu]), visits: [] }).visits.push({
      date: d, ym: ym, leader: str(r[c.leader]), sys: r[c.sys], dia: r[c.dia], gType: str(r[c.gType]), gVal: r[c.gVal],
      meal: str(r[c.meal]), water: str(r[c.water]), protein: str(r[c.protein]), walk: str(r[c.walk]), muscle: str(r[c.muscle]),
      med: str(r[c.med]), sleep: str(r[c.sleep]), pain: str(r[c.pain])
    });
    if (name) groups[key].name = name;
  });

  const rows = []; const counts = {}; const flagged = {};
  CATEGORIES.forEach(k => counts[k.key] = 0);
  const add = (g, p, last, key, basis, details, rx, severe) => {
    counts[key]++; flagged[g.id || g.name] = true;
    rows.push({
      key: key, id: g.id, gu: g.gu || (p && p.gu) || '', name: g.name, leader: last.leader || (p && p.leader) || '',
      lastVisit: ymd(last.date), basis: basis, details: details.join('\n'), rx: rx.join('\n'), severe: !!severe
    });
  };
  const yesNo = (v, yes, no) => v === '예' ? yes : v === '아니오' ? no : '기록 없음';

  Object.keys(groups).forEach(k => {
    const g = groups[k];
    const p = info[g.id] || infoByName[g.name] || null;
    if (ALERT_CONFIG.excludeClosed && p && p.closed) return;
    const visits = g.visits.filter(v => v.ym).sort((a, b) => (a.date || 0) - (b.date || 0));
    if (!visits.length) return;
    const ym = Math.max.apply(null, visits.map(v => v.ym));
    const mv = visits.filter(v => v.ym === ym);
    const last = mv[mv.length - 1];
    const mLabel = (ym % 100) + '월';
    const text = p ? p.text : '';
    const dx = {
      ht: hasAny(text, KEYWORDS.hypertension).length > 0,
      dm: hasAny(text, KEYWORDS.diabetes).length > 0,
      dep: hasAny(text, KEYWORDS.depression).length > 0,
      cardio: hasAny(text, KEYWORDS.cardioPulmonary),
      gi: hasAny(text, KEYWORDS.gastro),
      pk: hasAny(text, KEYWORDS.painkiller).length > 0
    };
    const exYes = mv.filter(v => v.walk === '예' || v.muscle === '예').length;
    const exAns = mv.filter(v => v.walk || v.muscle).length;
    const exercise = exAns ? '운동(30분 걷기·근력운동): ' + mLabel + ' ' + exAns + '회 중 ' + exYes + '회 실천' : '운동: 기록 없음';
    const medLine = '약 복용(⑦): ' + yesNo(last.med, '예', '아니오(복용 안 함)');
    const cardioLine = '심폐질환: ' + (dx.cardio.length ? '있음(' + dx.cardio.join(', ') + ')' : '기록 없음');
    const giLine = '위장관질환: ' + (dx.gi.length ? '있음(' + dx.gi.join(', ') + ')' : '기록 없음');
    const exLow = exAns > 0 && exYes * 2 < exAns;

    // 1. 고혈압
    const bps = mv.map(v => {
      let s = firstNums(v.sys); let d = firstNums(v.dia);
      if (s.length >= 2 && !d.length) d = [s[1]];
      return { s: s[0], d: d[0] };
    }).filter(b => b.s >= 60 && b.s <= 260);
    if (bps.length) {
      const low = bps.reduce((a, b) => b.s < a.s ? b : a);
      if (low.s >= ALERT_CONFIG.systolicLimit) {
        const rx = ['혈압 재측정: 5분 앉아 쉰 뒤 2번 재고 낮은 값 기록',
          '짠 음식·국물 줄이기, 혈압약 거르지 않고 복용 확인'];
        if (!dx.ht) rx.push('고혈압 진단 기록 없음 → 연계 의료진 진료 권유');
        if (last.med === '아니오') rx.push('약을 거르고 있음 → 복약 확인·보호자 연락');
        if (exLow || !exAns) rx.push('운동 처방: 주 3일 이상 30분 걷기 또는 의자 스쿼트');
        if (dx.cardio.length) rx.push('심폐질환 동반 → 운동은 말할 수 있을 정도로 가볍게, 숨참·흉통 시 중단');
        if (low.s >= ALERT_CONFIG.systolicSevere) rx.push('⚠ 최저 수축기 ' + ALERT_CONFIG.systolicSevere + ' 이상 → 연계 의료진에 바로 보고');
        add(g, p, last, 'bp', mLabel + ' 최저 혈압 ' + low.s + (low.d ? '/' + low.d : '') + ' (' + bps.length + '회 측정)',
          ['고혈압 진단: ' + (dx.ht ? '있음' : '기록 없음'), medLine, exercise, cardioLine], rx,
          low.s >= ALERT_CONFIG.systolicSevere);
      }
    }

    // 2. 당뇨
    const gls = mv.map(v => ({ n: firstNums(v.gVal)[0], t: v.gType })).filter(x => x.n >= 20 && x.n <= 700);
    const high = gls.filter(x => x.n >= ALERT_CONFIG.glucoseLimit);
    if (high.length) {
      const top = high.reduce((a, b) => b.n > a.n ? b : a);
      const rx = ['혈당 재측정: 식전/식후 시간 구분해서 기록',
        '믹스커피·단 음료·간식 줄이기, 식후 10~20분 걷기'];
      if (!dx.dm) rx.push('당뇨 진단 기록 없음 → 연계 의료진 진료 권유');
      if (last.med === '아니오') rx.push('약을 거르고 있음 → 복약 확인·보호자 연락');
      if (exLow || !exAns) rx.push('운동 처방: 주 3일 이상 30분 걷기');
      if (dx.cardio.length) rx.push('심폐질환 동반 → 저혈당·숨참 증상 확인');
      if (top.n >= ALERT_CONFIG.glucoseSevere) rx.push('⚠ 혈당 ' + ALERT_CONFIG.glucoseSevere + ' 이상 → 연계 의료진에 바로 보고');
      add(g, p, last, 'glucose', mLabel + ' 최고 혈당 ' + top.n + (top.t ? '(' + top.t + ')' : '') + ' · 200 이상 ' + high.length + '/' + gls.length + '회',
        ['당뇨 진단: ' + (dx.dm ? '있음' : '기록 없음'), medLine, exercise, cardioLine], rx,
        top.n >= ALERT_CONFIG.glucoseSevere);
    }

    // 3. 영양상태
    const mealAns = mv.filter(v => v.meal);
    const mealNo = mealAns.filter(v => v.meal === '아니오');
    if (mealNo.length) {
      const protNo = mv.filter(v => v.protein === '아니오').length;
      const rx = ['끼니를 거르는 이유 확인(입맛·치아·식사 준비 어려움)',
        '단백질 간식 권하기(우유·두부·계란), 도시락·반찬 지원 연계 검토'];
      if (dx.dep) rx.push('우울증 동반 → 말벗·정서지원 늘리고 의료진과 공유');
      if (dx.gi.length) rx.push('위장관질환 동반 → 부드러운 음식을 조금씩 자주');
      if (mealNo.length >= 2) rx.push('⚠ 한 달 2회 이상 하루 2끼 미만 → 담당자에게 보고');
      add(g, p, last, 'nutrition', mLabel + ' 하루 2끼 미만 ' + mealNo.length + '/' + mealAns.length + '회',
        ['우울증 진단: ' + (dx.dep ? '있음' : '기록 없음'), giLine,
          '단백질 섭취(④): ' + (protNo ? mLabel + ' 아니오 ' + protNo + '회' : '양호')], rx, mealNo.length >= 2);
    }

    // 7. 심폐질환
    if (dx.cardio.length) {
      add(g, p, last, 'cardio', '질병: ' + dx.cardio.join(', '),
        [exercise, medLine, '최근 혈압: ' + (bps.length ? bps[bps.length - 1].s + (bps[bps.length - 1].d ? '/' + bps[bps.length - 1].d : '') : '기록 없음')],
        ['숨참·가슴 통증·다리 부종 확인', '운동은 말할 수 있을 정도로 가볍게',
          '증상이 심해지면 연계 의료진에 보고'], false);
    }

    // 8. 위장관질환
    if (dx.gi.length) {
      add(g, p, last, 'gastro', '질병: ' + dx.gi.join(', '),
        ['하루 2끼 이상(①): ' + yesNo(last.meal, '예', '아니오'), '물 4~6잔(②): ' + yesNo(last.water, '예', '아니오')],
        ['소화불량·변비·속쓰림 확인', '물 4~6잔, 자극적인 음식 피하기'], false);
    }

    // 9. 통증 (수면 방해)
    if (last.pain && last.sleep === '아니오') {
      add(g, p, last, 'pain', ymd(last.date) + ' 통증(' + last.pain + ') + 숙면 못함',
        ['통증 부위: ' + last.pain, '진통제: ' + (dx.pk ? '복용 기록 있음' : '기록 없음'),
          '숙면(⑧): ' + mLabel + ' 아니오 ' + mv.filter(v => v.sleep === '아니오').length + '/' + mv.filter(v => v.sleep).length + '회'],
        ['통증 부위·세기(0~10) 기록, 밤에 깨는지 확인', '진통제 복용 여부·효과 확인',
          '온찜질·가벼운 스트레칭', '2주 이상 계속되면 연계 의료진에 보고'], false);
    }
  });

  const order = {}; CATEGORIES.forEach((k, i) => order[k.key] = i);
  rows.sort((a, b) => order[a.key] - order[b.key] || (b.severe - a.severe) || a.gu.localeCompare(b.gu) || a.name.localeCompare(b.name));
  return { rows: rows, counts: counts, people: Object.keys(flagged).length };
}

/* ======================  「주의대상」 탭에 쓰기 + 서식  ====================== */

function writeAlertSheet_(ss, result) {
  const name = ALERT_CONFIG.outputSheet;
  let sh = ss.getSheetByName(name);
  if (sh) {
    if (sh.getFilter()) sh.getFilter().remove();
    sh.getBandings().forEach(b => b.remove());
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
    sh.clear();
    sh.clearConditionalFormatRules();
  } else {
    sh = ss.insertSheet(name, 0);
  }

  const headers = ['주의항목', '고유번호', '구', '이름', '건강리더', '최근 방문일', '판정 근거', '세부 사항', '처방(권고)'];
  const W = headers.length;
  const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');

  // 1행 제목, 2행 설명
  sh.getRange(1, 1, 1, W).merge().setValue('건강리더 주의대상 현황')
    .setFontSize(16).setFontWeight('bold').setFontColor('#ffffff').setBackground('#1c4587')
    .setVerticalAlignment('middle').setHorizontalAlignment('left');
  sh.getRange(2, 1, 1, W).merge()
    .setValue('갱신 ' + now + ' · 어르신별 가장 최근 방문 달 기준 · 주의대상 ' + result.people + '명 / ' + result.rows.length + '건' +
      ' · 메뉴 「주의대상 → 새로고침」으로 다시 계산 · 처방은 건강리더용 권고이며 의료진 판단을 대신하지 않습니다')
    .setFontColor('#434343').setBackground('#e8eef7').setWrap(true).setVerticalAlignment('middle');

  // 4~5행 항목별 인원 요약
  CATEGORIES.forEach((k, i) => {
    sh.getRange(4, i + 1).setValue(k.label).setBackground(k.strong).setFontColor('#ffffff').setFontWeight('bold');
    sh.getRange(5, i + 1).setValue(result.counts[k.key] + '건').setBackground(k.color).setFontSize(14).setFontWeight('bold');
  });
  sh.getRange(4, 1, 2, CATEGORIES.length).setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBorder(true, true, true, true, true, true, '#ffffff', SpreadsheetApp.BorderStyle.SOLID_THICK);
  sh.getRange(4, CATEGORIES.length + 1, 2, W - CATEGORIES.length).merge()
    .setValue('빨간 글씨 = 바로 보고 대상\n(최저 수축기 ' + ALERT_CONFIG.systolicSevere + '↑, 혈당 ' + ALERT_CONFIG.glucoseSevere + '↑, 한 달 2회↑ 끼니 부족)')
    .setFontColor('#cc0000').setWrap(true).setVerticalAlignment('middle').setFontSize(9);

  // 7행 머리글, 8행부터 내용
  const top = 7;
  sh.getRange(top, 1, 1, W).setValues([headers]).setFontWeight('bold').setFontColor('#ffffff')
    .setBackground('#3c78d8').setHorizontalAlignment('center').setVerticalAlignment('middle');
  const label = {}; CATEGORIES.forEach(k => label[k.key] = k);
  if (result.rows.length) {
    const values = result.rows.map(r => [label[r.key].label, r.id, r.gu, r.name, r.leader, r.lastVisit, r.basis, r.details, r.rx]);
    const body = sh.getRange(top + 1, 1, values.length, W);
    body.setNumberFormat('@').setValues(values).setVerticalAlignment('top').setWrap(true)
      .setBorder(true, true, true, true, true, true, '#cccccc', SpreadsheetApp.BorderStyle.SOLID);
    sh.getRange(top + 1, 2, values.length, 5).setHorizontalAlignment('center');
    // 항목별 색, 바로 보고 대상 빨간 글씨
    result.rows.forEach((r, i) => {
      const row = top + 1 + i;
      sh.getRange(row, 1).setBackground(label[r.key].color).setFontWeight('bold');
      if (r.severe) sh.getRange(row, 7).setFontColor('#cc0000').setFontWeight('bold');
    });
    sh.getRange(top + 1, 8, values.length, 1).setFontSize(9);
    sh.getRange(top + 1, 9, values.length, 1).setFontSize(9).setBackground('#f3f8f1');
    sh.getRange(top, 1, values.length + 1, W).createFilter();
  } else {
    sh.getRange(top + 1, 1, 1, W).merge().setValue('기준에 걸리는 어르신이 없습니다.').setHorizontalAlignment('center');
  }

  // 열 너비·행 높이·고정
  [110, 70, 60, 70, 80, 90, 230, 280, 340].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.setRowHeight(1, 40); sh.setRowHeight(2, 36); sh.setRowHeight(5, 30); sh.setRowHeight(top, 28);
  sh.setFrozenRows(top);
  sh.setHiddenGridlines(true);
  sh.setTabColor('#cc0000');
}

/* Node 테스트용 (Apps Script에서는 무시됨) */
if (typeof module !== 'undefined') module.exports = { buildAlerts_, CATEGORIES, ALERT_CONFIG };
