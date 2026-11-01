// Apps Script 서비스 흉내 (DriveApp, SpreadsheetApp, DocumentApp 등)
const fs = require('fs');
const vm = require('vm');

function makeEnv(opts = {}) {
  let nextId = 1;
  const files = {}; // id -> {id,name,parent,trashed,kind,doc?}
  const folders = {};
  function mkFolder(name, parent) {
    const id = 'fold' + nextId++;
    const f = {
      id, name, parent, kind: 'folder',
      getId: () => id, getName: () => name, getUrl: () => 'https://drive/folders/' + id,
      getFoldersByName: n => { const l = Object.values(folders).filter(x => x.parent === id && x.name === n); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; },
      createFolder: n => mkFolder(n, id)
    };
    folders[id] = f; return f;
  }
  const root = mkFolder('ROOT', null);
  const target = mkFolder('방문기록지', root.id);
  const TARGET = '10TnjGjVX9ErWWt-uffupolUOcb7M_02_';
  folders[TARGET] = target;

  function fileObj(id) {
    const f = files[id];
    if (!f) throw new Error('no file ' + id);
    return { moveTo: fo => { f.parent = fo.id; }, setTrashed: t => { f.trashed = t; }, getId: () => id };
  }

  // ---- Spreadsheet ----
  function mkSheet(name) {
    const cells = []; // rows of arrays
    const fmt = {};
    const sh = {
      name, cells, fmt, frozen: 0,
      getName: () => name, setName: n => { sh.name = n; name = n; return sh; },
      getLastRow: () => cells.length,
      getLastColumn: () => cells.reduce((m, r) => Math.max(m, r.length), 0),
      setFrozenRows: n => { sh.frozen = n; },
      formulas: {}, cfRules: [],
      clear: () => { cells.length = 0; sh.formulas = {}; },
      setConditionalFormatRules: r => { sh.cfRules = r; },
      getConditionalFormatRules: () => sh.cfRules,
      getRange: (a, b, c, d) => {
        let r0, c0, nr, nc;
        if (typeof a === 'string') {
          const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a);
          if (m) { const L = t => t.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
            r0 = +m[2]; c0 = L(m[1]); nr = m[3] ? +m[4] - r0 + 1 : 1; nc = m[3] ? L(m[3]) - c0 + 1 : 1; }
          else { r0 = 1; c0 = 1; nr = 1; nc = 50; }
        } else { r0 = a; c0 = b; nr = c || 1; nc = d || 1; }
        const rng = {
          setValues: vals => {
            if (vals.length !== nr || vals[0].length !== nc) throw new Error('setValues size mismatch ' + nr + 'x' + nc + ' vs ' + vals.length + 'x' + vals[0].length);
            vals.forEach((row, i) => row.forEach((v, j) => {
              while (cells.length < r0 + i) cells.push([]);
              const R = cells[r0 + i - 1]; while (R.length < c0 + j) R.push('');
              R[c0 + j - 1] = v;
              if (fmt[(r0 + i) + ',' + (c0 + j)] !== '@' && r0 + i > 1) sh.unformatted = (sh.unformatted || 0) + 1;
            }));
            return rng;
          },
          getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((cells[r0 + i - 1] || [])[c0 + j - 1]) ?? '')),
          getDisplayValues: () => rng.getValues().map(r => r.map(String)),
          getDisplayValue: () => String(rng.getValues()[0][0]),
          setNumberFormat: f => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) fmt[(r0 + i) + ',' + (c0 + j)] = f; return rng; },
          setFontWeight: () => rng, setBackground: () => rng,
          setFormula: f => { sh.formulas[r0 + ',' + c0] = f; return rng; },
          getRow: () => r0,
          createTextFinder: text => ({ matchEntireCell: () => ({ findNext: () => {
            for (let i = 0; i < nr; i++) if (String(((cells[r0 + i - 1] || [])[c0 - 1]) ?? '') === text) return { getRow: () => r0 + i };
            return null;
          } }) })
        };
        return rng;
      }
    };
    return sh;
  }
  const spreadsheets = {};
  const SpreadsheetApp = {
    newConditionalFormatRule: () => { const r = {}; const b = {
      whenFormulaSatisfied: f => { r.formula = f; return b; }, setBackground: c => { r.bg = c; return b; },
      setRanges: x => { r.ranges = x; return b; }, build: () => r }; return b; },
    create: name => {
      const id = 'ss' + nextId++;
      const sheets = [mkSheet('Sheet1')];
      const ss = { id, name, sheets, getId: () => id, getUrl: () => 'https://sheet/' + id, getSheets: () => sheets,
        getSheetByName: n => sheets.find(s => s.name === n) || null, insertSheet: (n, idx) => { const s = mkSheet(n); if (idx === undefined) sheets.push(s); else sheets.splice(idx, 0, s); return s; } };
      spreadsheets[id] = ss; files[id] = { id, name, parent: root.id, kind: 'sheet' };
      return ss;
    },
    openById: id => { if (!spreadsheets[id]) throw new Error('no ss'); return spreadsheets[id]; }
  };

  // ---- Document ----
  const docs = {};
  const DocumentApp = {
    ParagraphHeading: { TITLE: 'TITLE', HEADING3: 'H3' },
    HorizontalAlignment: { CENTER: 'C', RIGHT: 'R' },
    create: name => {
      const id = 'doc' + nextId++;
      const content = [];
      function textObj(rec) {
        const t = { setBold: b => { rec.bold = b; return t; }, setForegroundColor: c => { rec.color = c; return t; }, setFontSize: () => t };
        return t;
      }
      function para(text) {
        const rec = { type: 'p', text };
        content.push(rec);
        return {
          setText: s => { rec.text = s; }, // 실제와 같이 undefined 반환
          setHeading: h => { rec.heading = h; return undefined; }, // 체이닝하면 오류 나도록
          setAlignment: a => { rec.align = a; return undefined; },
          editAsText: () => textObj(rec)
        };
      }
      const first = para('');
      if (opts.failDoc) { first.setText = () => { throw new Error('문서 오류 흉내'); }; }
      const body = {
        setMarginTop() {}, setMarginBottom() {}, setMarginLeft() {}, setMarginRight() {},
        getParagraphs: () => [first],
        appendParagraph: t => para(t),
        appendTable: rows => {
          const rec = { type: 'table', rows: rows.map(r => r.map(String)), style: {} };
          rows.forEach(r => r.forEach(c => { if (c === undefined || c === null) throw new Error('table cell undefined'); }));
          content.push(rec);
          const cell = (i, j) => ({ setWidth() { return this; }, setBackgroundColor() { return this; }, editAsText: () => textObj(rec.style[i + ',' + j] = rec.style[i + ',' + j] || {}) });
          return { setBorderColor() {}, getNumRows: () => rows.length, getRow: i => ({ getCell: j => cell(i, j) }) };
        }
      };
      const doc = { getBody: () => body, saveAndClose() {}, getId: () => id, getUrl: () => 'https://docs/' + id };
      docs[id] = { name, content };
      files[id] = { id, name, parent: root.id, kind: 'doc' };
      return doc;
    }
  };

  const props = {}; const cache = {}; const fetchCount = { n: 0 };
  const ctx = {
    Logger: { log: m => ctx._log.push(m) }, _log: [],
    HtmlService: {
      createHtmlOutputFromFile: () => ({ getContent: () => 'LOCAL-INDEX' }),
      createHtmlOutput: html => ({ html, setTitle() { return this; }, addMetaTag() { return this; } })
    },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    UrlFetchApp: { fetch: () => { fetchCount.n++; if (opts.githubDown) throw new Error('down');
      return { getResponseCode: () => 200, getContentText: () => opts.githubHtml || '<html>google.script.run</html>' }; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    DriveApp: {
      getFolderById: id => { if (!folders[id]) throw new Error('no folder'); return folders[id]; },
      createFolder: n => mkFolder(n, root.id),
      getFileById: id => fileObj(id)
    },
    SpreadsheetApp, DocumentApp,
    Session: { getActiveUser: () => ({ getEmail: () => 'bcmedcoophome@gmail.com' }), getScriptTimeZone: () => 'Asia/Seoul' },
    Utilities: { formatDate: (d, tz, f) => '2026-10-25 12:00' + (f.includes('ss') ? ':00' : '') },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(process.env.CODE_GS, 'utf8') + '\n;this.__api = { setup, getInitData, saveDraft, saveVisit, doGet };', ctx);

  function path(id) {
    const out = []; let p = id;
    while (p && folders[p] && folders[p].name !== 'ROOT') { out.unshift(folders[p].name); p = folders[p].parent; }
    return out.join('/');
  }
  return { fetchCount, api: ctx.__api, files, folders, docs, spreadsheets, props, path, log: ctx._log };
}
module.exports = { makeEnv };
