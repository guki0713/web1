/* 운동일지 — 근지구력·심폐능력 주간 운동량 관리
 * 데이터: localStorage (최초 실행 시 history.js 시드 로드)
 * 파생 열(푸시업 합계 = 콤보상체 + 단독푸시업 등)은 항상 재계산한다.
 */
"use strict";

/* ---------- 종목 정의 ----------
 * 입력 순서(= 화면에 보이는 순서):
 *   러닝 → 푸시업(단독) → 턱걸이 → 복근 → 맨몸스쿼트 → 콤보1 → 콤보2 */
const EXERCISES = [
  { key: "running",     name: "러닝",                          unit: "km", decimal: true },
  { key: "solo_pushup", name: "푸시업(단독)",                  unit: "회" },
  { key: "pullup",      name: "턱걸이",                        unit: "회" },
  { key: "abs",         name: "복근",                          unit: "회" },
  { key: "solo_legs",   name: "맨몸스쿼트",                    unit: "회" },
  { key: "combo_upper", name: "콤보1(푸시업·로우·해머컬)",     unit: "회" },
  { key: "combo_lower", name: "콤보2(밀프·스쿼트·카프레이즈)", unit: "회" },
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

/* 지표 표시 순서 — 표·선택창·차트 어디서나 이 순서를 쓴다.
 * 합계가 있는 종목은 합계를 먼저 놓고 바로 뒤에 단독 카운트를 붙인다. */
const METRIC_ORDER = [
  "running",        // 러닝
  "pushup_total",   // 푸시업 합계
  "solo_pushup",    //   └ 푸시업(단독)
  "pullup",         // 턱걸이
  "abs",            // 복근
  "legs_total",     // 하체 합계
  "solo_legs",      //   └ 맨몸스쿼트
  "combo_upper",    // 콤보1
  "combo_lower",    // 콤보2
];
// 주간 탭 요약 카드 — 합계 지표 위주
const WEEK_METRICS = ["running", "pushup_total", "pullup", "abs", "legs_total"];
// 표 열 순서
const MONTH_COLS = METRIC_ORDER;
// 전체 비교 차트에서 쌓아 올리는 지표 (단위가 '회'로 같고, 서로 겹치지 않는 것만)
const STACK_METRICS = ["pushup_total", "pullup", "abs", "legs_total"];

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
    if (raw) { state = migrate(JSON.parse(raw)); return; }
  } catch (e) { /* 손상 시 시드로 재시작 */ }
  seedState();
}
// 예전 버전에서 저장된 데이터에 새 필드를 채워 넣는다.
function migrate(s) {
  if (!Array.isArray(s.entries)) s.entries = [];
  if (!s.goals) s.goals = {};
  if (!Array.isArray(s.tests)) s.tests = [];
  return s;
}
function seedState() {
  const hist = (window.WORKOUT_HISTORY || []).map(e => ({ id: uid(), d: e.d, ex: e.ex, v: e.v, s: e.s }));
  state = { entries: hist, goals: {}, tests: [] };
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

/* ---------- 훈련 부하 ----------
 * 종목이 다른 운동을 한 숫자로 합치기 위한 환산치. 러닝 1km를 맨몸 100회에
 * 상당하는 부하로 본다(대략적인 기준일 뿐 생리학적 등가는 아니다).
 * 이 값 자체보다 주 단위 변화율이 의미 있다. */
const RUNNING_LOAD_PER_KM = 100;

function loadOf(entries) {
  let load = 0;
  for (const e of entries) load += e.ex === "running" ? e.v * RUNNING_LOAD_PER_KM : e.v;
  return load;
}
function weekLoad(monday) { return loadOf(entriesBetween(iso(monday), iso(addDays(monday, 6)))); }

/* 급성:만성 부하비 (ACWR).
 * 급성 = 해당 주 부하, 만성 = 해당 주를 포함한 최근 4주의 주당 평균 부하.
 * 스포츠과학에서 통용되는 구간을 그대로 쓴다. */
function acwr(monday) {
  const acute = weekLoad(monday);
  let chronicSum = 0;
  for (let i = 0; i < 4; i++) chronicSum += weekLoad(addDays(monday, -7 * i));
  const chronic = chronicSum / 4;
  return { acute, chronic, ratio: chronic > 0 ? acute / chronic : null };
}
function acwrZone(ratio) {
  if (ratio == null) return { label: "판정 불가", cls: "muted", desc: "직전 4주 기록이 없어 비교할 수 없습니다." };
  if (ratio < 0.8)  return { label: "훈련량 급감", cls: "warn", desc: "평소보다 적습니다. 이 상태가 이어지면 쌓아둔 체력이 줄어듭니다." };
  if (ratio <= 1.3) return { label: "적정",       cls: "good", desc: "평소 수준에서 무리 없이 늘려가는 구간입니다." };
  if (ratio <= 1.5) return { label: "주의",       cls: "warn", desc: "증가 속도가 빠릅니다. 다음 주는 유지하거나 조금 줄이는 편이 안전합니다." };
  return                   { label: "과부하 위험", cls: "bad",  desc: "급격한 증가는 부상 위험을 높입니다. 회복에 무게를 두세요." };
}

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
const views = { log: renderLog, week: renderWeek, month: renderMonth,
                test: renderTest, trend: renderTrend, data: renderData };
let current = { view: "log", date: iso(new Date()), weekMonday: mondayOf(new Date()),
                month: new Date().getMonth(), year: new Date().getFullYear(),
                trendEx: "pushup_total", trendYear: new Date().getFullYear(),
                trendUnit: "week", trendMode: "single",
                testEx: "pullup", testBpm: 30, testPrep: 15 };

document.getElementById("tabs").addEventListener("click", ev => {
  const btn = ev.target.closest("button[data-view]");
  if (!btn) return;
  metronome.stop();          // 탭을 옮기면 메트로놈은 멈춘다
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
    form.appendChild(ex.decimal ? distanceRow(ex) : repsRow(ex));
  }

  // 러닝처럼 거리 하나만 적는 종목
  function distanceRow(ex) {
    const km = el("input", { type: "number", inputmode: "decimal", step: "0.01", min: "0",
      placeholder: "예: 3.07", class: "num grow" });
    const add = () => {
      const v = parseFloat(km.value);
      if (!(v > 0)) { km.focus(); return; }
      state.entries.push({ id: uid(), d: current.date, ex: ex.key, v: Math.round(v * 1000) / 1000 });
      saveState(); render();
    };
    km.addEventListener("keydown", e => { if (e.key === "Enter") add(); });
    return el("div", { class: "entry-row" },
      el("label", null, `${ex.name} (${ex.unit})`),
      el("div", { class: "numline" }, km),
      el("button", { class: "btn primary", onclick: add }, "추가"));
  }

  /* 반복 종목: 사이클 = 운동 + 휴식, 운동 = 반복수 × 세트수
   * → 총량 = 반복수 × 세트 × 사이클.
   * 세트·사이클을 비우면 1로 본다. 총량만 알고 있으면 총량 칸에 바로 적어도 된다. */
  function repsRow(ex) {
    const reps   = el("input", { type: "number", inputmode: "numeric", min: "0", step: "1",
      placeholder: "반복", class: "num", "aria-label": `${ex.name} 반복수` });
    const sets   = el("input", { type: "number", inputmode: "numeric", min: "0", step: "1",
      placeholder: "세트", class: "num", "aria-label": `${ex.name} 세트수` });
    const cycles = el("input", { type: "number", inputmode: "numeric", min: "0", step: "1",
      placeholder: "사이클", class: "num", "aria-label": `${ex.name} 사이클수` });
    const total  = el("input", { type: "number", inputmode: "numeric", min: "0", step: "1",
      placeholder: "총량", class: "num total", "aria-label": `${ex.name} 총량` });

    let totalTouched = false;   // 총량을 직접 고쳤다면 자동 계산이 덮어쓰지 않는다
    const calc = () => {
      const r = parseInt(reps.value, 10);
      if (!(r > 0)) return null;
      const s = parseInt(sets.value, 10) || 1;
      const c = parseInt(cycles.value, 10) || 1;
      return { v: r * s * c, r, s, c };
    };
    const sync = () => {
      if (totalTouched) return;
      const got = calc();
      total.value = got ? got.v : "";
    };
    [reps, sets, cycles].forEach(i => i.addEventListener("input", sync));
    total.addEventListener("input", () => { totalTouched = total.value !== ""; });

    const add = () => {
      const got = calc();
      const typed = parseInt(total.value, 10);
      // 총량을 직접 적었으면 그 값이 우선
      const v = totalTouched && typed > 0 ? typed : (got ? got.v : typed);
      if (!(v > 0)) { reps.focus(); return; }
      // 계산으로 나온 값일 때만 내역(10×5×2)을 함께 남긴다
      const s = got && !totalTouched
        ? [got.r, got.s > 1 ? got.s : null, got.c > 1 ? got.c : null].filter(Boolean).join("×")
        : undefined;
      state.entries.push({ id: uid(), d: current.date, ex: ex.key, v, s: s && s.includes("×") ? s : undefined });
      saveState(); render();
    };
    [reps, sets, cycles, total].forEach(i =>
      i.addEventListener("keydown", e => { if (e.key === "Enter") add(); }));

    return el("div", { class: "entry-row" },
      el("label", null, ex.name),
      el("div", { class: "numline" },
        reps, el("span", { class: "op" }, "×"),
        sets, el("span", { class: "op" }, "×"),
        cycles, el("span", { class: "op" }, "="),
        total),
      el("button", { class: "btn primary", onclick: add }, "추가"));
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
      el("p", { class: "muted" },
        "반복 × 세트 × 사이클을 적으면 총량이 자동 계산됩니다. 세트·사이클은 비우면 1로 봅니다. " +
        "총량만 알면 마지막 칸에 바로 적어도 됩니다."),
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

    // 목표를 비워 두면 점진적 과부하(4주 평균 +5%)를 제안값으로 흐리게 보여준다.
    const suggested = avg4[key] > 0
      ? (meta.decimal ? Math.round(avg4[key] * 1.05 * 10) / 10 : Math.round(avg4[key] * 1.05 / 10) * 10)
      : null;
    const goalInput = el("input", { class: "goal-edit", type: "number", min: "0", step: meta.decimal ? "0.5" : "10",
      value: goal != null ? goal : "",
      placeholder: suggested ? String(suggested) : "목표",
      title: suggested ? `제안: 최근 4주 평균의 +5% (${fmtNum(suggested, meta.decimal)})` : "",
      onchange: ev => {
        const v = parseFloat(ev.target.value);
        if (isNaN(v) || v <= 0) delete state.goals[key]; else state.goals[key] = v;
        saveState(); render();
      } });
    const useSuggested = suggested && goal == null
      ? el("button", { class: "btn tiny", title: "최근 4주 평균 +5%로 목표 설정",
          onclick: () => { state.goals[key] = suggested; saveState(); render(); } }, `${fmtNum(suggested, meta.decimal)} 적용`)
      : null;
    const pct = goal ? Math.min(100, val / goal * 100) : 0;
    grid.appendChild(el("div", { class: "stat" },
      el("div", { class: "name" }, meta.name),
      el("div", { class: "big" }, fmtNum(val, meta.decimal), el("span", { class: "unit" }, ` ${meta.unit}`),
        goal ? el("span", { class: "unit" }, ` / ${fmtNum(goal, meta.decimal)}`) : null),
      goal ? el("div", { class: "bar" }, el("i", { class: pct >= 100 ? "done" : "", style: `width:${pct}%` })) : null,
      cmp,
      el("div", { class: "row", style: "margin-top:6px" },
        el("span", { class: "muted" }, "주간 목표"), goalInput, useSuggested)));
  }

  // 급성:만성 부하비 — 이번 주가 평소 대비 얼마나 급한지
  const load = acwr(mon);
  const zone = acwrZone(load.ratio);
  const gaugePct = load.ratio == null ? 0 : Math.min(100, load.ratio / 2 * 100);
  const loadCard = el("div", { class: "card" },
    el("div", { class: "row spread" },
      el("h2", null, "훈련 부하"),
      el("span", { class: `badge ${zone.cls}` }, zone.label)),
    el("div", { class: "row spread", style: "align-items:baseline" },
      el("div", { class: "big", style: "font-size:30px" },
        load.ratio == null ? "—" : load.ratio.toFixed(2),
        el("span", { class: "unit" }, " 배")),
      el("span", { class: "muted" },
        `이번 주 ${fmtNum(load.acute)} · 4주 평균 ${fmtNum(load.chronic)}`)),
    el("div", { class: "gauge" },
      el("i", { class: "opt" }),                                   // 0.8~1.3 적정 구간 표시
      el("b", { style: `left:${gaugePct}%` })),
    el("div", { class: "row spread muted", style: "font-size:11.5px" },
      el("span", null, "0"), el("span", null, "0.8"), el("span", null, "1.3"), el("span", null, "2.0+")),
    el("p", { class: "muted", style: "margin-bottom:0" }, zone.desc),
    el("p", { class: "muted", style: "margin:6px 0 0" },
      `부하 = 총 반복수 + 러닝 km × ${RUNNING_LOAD_PER_KM}. 절대값보다 주별 변화율을 보는 지표입니다.`));

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
    loadCard,
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

/* ---------- 카운트 음성 ----------
 * 박자를 '띡' 소리 대신 영어 숫자로 읽어 준다. 세면서 운동하지 않아도 되고,
 * 몇 회째인지 귀로 바로 알 수 있다.
 *
 * 타이밍은 오디오 시계(AudioContext.currentTime)로 잡는다. setInterval은
 * 화면이 꺼지거나 부하가 걸리면 밀리지만, 오디오 시계는 밀리지 않는다.
 * 25ms마다 시계를 확인해 도달한 순간에 발음하므로 오차는 사람이 느끼지 못하는 수준이다. */
const speaker = {
  voice: null,
  pick() {
    if (this.voice) return this.voice;
    const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    this.voice = vs.find(v => /^en[-_]US/i.test(v.lang) && !/google/i.test(v.name))
              || vs.find(v => /^en/i.test(v.lang)) || null;
    return this.voice;
  },
  say(text, rate) {
    if (!window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text);
    const v = this.pick();
    if (v) u.voice = v;
    u.lang = "en-US";
    u.rate = rate || 1.15;
    u.pitch = 1;
    speechSynthesis.cancel();      // 이전 발음이 남아 밀리지 않게
    speechSynthesis.speak(u);
  },
};
if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => { speaker.voice = null; };

const metronome = {
  ctx: null, timer: null, nextTick: 0, count: 0, bpm: 30, prep: 15,
  startAt: 0, phase: "idle",       // idle | prep | run
  wakeLock: null, onCount: null, onPrep: null,

  async start(bpm, prepSec, onCount, onPrep) {
    this.stop();
    this.bpm = bpm; this.prep = prepSec; this.count = 0;
    this.onCount = onCount; this.onPrep = onPrep;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!this.ctx) this.ctx = new Ctx();
    await this.ctx.resume();                       // iOS는 사용자 조작 직후에만 열린다
    // iOS는 첫 발음이 사용자 조작 안에서 일어나야 이후 발음이 허용된다
    speaker.say("Get ready", 1);
    try {
      if (navigator.wakeLock) this.wakeLock = await navigator.wakeLock.request("screen");
    } catch (e) { /* 미지원 기기는 그냥 넘어간다 */ }

    this.phase = "prep";
    this.startAt = this.ctx.currentTime + this.prep;   // 준비시간 후 1회차
    this.nextTick = this.startAt;
    this.lastPrepCall = null;
    this.timer = setInterval(() => this.tick(), 25);
  },

  tick() {
    const now = this.ctx.currentTime;
    if (this.phase === "prep") {
      const left = Math.ceil(this.startAt - now);
      if (left !== this.lastPrepCall) {
        this.lastPrepCall = left;
        if (this.onPrep) this.onPrep(Math.max(0, left));
        if (left > 0 && left <= 3) this.beep(now, 900);   // 3·2·1 짧은 신호음
      }
      if (now < this.startAt) return;
      this.phase = "run";
    }
    const interval = 60 / this.bpm;
    while (now >= this.nextTick) {
      this.count++;
      speaker.say(String(this.count));
      if (this.onCount) this.onCount(this.count);
      this.nextTick += interval;
    }
  },

  beep(when, freq) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.5, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.09);
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.start(when); osc.stop(when + 0.1);
  },

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.wakeLock) { this.wakeLock.release().catch(() => {}); this.wakeLock = null; }
    if (window.speechSynthesis) speechSynthesis.cancel();
    this.phase = "idle";
    return this.count;
  },
};

/* ---------- 테스트 탭 ---------- */
// 최대반복 테스트 대상 (BPM에 맞춰 세는 종목)
const TEST_EXERCISES = [
  { key: "pullup", name: "턱걸이" },
  { key: "pushup", name: "푸시업" },
  { key: "squat",  name: "스쿼트" },
  { key: "dips",   name: "딥스" },
  { key: "situp",  name: "윗몸일으키기" },
];
function testName(k) {
  const t = TEST_EXERCISES.find(x => x.key === k);
  return t ? t.name : k;
}

function saveTest(ex, reps, bpm) {
  state.tests.push({ id: uid(), d: iso(new Date()), ex, reps, bpm });
  saveState();
}

function renderTest() {
  const exSelect = el("select", { onchange: ev => { current.testEx = ev.target.value; render(); } },
    TEST_EXERCISES.map(t =>
      el("option", { value: t.key, ...(t.key === current.testEx ? { selected: "" } : {}) }, t.name)));
  const bpmInput = el("input", { type: "number", min: "10", max: "120", step: "5",
    value: current.testBpm, style: "width:76px",
    onchange: ev => { current.testBpm = Math.max(10, Math.min(120, +ev.target.value || 30)); } });
  const prepInput = el("input", { type: "number", min: "0", max: "60", step: "5",
    value: current.testPrep, style: "width:76px",
    onchange: ev => { current.testPrep = Math.max(0, Math.min(60, +ev.target.value || 0)); } });

  const counter = el("div", { class: "counter" }, "0");
  const IDLE_HINT = "시작을 누르면 준비시간이 흐른 뒤, 영어로 숫자를 세어 줍니다. " +
    "숫자 하나에 1회씩 맞춰서 하고, 박자를 놓치는 순간 정지를 누르세요. 그때까지의 횟수가 기록됩니다.";
  const hint = el("p", { class: "muted" }, IDLE_HINT);

  const startBtn = el("button", { class: "btn primary", style: "flex:1" }, "시작");
  const stopBtn = el("button", { class: "btn danger", style: "flex:1", disabled: "" }, "정지 · 기록");

  startBtn.addEventListener("click", async () => {
    counter.textContent = current.testPrep > 0 ? String(current.testPrep) : "0";
    counter.classList.toggle("prep", current.testPrep > 0);
    startBtn.disabled = true; stopBtn.removeAttribute("disabled");
    hint.textContent = `${current.testBpm} BPM · 1회당 ${(60 / current.testBpm).toFixed(1)}초. 준비하세요.`;
    try {
      await metronome.start(current.testBpm, current.testPrep,
        n => { counter.classList.remove("prep"); counter.textContent = String(n); },
        left => {
          counter.textContent = String(left);
          if (left === 0) hint.textContent = "시작! 숫자에 맞춰 진행하세요.";
        });
    } catch (e) {
      startBtn.disabled = false; stopBtn.setAttribute("disabled", "");
      counter.classList.remove("prep");
      hint.textContent = "소리를 재생할 수 없습니다. 무음 모드를 해제하고 다시 시도해 보세요.";
    }
  });
  stopBtn.addEventListener("click", () => {
    const reps = metronome.stop();
    startBtn.disabled = false; stopBtn.setAttribute("disabled", "");
    counter.classList.remove("prep");
    if (reps > 0 && confirm(`${testName(current.testEx)} ${reps}회 (${current.testBpm} BPM)로 기록할까요?`)) {
      saveTest(current.testEx, reps, current.testBpm);
    }
    render();
  });

  // 메트로놈 없이 직접 잰 결과를 넣는 경우
  const manualReps = el("input", { type: "number", min: "1", step: "1", placeholder: "횟수", style: "width:96px" });
  const manualAdd = () => {
    const v = parseInt(manualReps.value, 10);
    if (!v || v <= 0) { manualReps.focus(); return; }
    saveTest(current.testEx, v, null);
    render();
  };

  // 선택 종목의 기록 추이
  const mine = state.tests.filter(t => t.ex === current.testEx).sort((a, b) => a.d.localeCompare(b.d));
  const best = mine.reduce((a, t) => t.reps > a ? t.reps : a, 0);
  const latest = mine.length ? mine[mine.length - 1] : null;
  const prev = mine.length > 1 ? mine[mine.length - 2] : null;

  let chart = null;
  if (mine.length >= 2) {
    const W = 820, H = 240, padL = 56, padB = 42, padT = 14;
    const max = Math.max(...mine.map(t => t.reps));
    const t0 = parseISO(mine[0].d).getTime();
    const t1 = parseISO(mine[mine.length - 1].d).getTime();
    const span = Math.max(1, t1 - t0);
    const x = t => padL + (W - padL - 12) * ((parseISO(t.d).getTime() - t0) / span);
    const y = t => H - padB - (H - padB - padT) * (t.reps / max);
    const parts = [`<line class="axis" x1="${padL}" y1="${H - padB}" x2="${W}" y2="${H - padB}"/>`];
    for (const frac of [0.5, 1]) {
      const gy = H - padB - (H - padB - padT) * frac;
      parts.push(`<line class="axis" x1="${padL}" y1="${gy}" x2="${W}" y2="${gy}" stroke-dasharray="3 4"/>`);
      parts.push(`<text x="${padL - 7}" y="${gy + 5}" text-anchor="end">${Math.round(max * frac)}</text>`);
    }
    parts.push(`<polyline class="trendline" points="${mine.map(t => `${x(t).toFixed(1)},${y(t).toFixed(1)}`).join(" ")}"/>`);
    for (const t of mine)
      parts.push(`<circle class="dot" cx="${x(t).toFixed(1)}" cy="${y(t).toFixed(1)}" r="5"><title>${t.d} · ${t.reps}회${t.bpm ? ` (${t.bpm} BPM)` : ""}</title></circle>`);
    parts.push(`<text x="${padL}" y="${H - padB + 20}">${mine[0].d}</text>`);
    parts.push(`<text x="${W - 12}" y="${H - padB + 20}" text-anchor="end">${mine[mine.length - 1].d}</text>`);
    chart = el("div");
    chart.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${parts.join("")}</svg>`;
  }

  const list = el("ul", { class: "loglist" },
    mine.length ? [...mine].reverse().map(t => el("li", null,
      el("span", { class: "ex" }, t.d),
      t.bpm ? el("span", { class: "sets" }, `${t.bpm} BPM`) : el("span", { class: "sets" }, "직접 입력"),
      el("span", { class: "val" }, `${t.reps}회`),
      el("button", { title: "삭제", onclick: () => {
        state.tests = state.tests.filter(x => x.id !== t.id);
        saveState(); render();
      } }, "✕")))
    : [el("li", { class: "muted" }, "아직 이 종목의 테스트 기록이 없습니다.")]);

  app.append(
    el("div", { class: "card" },
      el("h2", null, "최대반복 테스트"),
      el("div", { class: "row" }, exSelect,
        bpmInput, el("span", { class: "muted" }, "BPM"),
        prepInput, el("span", { class: "muted" }, "초 준비")),
      counter,
      el("div", { class: "row", style: "margin:10px 0" }, startBtn, stopBtn),
      hint),
    el("div", { class: "card" },
      el("h2", null, `${testName(current.testEx)} 기록`),
      latest
        ? el("div", { class: "stat-grid" },
            el("div", { class: "stat" },
              el("div", { class: "name" }, "최근"),
              el("div", { class: "big" }, String(latest.reps), el("span", { class: "unit" }, " 회")),
              prev
                ? el("div", { class: "cmp" },
                    el("span", { class: latest.reps >= prev.reps ? "up" : "down" },
                      (latest.reps >= prev.reps ? "▲ " : "▼ ") + Math.abs(latest.reps - prev.reps)),
                    ` 직전 ${prev.reps}회 (${prev.d})`)
                : el("div", { class: "cmp muted" }, "첫 기록")),
            el("div", { class: "stat" },
              el("div", { class: "name" }, "최고"),
              el("div", { class: "big" }, String(best), el("span", { class: "unit" }, " 회")),
              el("div", { class: "cmp muted" }, `총 ${mine.length}회 측정`)))
        : el("p", { class: "muted" }, "측정하면 여기에 추이가 쌓입니다."),
      chart,
      el("div", { class: "row", style: "margin-top:10px" },
        el("span", { class: "muted" }, "직접 입력"), manualReps,
        el("button", { class: "btn", onclick: manualAdd }, "추가")),
      list),
    el("div", { class: "card" },
      el("h2", null, "왜 이 테스트인가"),
      el("p", { class: "muted" },
        "주간 총량은 '얼마나 했는가'를 보여주지만 '좋아졌는가'는 말해주지 않습니다. " +
        "같은 박자(BPM)로 최대 반복수를 재면 속도라는 변수가 고정되므로, 회차 간 비교가 공정해집니다. " +
        "월 1회 정도, 컨디션이 비슷한 시간대에 측정하면 총량 그래프와 나란히 놓고 볼 수 있습니다.")));
}

/* ---------- 추이 탭 ----------
 * 축을 두 방향으로 바꿔 볼 수 있다.
 *   집계 단위: 주별 / 월별 / 연별
 *   대상: 종목 하나를 골라 시간에 따라  |  전체 종목을 한 기간 안에서 비교
 */

// 선택한 단위로 구간 목록을 만든다. 각 구간은 [from, to] ISO 날짜 범위.
function periodsOf(unit, year) {
  const out = [];
  if (unit === "year") {
    const ys = [...new Set(state.entries.map(e => +e.d.slice(0, 4)))].sort();
    for (const y of ys)
      out.push({ label: y + "년", short: String(y), from: `${y}-01-01`, to: `${y}-12-31` });
    return out;
  }
  if (unit === "month") {
    for (let m = 0; m < 12; m++) {
      const last = new Date(year, m + 1, 0).getDate();
      out.push({ label: `${year}년 ${m + 1}월`, short: `${m + 1}월`,
                 from: iso(new Date(year, m, 1)), to: iso(new Date(year, m, last)) });
    }
    return out;
  }
  let mon = mondayOf(new Date(year, 0, 4));       // ISO 1주차의 월요일
  while (mon.getFullYear() <= year) {
    const sun = addDays(mon, 6);
    out.push({ label: `${iso(mon)} ~ ${iso(sun)}`, short: `${mon.getMonth() + 1}월`,
               from: iso(mon), to: iso(sun), mon: new Date(mon) });
    mon = addDays(mon, 7);
  }
  return out;
}

function renderTrend() {
  const years = [...new Set(state.entries.map(e => +e.d.slice(0, 4)))].sort();
  if (years.length && !years.includes(current.trendYear))
    current.trendYear = years[years.length - 1];

  const unitSelect = el("select", { onchange: ev => { current.trendUnit = ev.target.value; render(); } },
    [["week", "주별"], ["month", "월별"], ["year", "연별"]].map(([v, n]) =>
      el("option", { value: v, ...(v === current.trendUnit ? { selected: "" } : {}) }, n)));

  const modeSelect = el("select", { onchange: ev => { current.trendMode = ev.target.value; render(); } },
    [["single", "종목 하나"], ["all", "전체 비교"]].map(([v, n]) =>
      el("option", { value: v, ...(v === current.trendMode ? { selected: "" } : {}) }, n)));

  const exSelect = el("select", { onchange: ev => { current.trendEx = ev.target.value; render(); } },
    METRIC_ORDER.map(k =>
      el("option", { value: k, ...(k === current.trendEx ? { selected: "" } : {}) }, exName(k))));

  const yearSelect = el("select", { onchange: ev => { current.trendYear = +ev.target.value; render(); } },
    years.map(y => el("option", { value: y, ...(y === current.trendYear ? { selected: "" } : {}) }, y + "년")));

  const periods = periodsOf(current.trendUnit, current.trendYear);
  const sums = periods.map(p => sumByExercise(entriesBetween(p.from, p.to)));

  const controls = el("div", { class: "row", style: "gap:6px" },
    unitSelect, modeSelect,
    current.trendMode === "single" ? exSelect : null,
    current.trendUnit !== "year" && years.length ? yearSelect : null);

  const chartCard = current.trendMode === "single"
    ? singleChart(periods, sums)
    : allChart(periods, sums);

  app.append(
    el("div", { class: "card" },
      el("h2", null, "추이 · 비교"),
      controls,
      chartCard),
    heatmapCard(),
    periodTable(periods, sums));
}

/* 종목 하나를 시간축으로 */
function singleChart(periods, sums) {
  const meta = EX_BY_KEY[current.trendEx];
  const vals = sums.map(s => s[current.trendEx] || 0);
  const max = Math.max(1, ...vals);
  const W = 820, H = 300, padL = 68, padB = 42, padT = 14;
  const bw = (W - padL - 8) / Math.max(1, periods.length);
  const parts = [`<line class="axis" x1="${padL}" y1="${H - padB}" x2="${W}" y2="${H - padB}"/>`];
  for (const frac of [0.25, 0.5, 0.75, 1]) {
    const y = H - padB - (H - padB - padT) * frac;
    parts.push(`<line class="axis" x1="${padL}" y1="${y}" x2="${W}" y2="${y}" stroke-dasharray="3 4"/>`);
    parts.push(`<text x="${padL - 7}" y="${y + 5}" text-anchor="end">${fmtNum(max * frac, meta.decimal)}</text>`);
  }
  periods.forEach((p, i) => {
    const v = vals[i];
    const x = padL + i * bw + 1;
    if (v > 0) {
      const h = (H - padB - padT) * (v / max);
      parts.push(`<rect class="bar-rect" x="${x}" y="${H - padB - h}" width="${Math.max(1, bw - 2)}" height="${h}" rx="1.5"><title>${p.label} · ${fmtNum(v, meta.decimal)} ${meta.unit}</title></rect>`);
    }
    if (labelAt(p, i, periods.length))
      parts.push(`<text x="${x + bw / 2}" y="${H - padB + 20}" text-anchor="middle">${p.short}</text>`);
  });
  const chart = el("div");
  chart.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${parts.join("")}</svg>`;

  const total = vals.reduce((a, b) => a + b, 0);
  const active = vals.filter(v => v > 0).length;
  let bestI = 0;
  vals.forEach((v, i) => { if (v > vals[bestI]) bestI = i; });
  return el("div", null, chart,
    el("div", { class: "legend" },
      el("span", null, `합계 ${fmtNum(total, meta.decimal)} ${meta.unit}`),
      el("span", null, `기록된 구간 ${active}/${periods.length}`),
      vals[bestI] > 0
        ? el("span", null, `최고 ${fmtNum(vals[bestI], meta.decimal)} ${meta.unit} (${periods[bestI].label})`)
        : null));
}

/* 전체 종목을 한 구간 안에서 비교 — 단위가 '회'로 같은 것만 쌓는다.
 * 러닝(km)은 단위가 달라 함께 쌓으면 잘못된 그림이 되므로 아래 표에서 본다. */
function allChart(periods, sums) {
  const totals = sums.map(s => STACK_METRICS.reduce((a, k) => a + (s[k] || 0), 0));
  const max = Math.max(1, ...totals);
  const W = 820, H = 300, padL = 68, padB = 42, padT = 14;
  const bw = (W - padL - 8) / Math.max(1, periods.length);
  const parts = [`<line class="axis" x1="${padL}" y1="${H - padB}" x2="${W}" y2="${H - padB}"/>`];
  for (const frac of [0.25, 0.5, 0.75, 1]) {
    const y = H - padB - (H - padB - padT) * frac;
    parts.push(`<line class="axis" x1="${padL}" y1="${y}" x2="${W}" y2="${y}" stroke-dasharray="3 4"/>`);
    parts.push(`<text x="${padL - 7}" y="${y + 5}" text-anchor="end">${fmtNum(max * frac)}</text>`);
  }
  periods.forEach((p, i) => {
    const x = padL + i * bw + 1;
    let acc = 0;
    STACK_METRICS.forEach((k, si) => {
      const v = sums[i][k] || 0;
      if (v <= 0) return;
      const h = (H - padB - padT) * (v / max);
      acc += h;
      parts.push(`<rect class="s${si}" x="${x}" y="${H - padB - acc}" width="${Math.max(1, bw - 2)}" height="${h}"><title>${p.label} · ${exName(k)} ${fmtNum(v)}회</title></rect>`);
    });
    if (labelAt(p, i, periods.length))
      parts.push(`<text x="${x + bw / 2}" y="${H - padB + 20}" text-anchor="middle">${p.short}</text>`);
  });
  const chart = el("div");
  chart.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${parts.join("")}</svg>`;

  return el("div", null, chart,
    el("div", { class: "legend" },
      STACK_METRICS.map((k, si) =>
        el("span", { class: "serie" }, el("i", { class: `sw s${si}` }), exName(k)))),
    el("p", { class: "muted", style: "margin-bottom:0" },
      "단위가 '회'인 종목만 쌓아 표시합니다. 러닝(km)은 아래 표에서 확인하세요."));
}

// 구간이 많으면 라벨이 겹치므로 솎아낸다
function labelAt(p, i, n) {
  if (n <= 14) return true;
  if (p.mon) return p.mon.getDate() <= 7 && p.mon.getMonth() % 2 === 0;
  return i % Math.ceil(n / 12) === 0;
}

/* 구간 × 종목 표 — 어떤 축으로 보든 숫자로 확인할 수 있게 */
function periodTable(periods, sums) {
  const rows = periods.map((p, i) => {
    const empty = MONTH_COLS.every(k => !(sums[i][k] > 0));
    if (empty && current.trendUnit === "week") return null;   // 빈 주가 많아 표가 길어지는 것 방지
    return el("tr", null, el("td", null, p.short === p.label ? p.label : p.label),
      MONTH_COLS.map(k => {
        const v = sums[i][k] || 0;
        return el("td", { class: v ? (DERIVED.some(d => d.key === k) ? "derived" : "") : "zero" },
          v ? fmtNum(v, EX_BY_KEY[k].decimal) : "·");
      }));
  }).filter(Boolean);

  const tot = {};
  for (const s of sums) for (const k of MONTH_COLS) tot[k] = (tot[k] || 0) + (s[k] || 0);
  rows.push(el("tr", { class: "total" }, el("td", null, "합계"),
    MONTH_COLS.map(k => el("td", null, fmtNum(tot[k] || 0, EX_BY_KEY[k].decimal)))));

  return el("div", { class: "card" },
    el("h2", null, "구간별 숫자"),
    el("div", { class: "tablewrap" },
      el("table", { class: "grid" },
        el("tr", null, el("th", null, "구간"), MONTH_COLS.map(k => el("th", null, exName(k)))),
        rows)),
    current.trendUnit === "week"
      ? el("p", { class: "muted", style: "margin-bottom:0" }, "기록이 없는 주는 생략했습니다.")
      : null);
}

/* 연간 히트맵 */
function heatmapCard() {
  const year = current.trendYear;
  const loadByDay = {};
  for (const e of state.entries) {
    if (!e.d.startsWith(String(year))) continue;
    loadByDay[e.d] = (loadByDay[e.d] || 0) + (e.ex === "running" ? e.v * RUNNING_LOAD_PER_KM : e.v);
  }
  const dayLoads = Object.values(loadByDay).sort((a, b) => a - b);
  // 분위수로 경계를 잡아, 해가 달라도 상대적인 진하기가 유지되게 한다
  const q = f => dayLoads.length ? dayLoads[Math.min(dayLoads.length - 1, Math.floor(dayLoads.length * f))] : 0;
  const cuts = [q(0.25), q(0.5), q(0.75)];
  const level = v => !v ? 0 : v <= cuts[0] ? 1 : v <= cuts[1] ? 2 : v <= cuts[2] ? 3 : 4;

  const CELL = 15, GAP = 3;
  const yStart = new Date(year, 0, 1), yEnd = new Date(year, 11, 31);
  const firstCol = mondayOf(yStart);
  const numCols = Math.round((mondayOf(yEnd) - firstCol) / (7 * 864e5)) + 1;
  const hmW = 34 + numCols * (CELL + GAP), hmH = 22 + 7 * (CELL + GAP);
  const hm = [];
  for (let r = 0; r < 7; r++)
    if (r % 2 === 0)
      hm.push(`<text x="0" y="${22 + r * (CELL + GAP) + CELL - 3}" font-size="11">${DOW[(r + 1) % 7]}</text>`);
  let activeDays = 0;
  for (let c = 0; c < numCols; c++) {
    for (let r = 0; r < 7; r++) {
      const d = addDays(firstCol, c * 7 + r);
      if (d.getFullYear() !== year) continue;
      const key = iso(d);
      const v = loadByDay[key] || 0;
      if (v > 0) activeDays++;
      hm.push(`<rect class="hm l${level(v)}" x="${34 + c * (CELL + GAP)}" y="${22 + r * (CELL + GAP)}" width="${CELL}" height="${CELL}" rx="3"><title>${key} (${DOW[d.getDay()]}) · ${v ? "부하 " + fmtNum(v) : "휴식"}</title></rect>`);
    }
    const d1 = addDays(firstCol, c * 7);
    if (d1.getDate() <= 7 && d1.getFullYear() === year)
      hm.push(`<text x="${34 + c * (CELL + GAP)}" y="14" font-size="11">${d1.getMonth() + 1}월</text>`);
  }
  const heat = el("div", { class: "tablewrap" });
  heat.innerHTML = `<svg class="heatmap" viewBox="0 0 ${hmW} ${hmH}" width="${hmW}" role="img">${hm.join("")}</svg>`;

  let streak = 0, bestStreak = 0;
  for (let d = new Date(yStart); d <= yEnd; d = addDays(d, 1)) {
    if (loadByDay[iso(d)]) { streak++; bestStreak = Math.max(bestStreak, streak); }
    else streak = 0;
  }
  const daysInYear = Math.round((yEnd - yStart) / 864e5) + 1;

  return el("div", { class: "card" },
    el("div", { class: "row spread" },
      el("h2", null, `${year}년 히트맵`),
      el("span", { class: "muted" }, `운동일 ${activeDays}일 / ${daysInYear}일 · 최장 연속 ${bestStreak}일`)),
    heat,
    el("div", { class: "row", style: "gap:6px; margin-top:8px; font-size:12px" },
      el("span", { class: "muted" }, "적음"),
      [1, 2, 3, 4].map(l => el("span", { class: `swatch l${l}` })),
      el("span", { class: "muted" }, "많음")),
    el("p", { class: "muted", style: "margin-bottom:0" },
      "칸 하나가 하루입니다. 색이 진할수록 그날 부하가 큽니다."));
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
        // 테스트 기록도 같은 방식으로 병합
        let addedTests = 0;
        if (Array.isArray(data.tests)) {
          const seenT = new Set(state.tests.map(t => `${t.d}|${t.ex}|${t.reps}|${t.bpm || ""}`));
          for (const t of data.tests) {
            if (!t.d || !t.ex || typeof t.reps !== "number") continue;
            const k = `${t.d}|${t.ex}|${t.reps}|${t.bpm || ""}`;
            if (seenT.has(k)) continue;
            seenT.add(k);
            state.tests.push({ id: uid(), d: t.d, ex: t.ex, reps: t.reps, bpm: t.bpm });
            addedTests++;
          }
        }
        saveState(); render();
        alert(`운동기록 ${added}건${addedTests ? `, 테스트 ${addedTests}건` : ""}을 새로 가져왔습니다 ` +
              `(중복 ${list.length - added}건 제외).`);
      });
    } });

  app.append(
    el("div", { class: "card" },
      el("h2", null, "데이터 현황"),
      el("p", null, (n ? `총 ${n.toLocaleString()}건 · 기간 ${range}` : "아직 기록이 없습니다.") +
        (state.tests.length ? ` · 테스트 ${state.tests.length}건` : "")),
      el("p", { class: "muted" },
        "기록은 이 브라우저 안에만 저장되고 서버로 전송되지 않습니다. " +
        (n ? "기기 변경·분실에 대비해 주기적으로 JSON을 내보내 두세요."
           : "예전 기록이 담긴 백업 파일이 있다면 아래 [JSON 가져오기]로 불러오세요."))),
    el("div", { class: "card" },
      el("h2", null, "내보내기 / 가져오기"),
      el("div", { class: "row" },
        el("button", { class: "btn primary", onclick: () =>
          download(`운동일지-${iso(new Date())}.json`,
            JSON.stringify({ exported: iso(new Date()), goals: state.goals,
                             entries: state.entries, tests: state.tests }, null, 1),
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
          if (confirm(`이 브라우저에 저장된 운동기록 ${n.toLocaleString()}건과 ` +
                      `테스트 ${state.tests.length}건을 모두 지웁니다. 계속할까요?`)) {
            seedState(); render();
          }
        } }, "모든 기록 지우기"))),
    el("footer", { class: "appfoot" }, "운동일지 — 근지구력 · 심폐지구력 주간 관리"));
}

/* ---------- 시작 ---------- */
loadState();
render();

// 오프라인 지원. 파일로 직접 연 경우(file://)에는 서비스 워커를 쓸 수 없으므로 건너뛴다.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* 실패해도 앱은 그대로 동작한다 */ });
  });
}
