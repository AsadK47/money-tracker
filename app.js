// Money Tracker — all data stays in this browser (localStorage).
const KEY = "money-tracker-v1";
const BAL = ["current", "cashIsa", "ssIsa", "jpm", "pension"];
const NUM = ["income", "bills", "amex", ...BAL];

const gbp = (n) =>
  (n < 0 ? "-£" : "£") + Math.abs(Math.round(n)).toLocaleString("en-GB");

const DEFAULTS = { efTarget: 15000, includePension: true, persist: true };

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.months)) {
      d.settings = { ...DEFAULTS, ...d.settings };
      d.payslips = d.payslips || [];
      return d;
    }
  } catch {}
  return { settings: { ...DEFAULTS }, months: [], payslips: [] };
}
// Private mode (persist=false): keep everything in memory only, and remove any saved copy.
function save() {
  try {
    if (state.settings.persist) localStorage.setItem(KEY, JSON.stringify(state));
    else localStorage.removeItem(KEY);
  } catch {}
}

let state = load();
let editing = null;

const $ = (id) => document.getElementById(id);
const sorted = () => [...state.months].sort((a, b) => a.month.localeCompare(b.month));

function netWorth(m) {
  return BAL.reduce((s, k) => {
    if (k === "pension" && !state.settings.includePension) return s;
    return s + (m[k] || 0);
  }, 0);
}
const surplus = (m) => (m.income || 0) - (m.bills || 0) - (m.amex || 0);

// UK tax year starts 6 April; months are compared at month level (April counts).
function taxYearStart(now = new Date()) {
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-04`;
}

function render() {
  const ms = sorted();
  const last = ms[ms.length - 1];

  $("netWorth").textContent = gbp(last ? netWorth(last) : 0);
  const s = last ? surplus(last) : 0;
  $("surplus").textContent = gbp(s);
  $("surplus").className = "value " + (s >= 0 ? "pos" : "neg");

  const ty = ms.filter((m) => m.month >= taxYearStart());
  $("taxYear").textContent = gbp(ty.reduce((t, m) => t + surplus(m), 0));

  // Emergency fund
  const target = state.settings.efTarget || 0;
  const ef = last ? last.cashIsa || 0 : 0;
  $("efText").textContent = `${gbp(ef)} / ${gbp(target)}`;
  $("efBar").style.width = target ? Math.min(100, (ef / target) * 100) + "%" : "0";
  const recent = ms.slice(-3).map(surplus);
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  $("efEta").textContent =
    ef >= target ? "Target reached — time to invest 🎉"
    : avg > 0 ? `~${Math.ceil((target - ef) / avg)} months to go at ${gbp(avg)}/mo`
    : "Add a month to see progress";

  // List
  const ul = $("months");
  ul.innerHTML = "";
  [...ms].reverse().forEach((m) => {
    const li = document.createElement("li");
    const label = new Date(m.month + "-01").toLocaleDateString("en-GB", { month: "short", year: "numeric" });
    li.innerHTML = `<div><div>${label}</div><div class="sub">${m.note ? escapeHtml(m.note) : "Surplus " + gbp(surplus(m))}</div></div>
      <div style="text-align:right"><div>${gbp(netWorth(m))}</div><div class="sub">net worth</div></div>`;
    li.onclick = () => openMonth(m);
    ul.appendChild(li);
  });

  drawChart(ms);
  renderPayslip();
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function drawChart(ms) {
  const c = $("chart");
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = 180;
  c.width = w * dpr; c.height = h * dpr;
  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const muted = getComputedStyle(document.body).getPropertyValue("--muted");
  if (ms.length < 2) {
    ctx.fillStyle = muted; ctx.font = "13px sans-serif";
    ctx.fillText("Add two or more months to see a chart", 8, h / 2);
    return;
  }
  const vals = ms.map(netWorth);
  const max = Math.max(...vals), min = Math.min(0, ...vals);
  const pad = 24;
  const x = (i) => pad + (i / (vals.length - 1)) * (w - pad * 2);
  const y = (v) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);

  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue("--accent");
  ctx.lineWidth = 2.5; ctx.lineJoin = "round";
  ctx.beginPath();
  vals.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.stroke();

  ctx.fillStyle = muted; ctx.font = "11px sans-serif";
  ctx.fillText(gbp(max), 4, 12);
  const lbl = (m) => new Date(m.month + "-01").toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  ctx.fillText(lbl(ms[0]), pad, h - 4);
  const end = lbl(ms[ms.length - 1]);
  ctx.fillText(end, w - pad - ctx.measureText(end).width, h - 4);
}

// Month dialog
function openMonth(m) {
  editing = m || null;
  const f = $("monthForm");
  f.reset();
  $("monthTitle").textContent = m ? "Edit month" : "Add month";
  $("deleteBtn").style.visibility = m ? "visible" : "hidden";
  const base = m || prefill();
  f.month.value = base.month;
  NUM.forEach((k) => (f[k].value = base[k] ?? ""));
  f.note.value = base.note || "";
  $("monthDialog").showModal();
}

// New month copies last month's numbers to save typing.
function prefill() {
  const ms = sorted();
  const last = ms[ms.length - 1];
  const d = new Date();
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return last ? { ...last, month, note: "" } : { month };
}

$("monthForm").addEventListener("submit", () => {
  const f = $("monthForm");
  const m = { month: f.month.value, note: f.note.value.trim() };
  NUM.forEach((k) => (m[k] = parseFloat(f[k].value) || 0));
  state.months = state.months.filter((x) => x !== editing && x.month !== m.month);
  state.months.push(m);
  save(); render();
});
$("cancelBtn").onclick = () => $("monthDialog").close();
$("deleteBtn").onclick = () => {
  state.months = state.months.filter((x) => x !== editing);
  save(); render();
  $("monthDialog").close();
};
$("addBtn").onclick = () => openMonth();

// Settings
$("settingsBtn").onclick = () => {
  const f = $("settingsForm");
  f.efTarget.value = state.settings.efTarget;
  f.includePension.checked = state.settings.includePension;
  f.persist.checked = state.settings.persist;
  $("settingsDialog").showModal();
};
$("settingsForm").addEventListener("submit", () => {
  const f = $("settingsForm");
  state.settings.efTarget = parseFloat(f.efTarget.value) || 0;
  state.settings.includePension = f.includePension.checked;
  state.settings.persist = f.persist.checked;
  save(); render();
});
$("wipeBtn").onclick = () => {
  const persist = state.settings.persist;
  state = { settings: { ...DEFAULTS, persist }, months: [], payslips: [] };
  try { localStorage.removeItem(KEY); } catch {}
  save(); render();
  $("settingsDialog").close();
};

// ---------- Payslips ----------
// PDFs are parsed in the browser with pdf.js. The file never leaves the device;
// only the library code is fetched from the CDN.
const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/";
let pdfjs;

async function pdfPages(file) {
  if (!pdfjs) {
    pdfjs = await import(PDFJS + "pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.mjs";
  }
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push(toLines(tc.items.map((t) => ({ s: t.str, x: t.transform[4], y: t.transform[5] }))));
  }
  return pages;
}

// Rebuild visual rows (same y, left to right) so "Tax ... 2,050.06" stays on one line.
function toLines(items) {
  const rows = [];
  items.filter((t) => t.s.trim()).sort((a, b) => b.y - a.y || a.x - b.x).forEach((t) => {
    const row = rows.find((r) => Math.abs(r.y - t.y) < 3);
    row ? row.items.push(t) : rows.push({ y: t.y, items: [t] });
  });
  return rows.map((r) => r.items.sort((a, b) => a.x - b.x).map((t) => t.s).join(" ")).join("\n");
}

const money = (s) => (s ? parseFloat(s.replace(/,/g, "")) : 0);
const AMT = "([\\d,]+\\.\\d{2})";

// Pulls the key figures out of one payslip page. Tuned for Sage-style payslips
// (like Juxt's); falls back to 0 for anything it can't find.
function parsePayslip(text) {
  const grab = (re) => (text.match(new RegExp(re.source, re.flags.replace("m", "") + "m")) || [])[1];
  const date = grab(/Date:?\s*(\d{2}\/\d{2}\/\d{4})/);
  const net = money(grab(new RegExp("NET PAY\\s*" + AMT, "i")));
  if (!date || !net) return null;
  const [dd, mm, yyyy] = date.split("/");
  return {
    date: `${yyyy}-${mm}-${dd}`,
    taxCode: (grab(/Tax Code:?\s*([0-9]*[A-Z]{1,2}[0-9]?(?:\s?(?:M1|W1|X))?)\b/) || "").replace(/\s+/, " "),
    gross: money(grab(new RegExp("Salary\\s+" + AMT))),
    tax: money(grab(new RegExp("^\\s*Tax\\s+" + AMT))),
    ni: money(grab(new RegExp("National Insurance\\s+" + AMT))),
    pension: money(grab(new RegExp("Pension Contrib\\w*\\.?\\s+" + AMT))),
    studentLoan: money(grab(new RegExp("Student Loans?\\s+" + AMT))),
    employerPension: money(grab(new RegExp("Ers Pension TP:?\\s*" + AMT))),
    net,
  };
}

function taxCodeWarning(code) {
  const c = code.toUpperCase();
  if (/(M1|W1|X)$/.test(c)) return "Emergency basis (" + c.split(" ").pop() + "): each month is taxed on its own, so you may be overpaying.";
  if (/^(0T|BR|D0|D1)/.test(c)) return `${c} means little or no tax-free allowance.`;
  return null;
}

$("payslipFile").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  $("payslip").innerHTML = `<p class="hint">Reading…</p>`;
  try {
    const found = (await pdfPages(file)).map(parsePayslip).filter(Boolean);
    if (!found.length) throw new Error("none");
    found.forEach((p) => {
      state.payslips = state.payslips.filter((x) => x.date !== p.date);
      state.payslips.push(p);
      // Feed net pay into that month's entry, keeping any balances already there.
      const month = p.date.slice(0, 7);
      const existing = state.months.find((m) => m.month === month);
      if (existing) existing.income = p.net;
      else state.months.push({ ...(prefillFor(month)), month, income: p.net, note: "" });
    });
    save(); render();
  } catch {
    $("payslip").innerHTML = `<div class="alert">Couldn't read that PDF. Add the month manually instead.</div>`;
  }
};

function prefillFor(month) {
  const before = sorted().filter((m) => m.month < month);
  const last = before[before.length - 1];
  return last ? { ...last } : {};
}

function renderPayslip() {
  const el = $("payslip");
  const ps = [...state.payslips].sort((a, b) => a.date.localeCompare(b.date));
  const p = ps[ps.length - 1];
  if (!p) { el.innerHTML = ""; return; }

  const parts = [
    ["Take-home", p.net, "var(--good)"],
    ["Tax", p.tax, "#ff8a5c"],
    ["NI", p.ni, "#ffcf5c"],
    ["Pension", p.pension, "var(--accent)"],
    ["Student loan", p.studentLoan, "#b38cff"],
  ].filter(([, v]) => v > 0);
  const total = parts.reduce((s, [, v]) => s + v, 0) || 1;
  const warn = p.taxCode && taxCodeWarning(p.taxCode);
  const when = new Date(p.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  el.innerHTML = `
    <div class="row between" style="margin-top:8px">
      <span class="value" style="font-size:1.6rem">${gbp(p.net)}</span>
      <span class="label">${when} · ${escapeHtml(p.taxCode || "—")}</span>
    </div>
    <div class="stack">${parts.map(([, v, c]) => `<div style="flex:${v};background:${c}"></div>`).join("")}</div>
    <div class="legend">${parts.map(([n, v, c]) => `<span><i style="background:${c}"></i>${n} ${Math.round((v / total) * 100)}%</span>`).join("")}</div>
    <div class="grid">
      <div><span>Gross</span><span>${gbp(p.gross)}</span></div>
      <div><span>Tax</span><span>${gbp(p.tax)}</span></div>
      <div><span>NI</span><span>${gbp(p.ni)}</span></div>
      <div><span>Student loan</span><span>${gbp(p.studentLoan)}</span></div>
      <div><span>Your pension</span><span>${gbp(p.pension)}</span></div>
      <div><span>Employer pension</span><span>${gbp(p.employerPension)}</span></div>
    </div>
    ${warn
      ? `<div class="alert">⚠️ ${warn} Call HMRC: <a href="tel:03002003300">0300 200 3300</a></div>`
      : `<div class="alert ok">✓ Tax code looks normal</div>`}`;
}

// Backup
$("exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `money-tracker-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
};
$("importFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.months)) throw new Error();
    state = d; save(); render();
  } catch {
    $("efEta").textContent = "Import failed: not a Money Tracker backup";
  }
};

window.addEventListener("resize", () => drawChart(sorted()));
render();
