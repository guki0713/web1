/* 운동일지 — 근지구력·심폐능력 주간 운동량 관리
 * 데이터: localStorage (최초 실행 시 data/history.js 시드 로드)
 * 파생 열(푸시업 합계 = 콤보상체 + 단독푸시업 등)은 항상 재계산한다.
 */
"use strict";

/* ---------- 종목 정의 ---------- */
const EXERCISES = [
  { key: "pullup",      name: "턱걸이",                     unit: "회" },
  { key: "combo_upper", name: "푸시업 콤보(로우·해머컬)",   unit: "회" },
  { key: "solo_pushup", name: "단독푸시업",                 unit: "회" },
  { key: "combo_lower", name: "하체 콤보(밀프·스쿼트·카프)", unit: "회" },
  { key: "solo_legs",   name: "단독하체",                   unit: "회" },
  { key: "running",     name: "러닝",                       unit: "km", decimal: true },
  { key: "abs",         name: "복근",                       unit: "회" },
  // 2023년 상반기 방식의 원시 기록 — 입력 폼에는 숨기고 합계에만 반영
  { key: "pushup",         name: "푸시업(구기록)",     unit: "회", legacy: true },
  { key: "legs",           name: "하체(구기록)",       unit: "회", legacy: true },
  { key: "weighted_squat", name: "중량스쿼트 9kg",     unit: "회", legacy: true },
  { key: "dips",           name: "딥스",               unit: "회", legacy: true },
];
// 파생 합계: 기존 Numbers 템플릿의 '푸시업'(=G+I), '하체'(=H+J) 열에 해당
const DERIVED = [
  { key: "pushup_total", name: "푸시업 합계", unit: "회", parts: ["pushup", "combo_upper", "solo_pushup"] },
  { key: "legs_total",   name: "하체 합계",   unit: "회", parts: ["legs", "combo_lower", "solo_legs"] },
];
// 주간 탭 요약에 쓰는 핵심 지표 순서
const WEEK_METRICS = ["pushup_total", "legs_total", "pullup", "running", "abs"];
// 월간 표 열 순서 (기존 템플릿과 동일한 배치)
const MONTH_COLS = ["pullup", "pushup_total", "legs_total", "running", "abs",
                    "combo_upper", "combo_lower", "solo_pushup", "solo_legs"];

const EX_BY_KEY = {};
EXERCISES.forEach(e => EX_BY_KEY[e.key] = e);
DERIVED.forEach(e => EX_BY_KEY[e.key] = e);
function exName(k) { return EX_BY_KEY[k] ? EX_BY_KEY[k].name : k; }
function exUnit(k) { return EX_BY_KEY[k] ? EX_BY_KEY[k].unit : ""; }

/* ---------- 저장소 ---------- */
const LS_KEY = "workout-log-v1";
let state = null;

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { state = JSON.parse(raw); return; }
  } catch (e) { /* 손상 시 시드로 재시작 */ }
  seedState();
}
function seedState() {
  const hist = (window.WORKOUT_HISTORY || []).map(e => ({ id: uid(), d: e.d, ex: e.ex, v: e.v, s: e.s }));
  state = { entries: hist, goals: {} };
  saveState();
}
function saveState() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }

/* ---------- 날짜 유틸 (주 시작 = 월요일) ---------- */
function iso(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function parseISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function mondayOf(d) { const r = new Date(d); r.setDate(r.getDate() - (r.getDay() + 6) % 7); return r; }
function fmtNum(v, decimal) {
  if (v == null) return "";
  return decimal ? (Math.round(v * 100) / 100).toLocaleString() : Math.round(v).toLocaleString();
}
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/* ---------- 집계 ---------- */
function entriesBetween(from, to) { // ISO 문자열 비교, 양끝 포함
  return state.entries.filter(e => e.d >= from && e.d <= to);
}
function sumByExercise(entries) {
  const sums = {};
  for (const e of entries) sums[e.ex] = (sums[e.ex] || 0) + e.v;
  for (const dv of DERIVED) sums[dv.key] = dv.parts.reduce((a, p) => a + (sums[p] || 0), 0);
  return sums;
}
function weekSums(monday) { return sumByExercise(entriesBetween(iso(monday), iso(addDays(monday, 6)))); }

/* ---------- 세트 표기 파서: "5x10+5x10", "5×10", "3.07", "200+200" ---------- */
function parseSets(text) {
  const norm = String(text).trim().replace(/×/g, "x").replace(/\s+/g, "").replace(/,/g, "");
  if (!norm) return null;
  if (!/^[0-9.x+]+$/.test(norm)) return null;
  let total = 0;
  for (const term of norm.split("+")) {
    if (!term) return null;
    const factors = term.split("x");
    let prod = 1;
    for (const f of factors) {
      if (!/^\d+(\.\d+)?$/.test(f)) return null;
      prod *= parseFloat(f);
    }
    total += prod;
  }
  return Math.round(total * 1000) / 1000;
}

/* ---------- 뷰 라우팅 ---------- */
const app = document.getElementById("app");
const views = { log: renderLog, week: renderWeek, month: renderMonth, trend: renderTrend, data: renderData };
let current = { view: "log", date: iso(new Date()), weekMonday: mondayOf(new Date()),
                month: new Date().getMonth(), year: new Date().getFullYear(),
                trendEx: "pushup_total", trendYear: new Date().getFullYear() };

document.getElementById("tabs").addEventListener("click", ev => {
  const btn = ev.target.closest("button[data-view]");
  if (!btn) return;
  current.view = btn.dataset.view;
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b === btn));
  render();
});
function render() { app.innerHTML = ""; views[current.view](); }

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

/* ---------- 입력 탭 ---------- */
function renderLog() {
  const dateInput = el("input", { type: "date", value: current.date,
    onchange: ev => { current.date = ev.target.value; render(); } });

  const form = el("div", { class: "entry-grid" });
  for (const ex of EXERCISES.filter(e => !e.legacy)) {
    const input = el("input", { type: "text", inputmode: "decimal",
      placeholder: ex.decimal ? "예: 3.07" : "예: 5x10+5x10 또는 100" });
    const preview = el("div", { class: "preview" });
    input.addEventListener("input", () => {
      const v = parseSets(input.value);
      preview.textContent = v == null
        ? (input.value.trim() ? "형식을 확인하세요" : "")
        : `= ${fmtNum(v, ex.decimal)} ${ex.unit}`;
    });
    const add = () => {
      const v = parseSets(input.value);
      if (v == null || v <= 0) { input.focus(); return; }
      const s = /[x×+]/.test(input.value) ? input.value.trim().replace(/x/g, "×") : undefined;
      state.entries.push({ id: uid(), d: current.date, ex: ex.key, v, s });
      saveState();
      render();
    };
    input.addEventListener("keydown", ev => { if (ev.key === "Enter") add(); });
    form.appendChild(el("div", { class: "entry-row" },
      el("label", null, `${ex.name} (${ex.unit})`), input,
      el("button", { class: "btn primary", onclick: add }, "추가")));
    form.appendChild(preview);
  }

  const dayEntries = state.entries.filter(e => e.d === current.date)
    .sort((a, b) => a.ex.localeCompare(b.ex));
  const list = el("ul", { class: "loglist" },
    dayEntries.length ? dayEntries.map(e => el("li", null,
      el("span", { class: "ex" }, exName(e.ex)),
      e.s ? el("span", { class: "sets" }, e.s) : null,
      el("span", { class: "val" }, `${fmtNum(e.v, EX_BY_KEY[e.ex] && EX_BY_KEY[e.ex].decimal)} ${exUnit(e.ex)}`),
      el("button", { title: "삭제", onclick: () => {
        state.entries = state.entries.filter(x => x.id !== e.id);
        saveState(); render();
      } }, "✕")))
    : [el("li", { class: "muted" }, "이 날짜의 기록이 없습니다.")]);

  const d = parseISO(current.date);
  const daySums = sumByExercise(dayEntries);
  const summary = el("div", { class: "muted" },
    DERIVED.filter(dv => daySums[dv.key]).map(dv =>
      `${dv.name} ${fmtNum(daySums[dv.key])}${dv.unit}  `).join(""));

  app.append(
    el("div", { class: "card" },
      el("div", { class: "row spread" },
        el("h2", null, "운동 기록 입력"),
        el("div", { class: "row" }, dateInput,
          el("button", { class: "btn", onclick: () => { current.date = iso(new Date()); render(); } }, "오늘"))),
      el("p", { class: "muted" }, "세트 표기(5x10+5x10)를 그대로 입력하면 자동 합산됩니다. 러닝은 km."),
      form),
    el("div", { class: "card" },
      el("h2", null, `${current.date} (${DOW[d.getDay()]}) 기록`),
      list, summary));
}

/* ---------- 주간 탭 ---------- */
function renderWeek() {
  const mon = current.weekMonday;
  const sun = addDays(mon, 6);
  const thisWeek = weekSums(mon);
  const prevWeek = weekSums(addDays(mon, -7));
  // 직전 4주 평균 (이번 주 제외)
  const avg4 = {};
  for (let i = 1; i <= 4; i++) {
    const s = weekSums(addDays(mon, -7 * i));
    for (const [k, v] of Object.entries(s)) avg4[k] = (avg4[k] || 0) + v / 4;
  }

  const nav = el("div", { class: "nav" },
    el("button", { class: "btn", onclick: () => { current.weekMonday = addDays(mon, -7); render(); } }, "◀"),
    el("div", { class: "title" }, `${iso(mon)} ~ ${iso(sun)}`),
    el("button", { class: "btn", onclick: () => { current.weekMonday = addDays(mon, 7); render(); } }, "▶"),
    el("button", { class: "btn", onclick: () => { current.weekMonday = mondayOf(new Date()); render(); } }, "이번주"));

  const grid = el("div", { class: "stat-grid" });
  for (const key of WEEK_METRICS) {
    const meta = EX_BY_KEY[key];
    const val = thisWeek[key] || 0;
    const prev = prevWeek[key] || 0;
    const goal = state.goals[key];
    const diff = val - prev;
    const cmp = prev || val
      ? el("div", { class: "cmp" },
          el("span", { class: diff >= 0 ? "up" : "down" },
            (diff >= 0 ? "▲ " : "▼ ") + fmtNum(Math.abs(diff), meta.decimal)),
          ` 전주 ${fmtNum(prev, meta.decimal)} · 4주평균 ${fmtNum(avg4[key] || 0, meta.decimal)}`)
      : el("div", { class: "cmp muted" }, "기록 없음");

    const goalInput = el("input", { class: "goal-edit", type: "number", min: "0", step: meta.decimal ? "0.5" : "10",
      value: goal != null ? goal : "", placeholder: "목표",
      onchange: ev => {
        const v = parseFloat(ev.target.value);
        if (isNaN(v) || v <= 0) delete state.goals[key]; else state.goals[key] = v;
        saveState(); render();
      } });
    const pct = goal ? Math.min(100, val / goal * 100) : 0;
    grid.appendChild(el("div", { class: "stat" },
      el("div", { class: "name" }, meta.name),
      el("div", { class: "big" }, fmtNum(val, meta.decimal), el("span", { class: "unit" }, ` ${meta.unit}`),
        goal ? el("span", { class: "unit" }, ` / ${fmtNum(goal, meta.decimal)}`) : null),
      goal ? el("div", { class: "bar" }, el("i", { class: pct >= 100 ? "done" : "", style: `width:${pct}%` })) : null,
      cmp,
      el("div", { class: "row", style: "margin-top:6px" },
        el("span", { class: "muted" }, "주간 목표"), goalInput)));
  }

  // 요일 × 종목 상세 표
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const perDay = days.map(d => sumByExercise(state.entries.filter(e => e.d === iso(d))));
  const header = el("tr", null, el("th", null, "종목"),
    days.map((d, i) => el("th", { class: d.getDay() === 0 ? "sun" : d.getDay() === 6 ? "sat" : "" },
      `${d.getMonth() + 1}/${d.getDate()} ${DOW[d.getDay()]}`)),
    el("th", null, "주합계"));
  const rows = MONTH_COLS.map(key => {
    const meta = EX_BY_KEY[key];
    const cells = perDay.map(s => {
      const v = s[key] || 0;
      return el("td", { class: v ? (DERIVED.some(dv => dv.key === key) ? "derived" : "") : "zero" },
        v ? fmtNum(v, meta.decimal) : "·");
    });
    const tot = thisWeek[key] || 0;
    return el("tr", null, el("td", null, meta.name), cells,
      el("td", { class: tot ? "" : "zero", style: "font-weight:700" }, tot ? fmtNum(tot, meta.decimal) : "·"));
  });

  app.append(nav,
    el("div", { class: "card" }, el("h2", null, "주간 운동량"), grid),
    el("div", { class: "card" }, el("h2", null, "요일별 상세"),
      el("div", { class: "tablewrap" }, el("table", { class: "grid" }, header, rows))));
}

/* ---------- 월간 탭 ---------- */
function renderMonth() {
  const { year, month } = current;
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthEntries = entriesBetween(iso(first), iso(new Date(year, month, daysInMonth)));
  const byDay = {};
  for (const e of monthEntries) (byDay[e.d] = byDay[e.d] || []).push(e);

  const nav = el("div", { class: "nav" },
    el("button", { class: "btn", onclick: () => { shiftMonth(-1); } }, "◀"),
    el("div", { class: "title" }, `${year}년 ${month + 1}월`),
    el("button", { class: "btn", onclick: () => { shiftMonth(1); } }, "▶"),
    el("button", { class: "btn", onclick: () => {
      current.year = new Date().getFullYear(); current.month = new Date().getMonth(); render();
    } }, "이번달"));
  function shiftMonth(n) {
    const d = new Date(year, month + n, 1);
    current.year = d.getFullYear(); current.month = d.getMonth(); render();
  }

  const header = el("tr", null, el("th", null, "날짜"),
    MONTH_COLS.map(k => el("th", null, exName(k))));
  const rows = [];
  const totals = sumByExercise(monthEntries);
  const todayISO = iso(new Date());
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    const dISO = iso(d);
    const sums = sumByExercise(byDay[dISO] || []);
    const detail = {};
    for (const e of byDay[dISO] || []) if (e.s) detail[e.ex] = (detail[e.ex] ? detail[e.ex] + " / " : "") + e.s;
    const cls = [d.getDay() === 1 ? "weekstart" : "", dISO === todayISO ? "today" : ""].join(" ").trim();
    rows.push(el("tr", cls ? { class: cls } : null,
      el("td", { class: d.getDay() === 0 ? "sun" : d.getDay() === 6 ? "sat" : "" },
        `${day}일 (${DOW[d.getDay()]})`),
      MONTH_COLS.map(k => {
        const meta = EX_BY_KEY[k];
        const v = sums[k] || 0;
        const attrs = { class: v ? (DERIVED.some(dv => dv.key === k) ? "derived" : "") : "zero" };
        if (detail[k]) attrs.title = detail[k];
        return el("td", attrs, v ? fmtNum(v, meta.decimal) : "·");
      })));
  }
  rows.push(el("tr", { class: "total" }, el("td", null, "월 합계"),
    MONTH_COLS.map(k => el("td", null, fmtNum(totals[k] || 0, EX_BY_KEY[k].decimal)))));

  const activeDays = Object.keys(byDay).length;
  app.append(nav,
    el("div", { class: "card" },
      el("div", { class: "row spread" },
        el("h2", null, "월간 기록표"),
        el("span", { class: "muted" }, `운동일 ${activeDays}일 / ${daysInMonth}일`)),
      el("p", { class: "muted" }, "파란 굵은 선 = 주(월요일) 시작 · 파란 숫자 = 자동 합산 열 · 셀에 마우스를 올리면 세트 내역"),
      el("div", { class: "tablewrap" }, el("table", { class: "grid" }, header, rows))));
}

/* ---------- 추이 탭 ---------- */
function renderTrend() {
  const years = [...new Set(state.entries.map(e => +e.d.slice(0, 4)))].sort();
  if (!years.includes(current.trendYear)) current.trendYear = years[years.length - 1] || new Date().getFullYear();

  const exSelect = el("select", { onchange: ev => { current.trendEx = ev.target.value; render(); } },
    [...DERIVED, ...EXERCISES.filter(e => !e.legacy)].map(e =>
      el("option", { value: e.key, ...(e.key === current.trendEx ? { selected: "" } : {}) }, e.name)));
  const yearSelect = el("select", { onchange: ev => { current.trendYear = +ev.target.value; render(); } },
    years.map(y => el("option", { value: y, ...(y === current.trendYear ? { selected: "" } : {}) }, y + "년")));

  // 선택 연도의 주간 합계 (연도 내 모든 월요일)
  const meta = EX_BY_KEY[current.trendEx];
  let mon = mondayOf(new Date(current.trendYear, 0, 4)); // ISO 1주차의 월요일
  const weeks = [];
  while (mon.getFullYear() <= current.trendYear) {
    weeks.push({ mon: new Date(mon), v: weekSums(mon)[current.trendEx] || 0 });
    mon = addDays(mon, 7);
  }
  const max = Math.max(1, ...weeks.map(w => w.v));

  // SVG 막대 차트
  const W = 820, H = 300, padL = 68, padB = 42, padT = 14;
  const bw = (W - padL - 8) / weeks.length;
  const svgParts = [];
  svgParts.push(`<line class="axis" x1="${padL}" y1="${H - padB}" x2="${W}" y2="${H - padB}"/>`);
  for (const frac of [0.25, 0.5, 0.75, 1]) {
    const y = H - padB - (H - padB - padT) * frac;
    svgParts.push(`<line class="axis" x1="${padL}" y1="${y}" x2="${W}" y2="${y}" stroke-dasharray="3 4"/>`);
    svgParts.push(`<text x="${padL - 7}" y="${y + 5}" text-anchor="end">${fmtNum(max * frac, meta.decimal)}</text>`);
  }
  weeks.forEach((w, i) => {
    const h = (H - padB - padT) * (w.v / max);
    const x = padL + i * bw + 1;
    if (w.v > 0)
      svgParts.push(`<rect class="bar-rect" x="${x}" y="${H - padB - h}" width="${Math.max(1, bw - 2)}" height="${h}" rx="1.5"><title>${iso(w.mon)} 주 · ${fmtNum(w.v, meta.decimal)} ${meta.unit}</title></rect>`);
    const m = w.mon.getMonth();
    if (w.mon.getDate() <= 7 && m % 2 === 0)  // 두 달 간격 라벨 (겹침 방지)
      svgParts.push(`<text x="${x}" y="${H - padB + 20}" text-anchor="middle">${m + 1}월</text>`);
  });
  const chart = el("div");
  chart.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${svgParts.join("")}</svg>`;

  const yearTotal = weeks.reduce((a, w) => a + w.v, 0);
  const activeWeeks = weeks.filter(w => w.v > 0).length;
  const best = weeks.reduce((a, w) => w.v > a.v ? w : a, { v: 0 });

  // 연도별 비교 표
  const cmpRows = years.map(y => {
    const sums = sumByExercise(state.entries.filter(e => e.d.startsWith(String(y))));
    return el("tr", null, el("td", null, y + "년"),
      [...DERIVED, EX_BY_KEY.pullup, EX_BY_KEY.running, EX_BY_KEY.abs].map(m =>
        el("td", null, fmtNum(sums[m.key] || 0, m.decimal))));
  });

  app.append(
    el("div", { class: "card" },
      el("div", { class: "row spread" },
        el("h2", null, "주간 운동량 추이"),
        el("div", { class: "row" }, exSelect, yearSelect)),
      chart,
      el("div", { class: "legend" },
        el("span", null, `합계(주 단위 집계) ${fmtNum(yearTotal, meta.decimal)} ${meta.unit}`),
        el("span", null, `운동한 주 ${activeWeeks}/${weeks.length}주`),
        best.v ? el("span", null, `최고 주간 ${fmtNum(best.v, meta.decimal)} ${meta.unit} (${iso(best.mon)} 주)`) : null)),
    el("div", { class: "card" },
      el("h2", null, "연도별 비교"),
      el("div", { class: "tablewrap" },
        el("table", { class: "grid" },
          el("tr", null, el("th", null, "연도"),
            [...DERIVED, EX_BY_KEY.pullup, EX_BY_KEY.running, EX_BY_KEY.abs].map(m => el("th", null, m.name))),
          cmpRows))));
}

/* ---------- 데이터 탭 ---------- */
function download(filename, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function renderData() {
  const n = state.entries.length;
  const dates = state.entries.map(e => e.d).sort();
  const range = n ? `${dates[0]} ~ ${dates[n - 1]}` : "-";

  // display:none 인 file input은 일부 모바일 브라우저에서 선택창이 열리지 않는다.
  // 화면에서만 감추고 요소는 살려 두는 방식으로 둔다.
  const importInput = el("input", { type: "file", accept: ".json,application/json", class: "visually-hidden",
    onchange: ev => {
      const file = ev.target.files[0];
      if (!file) return;
      file.text().then(text => {
        let data;
        try { data = JSON.parse(text); } catch { alert("JSON 파싱 실패"); return; }
        const list = Array.isArray(data) ? data : data.entries;
        if (!Array.isArray(list)) { alert("entries 배열을 찾을 수 없습니다"); return; }
        const seen = new Set(state.entries.map(e => `${e.d}|${e.ex}|${e.v}|${e.s || ""}`));
        let added = 0;
        for (const e of list) {
          if (!e.d || !e.ex || typeof e.v !== "number") continue;
          const key = `${e.d}|${e.ex}|${e.v}|${e.s || ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          state.entries.push({ id: uid(), d: e.d, ex: e.ex, v: e.v, s: e.s });
          added++;
        }
        saveState(); render();
        alert(`${added}건을 새로 가져왔습니다 (중복 ${list.length - added}건 제외).`);
      });
    } });

  app.append(
    el("div", { class: "card" },
      el("h2", null, "데이터 현황"),
      el("p", null, n ? `총 ${n.toLocaleString()}건 · 기간 ${range}` : "아직 기록이 없습니다."),
      el("p", { class: "muted" },
        "기록은 이 브라우저 안에만 저장되고 서버로 전송되지 않습니다. " +
        (n ? "기기 변경·분실에 대비해 주기적으로 JSON을 내보내 두세요."
           : "예전 기록이 담긴 백업 파일이 있다면 아래 [JSON 가져오기]로 불러오세요."))),
    el("div", { class: "card" },
      el("h2", null, "내보내기 / 가져오기"),
      el("div", { class: "row" },
        el("button", { class: "btn primary", onclick: () =>
          download(`운동일지-${iso(new Date())}.json`,
            JSON.stringify({ exported: iso(new Date()), goals: state.goals, entries: state.entries }, null, 1),
            "application/json") }, "JSON 내보내기"),
        el("button", { class: "btn", onclick: () => {
          const head = "date,exercise,exercise_name,value,unit,sets\n";
          const body = [...state.entries].sort((a, b) => a.d.localeCompare(b.d) || a.ex.localeCompare(b.ex))
            .map(e => `${e.d},${e.ex},${exName(e.ex)},${e.v},${exUnit(e.ex)},"${e.s || ""}"`).join("\n");
          download(`운동일지-${iso(new Date())}.csv`, "﻿" + head + body, "text/csv");
        } }, "CSV 내보내기"),
        el("button", { class: "btn", onclick: () => importInput.click() }, "JSON 가져오기"),
        importInput),
      el("p", { class: "muted" },
        "가져오기는 (날짜·종목·수량·세트) 기준으로 중복을 제외하고 병합합니다. " +
        "Numbers 파일은 tools/convert_numbers.py 로 JSON 변환 후 가져오면 됩니다.")),
    el("div", { class: "card" },
      el("h2", null, "초기화"),
      el("p", { class: "muted" }, "되돌릴 수 없습니다. 먼저 JSON을 내보내 두세요."),
      el("div", { class: "row" },
        el("button", { class: "btn danger", onclick: () => {
          if (confirm(`이 브라우저에 저장된 기록 ${n.toLocaleString()}건을 모두 지웁니다. 계속할까요?`)) {
            seedState(); render();
          }
        } }, "모든 기록 지우기"))),
    el("footer", { class: "appfoot" }, "운동일지 — 근지구력 · 심폐지구력 주간 관리"));
}

/* ---------- 시작 ---------- */
loadState();
render();
