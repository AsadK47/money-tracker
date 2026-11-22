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
    if (d && Array.isArray(d.months)) return sanitise(d, true);
  } catch {}
  return { settings: { ...DEFAULTS }, months: [], payslips: [] };
}
// ---------- Encryption at rest ----------
// Passcode -> PBKDF2-SHA256 (600k iterations, random 16-byte salt) -> non-extractable AES-256-GCM key.
// Each save uses a fresh random 12-byte IV. The passcode and key are never stored.
const ENC_KEY = "money-tracker-enc-v1";
const ITER = 600000;
const te = new TextEncoder(), td = new TextDecoder();
let cryptoKey = null, cryptoSalt = null;

const b64 = (buf) => {
  let s = "";
  new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(pass, salt, iter = ITER) {
  const base = await crypto.subtle.importKey("raw", te.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function encryptToStorage() {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, te.encode(JSON.stringify(state)));
  localStorage.setItem(ENC_KEY, JSON.stringify({ v: 1, iter: ITER, salt: b64(cryptoSalt), iv: b64(iv), ct: b64(ct) }));
  localStorage.removeItem(KEY); // never leave a plaintext copy behind
}

// Throws on wrong passcode (AES-GCM authentication fails).
async function decryptFromStorage(pass) {
  const blob = JSON.parse(localStorage.getItem(ENC_KEY));
  const salt = unb64(blob.salt);
  const key = await deriveKey(pass, salt, blob.iter || ITER);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, key, unb64(blob.ct));
  cryptoKey = key; cryptoSalt = salt;
  return sanitise(JSON.parse(td.decode(pt)), true);
}

// Saves are queued so an older encrypted write can never land after a newer one.
let writeQueue = Promise.resolve();
function save() {
  writeQueue = writeQueue.then(async () => {
    try {
      if (!state.settings.persist) {
        localStorage.removeItem(KEY); localStorage.removeItem(ENC_KEY);
      } else if (cryptoKey) {
        await encryptToStorage();
      } else {
        localStorage.setItem(KEY, JSON.stringify(state));
      }
    } catch {}
  });
  return writeQueue;
}

const isEncrypted = () => { try { return !!localStorage.getItem(ENC_KEY); } catch { return false; } };
const emptyState = () => ({ settings: { ...DEFAULTS }, months: [], payslips: [] });

let state = isEncrypted() ? emptyState() : load();
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
  updateLockUi();
  $("settingsDialog").showModal();
};
$("settingsForm").addEventListener("submit", () => {
  const f = $("settingsForm");
  state.settings.efTarget = parseFloat(f.efTarget.value) || 0;
  state.settings.includePension = f.includePension.checked;
  state.settings.persist = f.persist.checked;
  if (!state.settings.persist) { cryptoKey = null; cryptoSalt = null; } // private mode: nothing to lock
  save(); render(); updateLockUi();
});
function wipeAll() {
  const persist = state.settings.persist;
  state = { settings: { ...DEFAULTS, persist }, months: [], payslips: [] };
  cryptoKey = null; cryptoSalt = null;
  try { localStorage.removeItem(KEY); localStorage.removeItem(ENC_KEY); } catch {}
  save(); render(); updateLockUi();
}
$("wipeBtn").onclick = () => { wipeAll(); $("settingsDialog").close(); };

// ---------- Passcode lock UI ----------
function updateLockUi() {
  const on = !!cryptoKey;
  $("lockBtn").hidden = !on;
  $("lockStatus").textContent = !state.settings.persist
    ? "Not needed in private mode — nothing is saved."
    : on ? "On: data is encrypted on this device." : "Off: data is saved unencrypted on this device.";
  $("setPassBtn").textContent = on ? "Change passcode" : "Set passcode";
  $("setPassBtn").disabled = !state.settings.persist;
  $("removePassBtn").hidden = !on;
}

$("setPassBtn").onclick = () => {
  $("passForm").reset(); $("passError").textContent = "";
  $("passTitle").textContent = cryptoKey ? "Change passcode" : "Set passcode";
  $("passDialog").showModal();
};
$("passCancel").onclick = () => $("passDialog").close();
$("passForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = $("passForm");
  if (f.p1.value.length < 6) return ($("passError").textContent = "Use at least 6 characters.");
  if (f.p1.value !== f.p2.value) return ($("passError").textContent = "Passcodes don't match.");
  $("passSave").disabled = true; $("passError").textContent = "Encrypting…";
  cryptoSalt = crypto.getRandomValues(new Uint8Array(16)); // new salt on every change
  cryptoKey = await deriveKey(f.p1.value, cryptoSalt);
  f.reset();
  await save();
  $("passSave").disabled = false;
  $("passDialog").close(); updateLockUi();
});
$("removePassBtn").onclick = async () => {
  cryptoKey = null; cryptoSalt = null;
  try { localStorage.removeItem(ENC_KEY); } catch {}
  await save(); updateLockUi();
};

function lock() {
  if (!cryptoKey) return;
  cryptoKey = null; cryptoSalt = null;
  state = emptyState(); // drop decrypted data from memory
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  render(); showLock();
}
function showLock() {
  document.body.classList.add("locked");
  $("lock").hidden = false; $("lockError").textContent = ""; $("lockInput").value = "";
  setTimeout(() => $("lockInput").focus(), 50);
}
$("lockBtn").onclick = lock;

// Slow down guessing on this device: wait doubles after each wrong attempt.
let failures = 0;
$("lockForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("unlockBtn");
  btn.disabled = true; $("lockError").textContent = "Unlocking…";
  try {
    state = await decryptFromStorage($("lockInput").value);
    failures = 0;
    $("lockInput").value = "";
    $("lock").hidden = true; document.body.classList.remove("locked");
    render(); updateLockUi();
    btn.disabled = false;
  } catch {
    failures++;
    const wait = Math.min(2 ** failures, 60);
    $("lockError").textContent = `Wrong passcode. Try again in ${wait}s.`;
    setTimeout(() => { btn.disabled = false; $("lockError").textContent = "Wrong passcode."; }, wait * 1000);
  }
});
$("forgotBtn").onclick = () => {
  const b = $("forgotBtn");
  if (b.dataset.armed) {
    wipeAll(); delete b.dataset.armed; b.textContent = "Forgot passcode";
    $("lock").hidden = true; document.body.classList.remove("locked");
  } else {
    b.dataset.armed = "1";
    b.textContent = "Tap again to WIPE all data";
    $("lockError").textContent = "There's no recovery without the passcode. Restore from an Export afterwards.";
  }
};

// Auto-lock after 2 minutes in the background.
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (cryptoKey && Date.now() - hiddenAt > 2 * 60 * 1000) lock();
});

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
  // Defence in depth against malicious PDFs: no eval, no embedded scripts/fonts executing.
  const doc = await pdfjs.getDocument({
    data: await file.arrayBuffer(),
    isEvalSupported: false,
    enableXfa: false,
    disableFontFace: true,
  }).promise;
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
    addPayslips(found);
  } catch {
    $("payslip").innerHTML = `<div class="alert">Couldn't read that PDF. Tap "Enter manually" instead.</div>`;
  }
};

function addPayslips(found) {
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
}

// ---------- Guided manual payslip entry ----------
const STEPS = [
  { key: "date", type: "date", title: "When were you paid?", hint: "Look for “Date” or “Pay date” near the top of your payslip.", required: true },
  { key: "taxCode", type: "text", title: "What's your tax code?", hint: "Near the top, e.g. 1257L. Include anything after it like M1, W1 or X — that matters." },
  { key: "gross", type: "num", title: "Gross pay", hint: "Your pay before anything is taken off. Often labelled “Salary”, “Basic pay” or “Total gross”." },
  { key: "tax", type: "num", title: "Income tax", hint: "In the deductions list, usually just “Tax” or “PAYE”. Use this month's figure, not “this year”." },
  { key: "ni", type: "num", title: "National Insurance", hint: "Labelled “NI” or “National Insurance”." },
  { key: "pension", type: "num", title: "Your pension contribution", hint: "“Pension”, “Pension contribs” or “Salary sacrifice”. Enter 0 if none." },
  { key: "studentLoan", type: "num", title: "Student loan", hint: "“Student loan” or “SL”. Enter 0 if none." },
  { key: "employerPension", type: "num", title: "Employer pension", hint: "Optional. Often shown separately as “Ers pension” or “Employer contribution”. It isn't taken from your pay." },
  { key: "net", type: "num", title: "Net pay", hint: "What actually lands in your bank. Usually the biggest number at the bottom: “Net pay”.", required: true },
];
let wiz = { i: 0, data: {} };

function wizShow() {
  const s = STEPS[wiz.i];
  const inp = $("wizInput");
  $("wizDots").innerHTML = STEPS.map((_, j) => `<span class="${j <= wiz.i ? "on" : ""}"></span>`).join("");
  $("wizTitle").textContent = s.title;
  $("wizHint").textContent = s.hint;
  $("wizError").textContent = "";
  inp.type = s.type === "num" ? "number" : s.type;
  inp.step = "0.01";
  inp.inputMode = s.type === "num" ? "decimal" : "text";
  inp.placeholder = s.type === "num" ? "£0.00" : s.key === "taxCode" ? "1257L" : "";
  inp.value = wiz.data[s.key] ?? "";
  $("wizBack").style.visibility = wiz.i ? "visible" : "hidden";
  $("wizSkip").style.visibility = s.required ? "hidden" : "visible";
  $("wizNext").textContent = wiz.i === STEPS.length - 1 ? "Save" : "Next";
  setTimeout(() => inp.focus(), 50);
}

function wizNext(skip) {
  const s = STEPS[wiz.i];
  const raw = $("wizInput").value.trim();
  if (!skip) {
    if (s.required && !raw) return ($("wizError").textContent = "This one's needed.");
    wiz.data[s.key] = s.type === "num" ? parseFloat(raw) || 0 : s.key === "taxCode" ? raw.toUpperCase() : raw;
  }
  if (wiz.i < STEPS.length - 1) { wiz.i++; return wizShow(); }

  // Final step: sanity-check net against gross minus deductions.
  const d = wiz.data;
  if (d.gross && !wiz.confirmed) {
    const expected = d.gross - (d.tax || 0) - (d.ni || 0) - (d.pension || 0) - (d.studentLoan || 0);
    if (Math.abs(expected - d.net) > 1) {
      wiz.confirmed = true;
      $("wizError").textContent =
        `Gross minus deductions is ${gbp(expected)}, but net is ${gbp(d.net)}. Fine if there are other deductions or sick pay — tap Save again to keep it.`;
      return;
    }
  }
  const p = { taxCode: "", gross: 0, tax: 0, ni: 0, pension: 0, studentLoan: 0, employerPension: 0, ...d };
  addPayslips([p]);
  $("wizardDialog").close();
}

$("manualBtn").onclick = () => {
  const last = [...state.payslips].sort((a, b) => a.date.localeCompare(b.date)).pop();
  // Pre-fill from last payslip so a typical month is just "Next, Next, Save".
  wiz = { i: 0, data: last ? { ...last, date: "" } : {}, confirmed: false };
  wizShow();
  $("wizardDialog").showModal();
};
$("wizardForm").addEventListener("submit", (e) => { e.preventDefault(); wizNext(false); });
$("wizSkip").onclick = () => wizNext(true);
$("wizBack").onclick = () => { if (wiz.i) { wiz.i--; wizShow(); } };
$("wizInput").addEventListener("input", () => { wiz.confirmed = false; });

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
    state = sanitise(JSON.parse(await file.text()));
    save(); render();
  } catch {
    $("efEta").textContent = "Import failed: not a Money Tracker backup";
  }
};

// Never trust an imported file: rebuild it field by field with strict types.
function sanitise(d, persist = state.settings.persist) {
  if (!d || !Array.isArray(d.months)) throw new Error("bad file");
  const n = (v) => (Number.isFinite(+v) ? +v : 0);
  const str = (v, max = 200) => String(v ?? "").slice(0, max);
  const ym = /^\d{4}-\d{2}$/, ymd = /^\d{4}-\d{2}-\d{2}$/;
  return {
    settings: {
      efTarget: n(d.settings?.efTarget) || DEFAULTS.efTarget,
      includePension: d.settings?.includePension !== false,
      persist,
    },
    months: d.months.filter((m) => ym.test(m?.month)).map((m) => {
      const o = { month: m.month, note: str(m.note) };
      NUM.forEach((k) => (o[k] = n(m[k])));
      return o;
    }),
    payslips: (d.payslips || []).filter((p) => ymd.test(p?.date)).map((p) => ({
      date: p.date, taxCode: str(p.taxCode, 12),
      gross: n(p.gross), tax: n(p.tax), ni: n(p.ni), pension: n(p.pension),
      studentLoan: n(p.studentLoan), employerPension: n(p.employerPension), net: n(p.net),
    })),
  };
}

window.addEventListener("resize", () => drawChart(sorted()));
render();
updateLockUi();
if (isEncrypted()) showLock();
