/* ============================================================
   ميكرو نت — منطق التطبيق الكامل
   يعمل عبر الجسر الأصلي MikroTik (RouterOS v6/v7)
   ============================================================ */

const CONNS_KEY = "micronet_conns_v1";
const ACTIVE_CONN_KEY = "micronet_active_conn_v1";
const SALES_KEY = "micronet_sales_v1";
const TEMPLATE_KEY = "micronet_print_template_v1";

const DEFAULT_TEMPLATE = {
  title: "كرت إنترنت",
  subtitle: "مدة الكرت: حسب البروفايل",
  showProfile: true,
  showValidity: true,
  network: "WiFi: Hotspot",
  footer: "للدعم اتصل: 09xxxxxxxx",
  perPage: 8,
};

const state = {
  conn: null,
  routerInfo: { name: "—", uptime: "" },
  refreshTimer: null,
  currentScreen: "overview",
  cache: {
    profiles: [],
    vouchers: [],
    activeUsers: [],
    users: [],
  },
};

const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => Array.from(p.querySelectorAll(s));
const hasBridge = typeof MikroTik !== "undefined";
const hasPrinter = typeof Printer !== "undefined";

/* ========== Utilities ========== */
const esc = (s) => s == null ? "" : String(s).replace(/[&<>"']/g, (c) =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

function fmtUptime(s) {
  if (!s) return "—";
  return s.replace("w", "أ ").replace("d", "ي ").replace("h", "س ")
          .replace("m", "د ").replace("s", "ث");
}
function fmtBytes(b) {
  if (b == null) return "—";
  const n = Number(b); if (!isFinite(n)) return "—";
  if (n < 1024) return n + " B";
  if (n < 1024*1024) return (n/1024).toFixed(1) + " KB";
  if (n < 1024*1024*1024) return (n/1024/1024).toFixed(1) + " MB";
  return (n/1024/1024/1024).toFixed(2) + " GB";
}
function todayIso() { return new Date().toISOString().slice(0,10); }
function nowIso() { return new Date().toISOString(); }
function rndId(p) { return p + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,7); }

function showToast(msg, ms = 2400) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.hidden = true, ms);
}

function openModal(html) {
  const m = $("#modal"); const c = $("#modal-card");
  c.innerHTML = html; m.hidden = false;
  m.onclick = (e) => { if (e.target === m) closeModal(); };
}
function closeModal() { $("#modal").hidden = true; }

function handleBack() {
  if (!$("#modal").hidden) { closeModal(); return true; }
  if ($("#screen-app").classList.contains("active") && state.currentScreen !== "overview") {
    navigateTo("overview"); return true;
  }
  return false;
}
window.handleBack = handleBack;

/* ========== Native bridge wrapper ========== */
async function rosCmd(path, params = {}) {
  if (!hasBridge) throw new Error("الجسر الأصلي غير متاح — شغّل التطبيق على الهاتف.");
  const res = JSON.parse(MikroTik.command(path, JSON.stringify(params)));
  if (!res.ok) throw new Error(res.error || "فشل التنفيذ");
  return res.data;
}

async function rosConnect(conn) {
  if (!hasBridge) throw new Error("الجسر الأصلي غير متاح.");
  const res = JSON.parse(MikroTik.connect(JSON.stringify(conn)));
  if (!res.ok) throw new Error(res.error || "فشل الاتصال");
  return res.data;
}

function rosDisconnect() { if (hasBridge) MikroTik.disconnect(); }

/* ========== Connection storage ========== */
function loadConns() {
  try { return JSON.parse(localStorage.getItem(CONNS_KEY)) || []; } catch { return []; }
}
function saveConns(list) { localStorage.setItem(CONNS_KEY, JSON.stringify(list)); }

function rememberConn(conn) {
  const list = loadConns();
  const key = `${conn.host}:${conn.port}|${conn.username}`;
  const idx = list.findIndex(x => `${x.host}:${x.port}|${x.username}` === key);
  if (idx >= 0) list[idx] = conn; else list.unshift(conn);
  saveConns(list.slice(0, 8));
  localStorage.setItem(ACTIVE_CONN_KEY, JSON.stringify(conn));
}

function renderConnList() {
  const list = loadConns();
  const box = $("#conn-list");
  if (!list.length) { box.innerHTML = ""; return; }
  box.innerHTML = list.map((c, i) => `
    <div class="conn-list-row">
      <div class="name">${esc(c.name || c.host)}</div>
      <div class="host">${esc(c.host)}:${esc(c.port)} (${esc(c.version)})</div>
      <button data-load="${i}" title="استرجاع">↩</button>
      <button data-del="${i}" title="حذف">×</button>
    </div>
  `).join("");
  box.querySelectorAll("[data-load]").forEach(b => b.onclick = () => fillForm(list[+b.dataset.load]));
  box.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
    const l = loadConns(); l.splice(+b.dataset.del, 1); saveConns(l); renderConnList();
  });
}
function fillForm(c) {
  $("#version").value = c.version; $("#version").dispatchEvent(new Event("change"));
  $("#host").value = c.host; $("#port").value = c.port;
  $("#username").value = c.username; $("#password").value = c.password || "";
  $("#https").checked = !!c.https; $("#conn-name").value = c.name || "";
}

/* ========== Connect form ========== */
$("#version").addEventListener("change", (e) => {
  const v6 = e.target.value === "v6";
  $("#https-row").hidden = v6;
  if (!$("#port").value || ["8728","443","80","8729"].includes($("#port").value))
    $("#port").value = v6 ? "8728" : ($("#https").checked ? "443" : "80");
});

$("#connect-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const conn = {
    version: $("#version").value,
    host: $("#host").value.trim(),
    port: Number($("#port").value || 8728),
    username: $("#username").value.trim() || "admin",
    password: $("#password").value,
    https: $("#https").checked,
    name: $("#conn-name").value.trim(),
  };
  const msg = $("#connect-msg");
  const btn = $("#btn-connect");
  msg.className = "msg"; msg.textContent = "جارٍ الاتصال…"; btn.disabled = true;
  try {
    const data = await rosConnect(conn);
    state.conn = conn;
    state.routerInfo.name = data.identity || conn.host;
    rememberConn(conn);
    msg.className = "msg ok"; msg.textContent = "تم الاتصال ✔";
    enterApp();
  } catch (err) {
    msg.className = "msg error"; msg.textContent = "فشل: " + err.message;
  } finally { btn.disabled = false; }
});

function enterApp() {
  $("#screen-connect").classList.remove("active");
  $("#screen-app").classList.add("active");
  $("#router-name").textContent = state.routerInfo.name;
  $("#router-sub").textContent = `${state.conn.host} • ${state.conn.version.toUpperCase()}`;
  $("#router-sub").classList.remove("off");
  navigateTo("overview");
}

function leaveApp() {
  rosDisconnect();
  state.conn = null;
  if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; }
  $("#screen-app").classList.remove("active");
  $("#screen-connect").classList.add("active");
}

$("#btn-logout").addEventListener("click", leaveApp);
$("#btn-refresh").addEventListener("click", () => renderScreen(state.currentScreen, true));

/* ========== Navigation ========== */
$$(".nav-btn").forEach(b => b.addEventListener("click", () => navigateTo(b.dataset.screen)));

function navigateTo(name) {
  state.currentScreen = name;
  $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.screen === name));
  renderScreen(name);
}

async function renderScreen(name, force = false) {
  const main = $("#main");
  const renderers = { overview, active, vouchers, users, more };
  const fn = renderers[name];
  if (!fn) { main.innerHTML = ""; return; }
  if (!force) main.innerHTML = '<div class="loading">جارٍ التحميل…</div>';
  try { await fn(main); }
  catch (e) { main.innerHTML = `<div class="panel"><div class="empty">خطأ: ${esc(e.message)}</div></div>`; }
}

/* ============================================================
   شاشة 1: نظرة عامة
   ============================================================ */
async function overview(main) {
  const [res, ident, active] = await Promise.all([
    rosCmd("/system/resource", {}).catch(() => [{}]),
    rosCmd("/system/identity", {}).catch(() => [{}]),
    rosCmd("/ip/hotspot/active", {}).catch(() => []),
  ]);
  const r = res[0] || {};
  const id = ident[0] || {};
  const cpu = Number(r["cpu-load"] || 0);
  const totalMem = Number(r["total-memory"] || 0);
  const freeMem = Number(r["free-memory"] || 0);
  const memPct = totalMem ? Math.round((1 - freeMem/totalMem) * 100) : 0;

  $("#router-name").textContent = id.name || state.routerInfo.name;

  main.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>الراوتر</h2><span class="sub">${esc(r.version || "")}</span></div>
      <dl class="kv">
        <dt>الاسم</dt><dd>${esc(id.name || "—")}</dd>
        <dt>الموديل</dt><dd>${esc(r["board-name"] || "—")}</dd>
        <dt>المعمارية</dt><dd>${esc(r["architecture-name"] || "—")}</dd>
        <dt>مدة التشغيل</dt><dd>${esc(fmtUptime(r.uptime))}</dd>
      </dl>
    </div>

    <div class="stats-grid">
      <div class="stat cyan"><div class="v">${cpu}%</div><div class="l">المعالج (CPU)</div>
        <div class="bar"><div style="width:${cpu}%"></div></div></div>
      <div class="stat ${memPct > 80 ? "warning" : "cyan"}">
        <div class="v">${memPct}%</div><div class="l">الذاكرة (RAM)</div>
        <div class="bar"><div style="width:${memPct}%"></div></div></div>
      <div class="stat success"><div class="v">${active.length}</div><div class="l">جلسات نشطة</div></div>
      <div class="stat"><div class="v">${fmtBytes(freeMem)}</div><div class="l">ذاكرة حرة</div></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>إجراءات سريعة</h2></div>
      <div class="actions" style="flex-wrap:wrap;">
        <button class="ghost" id="btn-create-batch">🎫 إنشاء كروت</button>
        <button class="ghost" id="btn-view-sales">💰 المبيعات اليوم</button>
        <button class="ghost" id="btn-reboot">⟲ إعادة تشغيل</button>
      </div>
    </div>
  `;

  $("#btn-create-batch").onclick = () => { navigateTo("vouchers"); setTimeout(openBatchModal, 200); };
  $("#btn-view-sales").onclick = () => navigateTo("more");
  $("#btn-reboot").onclick = async () => {
    if (!confirm("إعادة تشغيل الراوتر؟ سينقطع الاتصال مؤقتاً.")) return;
    try { await rosCmd("/system/reboot", { _method: "POST" }); showToast("تم إرسال أمر إعادة التشغيل"); }
    catch (e) { showToast("فشل: " + e.message); }
  };

  if (!state.refreshTimer) {
    state.refreshTimer = setInterval(() => {
      if (state.currentScreen === "overview") renderScreen("overview", true);
    }, 8000);
  }
}

/* ============================================================
   شاشة 2: المتصلون نشطاً
   ============================================================ */
async function active(main) {
  const list = await rosCmd("/ip/hotspot/active", {}).catch(() => []);
  state.cache.activeUsers = list;

  main.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>المتصلون الآن</h2>
        <span class="sub">${list.length} جلسة</span>
      </div>
      <div class="list" id="active-list">
        ${list.length ? "" : '<div class="empty">لا يوجد متصلون حالياً.</div>'}
      </div>
    </div>
  `;

  const box = $("#active-list");
  box.innerHTML = list.map(u => `
    <div class="item">
      <header>
        <strong>${esc(u.user || u.name || "—")}</strong>
        <span class="badge cyan">${esc(u.address || "")}</span>
      </header>
      <div class="meta">
        <span>MAC: ${esc(u["mac-address"] || "—")}</span>
        <span>مدة: ${esc(fmtUptime(u.uptime))}</span>
      </div>
      <div class="meta">
        <span>⬇ ${fmtBytes(u["bytes-in"])}</span>
        <span>⬆ ${fmtBytes(u["bytes-out"])}</span>
        <span>${esc(u["login-by"] || "")}</span>
      </div>
      <div class="row-actions">
        <button class="danger" data-kick="${esc(u[".id"])}" data-name="${esc(u.user)}">قطع الاتصال</button>
      </div>
    </div>
  `).join("");

  box.querySelectorAll("[data-kick]").forEach(b => b.onclick = async () => {
    if (!confirm(`قطع اتصال ${b.dataset.name}؟`)) return;
    try {
      await rosCmd("/ip/hotspot/active", { _method: "DELETE", _id: b.dataset.kick });
      showToast("تم قطع الاتصال");
      renderScreen("active", true);
    } catch (e) { showToast("فشل: " + e.message); }
  });
}

/* ============================================================
   شاشة 3: الكروت (Vouchers / Hotspot users)
   ============================================================ */
async function vouchers(main) {
  const [users, profiles] = await Promise.all([
    rosCmd("/ip/hotspot/user", {}).catch(() => []),
    rosCmd("/ip/hotspot/user/profile", {}).catch(() => []),
  ]);
  state.cache.vouchers = users; state.cache.profiles = profiles;

  // Categorize: unused vs used (have last-logged-in or uptime)
  const used = users.filter(u => u.uptime && u.uptime !== "00:00:00");
  const unused = users.filter(u => !u.uptime || u.uptime === "00:00:00");

  main.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>كروت الهوت سبوت</h2>
        <button class="primary" style="flex:0 0 auto;" id="btn-new-batch">+ مجموعة جديدة</button>
      </div>
      <div class="stats-grid">
        <div class="stat success"><div class="v">${used.length}</div><div class="l">كروت مستخدمة</div></div>
        <div class="stat cyan"><div class="v">${unused.length}</div><div class="l">كروت متاحة</div></div>
      </div>
    </div>

    <div class="panel">
      <div class="tabs">
        <button class="active" data-tab="all">الكل (${users.length})</button>
        <button data-tab="unused">متاحة (${unused.length})</button>
        <button data-tab="used">مستخدمة (${used.length})</button>
      </div>
      <div class="list" id="vouchers-list"></div>
    </div>
  `;

  let filter = "all";
  const render = () => {
    const arr = filter === "unused" ? unused : filter === "used" ? used : users;
    const box = $("#vouchers-list");
    if (!arr.length) { box.innerHTML = '<div class="empty">لا توجد كروت.</div>'; return; }
    box.innerHTML = arr.slice(0, 100).map(u => `
      <div class="item">
        <header>
          <strong>${esc(u.name)}</strong>
          <span class="badge ${u.disabled === "true" ? "danger" : (u.uptime && u.uptime !== "00:00:00" ? "success" : "cyan")}">
            ${u.disabled === "true" ? "موقوف" : (u.uptime && u.uptime !== "00:00:00" ? "مستخدم" : "متاح")}
          </span>
        </header>
        <div class="meta">
          <span>كلمة: ${esc(u.password || "—")}</span>
          <span>بروفايل: ${esc(u.profile || "default")}</span>
        </div>
        <div class="meta">
          <span>مدة: ${esc(fmtUptime(u.uptime))}</span>
          <span>⬇${fmtBytes(u["bytes-in"])}</span>
          <span>⬆${fmtBytes(u["bytes-out"])}</span>
        </div>
        <div class="row-actions">
          <button data-print="${esc(u[".id"])}">🖨️ طباعة</button>
          <button data-toggle="${esc(u[".id"])}" data-dis="${u.disabled === "true" ? "false" : "true"}">
            ${u.disabled === "true" ? "تفعيل" : "إيقاف"}
          </button>
          <button class="danger" data-del="${esc(u[".id"])}" data-name="${esc(u.name)}">حذف</button>
        </div>
      </div>
    `).join("") + (arr.length > 100 ? `<div class="empty">عرض 100 من ${arr.length}.</div>` : "");

    box.querySelectorAll("[data-print]").forEach(b => b.onclick = () => {
      const u = users.find(x => x[".id"] === b.dataset.print);
      if (u) printVouchers([u]);
    });
    box.querySelectorAll("[data-toggle]").forEach(b => b.onclick = async () => {
      try {
        await rosCmd("/ip/hotspot/user", { ".id": b.dataset.toggle, disabled: b.dataset.dis,
          _method: "PATCH", _id: b.dataset.toggle });
        showToast("تم الحفظ");
        renderScreen("vouchers", true);
      } catch (e) { showToast("فشل: " + e.message); }
    });
    box.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      if (!confirm(`حذف الكرت ${b.dataset.name}؟`)) return;
      try {
        await rosCmd("/ip/hotspot/user", { ".id": b.dataset.del, _method: "DELETE", _id: b.dataset.del });
        showToast("تم الحذف");
        renderScreen("vouchers", true);
      } catch (e) { showToast("فشل: " + e.message); }
    });
  };
  render();
  $$(".tabs button", main).forEach(b => b.onclick = () => {
    $$(".tabs button", main).forEach(x => x.classList.remove("active"));
    b.classList.add("active"); filter = b.dataset.tab; render();
  });
  $("#btn-new-batch").onclick = openBatchModal;
}

function openBatchModal() {
  const profs = state.cache.profiles;
  openModal(`
    <h3>إنشاء مجموعة كروت</h3>
    <label>عدد الكروت
      <input type="number" id="b-count" min="1" max="500" value="20" />
    </label>
    <label>البروفايل
      <select id="b-profile">
        ${profs.length ? profs.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("")
          : '<option value="default">default</option>'}
      </select>
    </label>
    <label>طول اليوزر/كلمة المرور
      <select id="b-length">
        <option value="4">4 حروف/أرقام</option>
        <option value="5">5</option>
        <option value="6" selected>6</option>
        <option value="8">8</option>
      </select>
    </label>
    <label>النوع
      <select id="b-type">
        <option value="alphanum">حروف وأرقام (سهل)</option>
        <option value="digits">أرقام فقط</option>
        <option value="letters">حروف فقط</option>
      </select>
    </label>
    <label>بادئة الاسم (اختياري)
      <input type="text" id="b-prefix" placeholder="مثلاً: w" maxlength="6" />
    </label>
    <label class="row">
      <input type="checkbox" id="b-same" /> نفس اليوزر يساوي كلمة المرور
    </label>
    <label>سعر الكرت (لتقرير المبيعات)
      <input type="number" id="b-price" min="0" step="0.5" value="0" />
    </label>
    <div class="actions">
      <button class="primary" id="b-go">إنشاء</button>
      <button class="ghost" onclick="closeModal()">إلغاء</button>
    </div>
    <div id="b-msg" class="msg"></div>
  `);

  $("#b-go").onclick = async () => {
    const count = Math.min(500, Math.max(1, Number($("#b-count").value)));
    const profile = $("#b-profile").value;
    const len = Number($("#b-length").value);
    const type = $("#b-type").value;
    const prefix = $("#b-prefix").value.trim();
    const same = $("#b-same").checked;
    const price = Number($("#b-price").value || 0);

    const charset = type === "digits" ? "0123456789"
      : type === "letters" ? "abcdefghjkmnpqrstuvwxyz"
      : "abcdefghjkmnpqrstuvwxyz23456789";

    const rnd = (n) => Array.from({length: n}, () =>
      charset[Math.floor(Math.random() * charset.length)]).join("");

    const created = [];
    const msg = $("#b-msg");
    msg.className = "msg"; msg.textContent = `جارٍ الإنشاء 0 / ${count}…`;
    $("#b-go").disabled = true;
    for (let i = 0; i < count; i++) {
      const username = prefix + rnd(len - prefix.length > 0 ? len - prefix.length : len);
      const password = same ? username : rnd(len);
      try {
        await rosCmd("/ip/hotspot/user", { name: username, password, profile,
          _method: "PUT" });
        created.push({ name: username, password, profile });
        msg.textContent = `تم ${i+1} / ${count}…`;
      } catch (e) {
        msg.className = "msg error"; msg.textContent = "فشل: " + e.message;
        break;
      }
    }
    $("#b-go").disabled = false;
    if (created.length) {
      addSalesEntry({ count: created.length, profile, price, total: created.length * price, createdAt: nowIso() });
      msg.className = "msg ok"; msg.textContent = `تم إنشاء ${created.length} كرت ✔`;
      closeModal();
      showToast(`تم إنشاء ${created.length} كرت — جارٍ التحضير للطباعة…`);
      setTimeout(() => printVouchers(created), 500);
      renderScreen("vouchers", true);
    }
  };
}

/* ============================================================
   شاشة 4: مستخدمو الـ Hotspot / User Manager
   ============================================================ */
async function users(main) {
  const list = await rosCmd("/ip/hotspot/user", {}).catch(() => []);
  state.cache.users = list;

  main.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>مستخدمو الهوت سبوت</h2>
        <button class="primary" style="flex:0 0 auto;" id="btn-new-user">+ مستخدم</button>
      </div>
      <input type="search" id="u-search" placeholder="بحث..." style="width:100%;margin-bottom:10px;
        background:var(--bg-2);color:var(--text);border:1px solid var(--border);
        border-radius:10px;padding:10px 12px;" />
      <div class="list" id="users-list"></div>
    </div>
  `;

  const render = (q = "") => {
    const ql = q.toLowerCase();
    const filtered = list.filter(u => !ql || (u.name || "").toLowerCase().includes(ql)
      || (u.profile || "").toLowerCase().includes(ql));
    const box = $("#users-list");
    if (!filtered.length) { box.innerHTML = '<div class="empty">لا يوجد.</div>'; return; }
    box.innerHTML = filtered.slice(0, 80).map(u => `
      <div class="item">
        <header>
          <strong>${esc(u.name)}</strong>
          <span class="badge ${u.disabled === "true" ? "danger" : "success"}">
            ${u.disabled === "true" ? "موقوف" : "نشط"}
          </span>
        </header>
        <div class="meta">
          <span>بروفايل: ${esc(u.profile || "default")}</span>
          <span>عنوان: ${esc(u.address || "—")}</span>
        </div>
        <div class="meta">
          <span>مدة: ${esc(fmtUptime(u.uptime))}</span>
          <span>⬇${fmtBytes(u["bytes-in"])}</span>
          <span>⬆${fmtBytes(u["bytes-out"])}</span>
        </div>
        <div class="row-actions">
          <button data-edit="${esc(u[".id"])}">تعديل</button>
          <button data-toggle="${esc(u[".id"])}" data-dis="${u.disabled === "true" ? "false" : "true"}">
            ${u.disabled === "true" ? "تفعيل" : "إيقاف"}
          </button>
          <button data-print="${esc(u[".id"])}">🖨️</button>
          <button class="danger" data-del="${esc(u[".id"])}" data-name="${esc(u.name)}">حذف</button>
        </div>
      </div>
    `).join("");

    box.querySelectorAll("[data-edit]").forEach(b => b.onclick = () =>
      openUserModal(list.find(u => u[".id"] === b.dataset.edit)));
    box.querySelectorAll("[data-print]").forEach(b => b.onclick = () => {
      const u = list.find(x => x[".id"] === b.dataset.print);
      if (u) printVouchers([u]);
    });
    box.querySelectorAll("[data-toggle]").forEach(b => b.onclick = async () => {
      try {
        await rosCmd("/ip/hotspot/user", { ".id": b.dataset.toggle, disabled: b.dataset.dis,
          _method: "PATCH", _id: b.dataset.toggle });
        showToast("تم الحفظ"); renderScreen("users", true);
      } catch (e) { showToast("فشل: " + e.message); }
    });
    box.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      if (!confirm(`حذف ${b.dataset.name}؟`)) return;
      try {
        await rosCmd("/ip/hotspot/user", { ".id": b.dataset.del, _method: "DELETE", _id: b.dataset.del });
        showToast("تم الحذف"); renderScreen("users", true);
      } catch (e) { showToast("فشل: " + e.message); }
    });
  };

  render();
  $("#u-search").addEventListener("input", (e) => render(e.target.value.trim()));
  $("#btn-new-user").onclick = () => openUserModal(null);
}

function openUserModal(u) {
  const profs = state.cache.profiles;
  const isEdit = !!u;
  openModal(`
    <h3>${isEdit ? "تعديل مستخدم" : "مستخدم جديد"}</h3>
    <label>الاسم
      <input type="text" id="u-name" value="${esc(u?.name || "")}" ${isEdit ? "readonly" : ""} required />
    </label>
    <label>كلمة المرور
      <input type="text" id="u-pass" value="${esc(u?.password || "")}" />
    </label>
    <label>البروفايل
      <select id="u-prof">
        ${profs.length ? profs.map(p =>
          `<option value="${esc(p.name)}" ${u?.profile === p.name ? "selected" : ""}>${esc(p.name)}</option>`).join("")
          : '<option value="default">default</option>'}
      </select>
    </label>
    <label>الحد الزمني (مثل 1d, 6h)
      <input type="text" id="u-limit" value="${esc(u?.["limit-uptime"] || "")}" placeholder="فارغ = حسب البروفايل" />
    </label>
    <label>تعليق
      <input type="text" id="u-comment" value="${esc(u?.comment || "")}" />
    </label>
    <div class="actions">
      <button class="primary" id="u-save">حفظ</button>
      <button class="ghost" onclick="closeModal()">إلغاء</button>
    </div>
    <div id="u-msg" class="msg"></div>
  `);

  $("#u-save").onclick = async () => {
    const data = {
      name: $("#u-name").value.trim(),
      password: $("#u-pass").value,
      profile: $("#u-prof").value,
      comment: $("#u-comment").value,
    };
    const lu = $("#u-limit").value.trim();
    if (lu) data["limit-uptime"] = lu;
    if (!data.name) { $("#u-msg").className = "msg error"; $("#u-msg").textContent = "الاسم مطلوب"; return; }
    try {
      if (isEdit) {
        data[".id"] = u[".id"];
        await rosCmd("/ip/hotspot/user", { ...data, _method: "PATCH", _id: u[".id"] });
      } else {
        await rosCmd("/ip/hotspot/user", { ...data, _method: "PUT" });
      }
      showToast("تم الحفظ"); closeModal(); renderScreen("users", true);
    } catch (e) {
      $("#u-msg").className = "msg error"; $("#u-msg").textContent = "فشل: " + e.message;
    }
  };
}

/* ============================================================
   شاشة 5: المزيد (بروفايلات، تقارير، إعدادات الطباعة)
   ============================================================ */
async function more(main) {
  main.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>المزيد</h2></div>
      <div class="list">
        <button class="ghost" id="m-profiles">⚙️ البروفايلات والسرعات</button>
        <button class="ghost" id="m-sales">💰 تقرير المبيعات</button>
        <button class="ghost" id="m-usage">📊 تقرير الاستهلاك</button>
        <button class="ghost" id="m-template">🖨️ قالب الطباعة</button>
        <button class="ghost" id="m-interfaces">📡 الواجهات والأجهزة</button>
      </div>
    </div>
    <div id="more-body"></div>
  `;
  $("#m-profiles").onclick = () => showProfiles($("#more-body"));
  $("#m-sales").onclick = () => showSales($("#more-body"));
  $("#m-usage").onclick = () => showUsage($("#more-body"));
  $("#m-template").onclick = () => showTemplateEditor($("#more-body"));
  $("#m-interfaces").onclick = () => showInterfaces($("#more-body"));
}

async function showProfiles(box) {
  box.innerHTML = '<div class="loading">جارٍ التحميل…</div>';
  const profs = await rosCmd("/ip/hotspot/user/profile", {});
  state.cache.profiles = profs;
  box.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>البروفايلات</h2>
        <button class="primary" style="flex:0 0 auto;" id="p-add">+ بروفايل</button>
      </div>
      <div class="list">
        ${profs.map(p => `
          <div class="item">
            <header><strong>${esc(p.name)}</strong>
              <span class="badge cyan">${esc(p["rate-limit"] || "بدون حد")}</span></header>
            <div class="meta">
              <span>المدة: ${esc(p["session-timeout"] || "—")}</span>
              <span>الخمول: ${esc(p["idle-timeout"] || "—")}</span>
              <span>مشتركون: ${esc(p["shared-users"] || "1")}</span>
            </div>
            <div class="row-actions">
              <button data-edit="${esc(p[".id"])}">تعديل</button>
            </div>
          </div>
        `).join("") || '<div class="empty">لا توجد بروفايلات.</div>'}
      </div>
    </div>
  `;
  box.querySelectorAll("[data-edit]").forEach(b => b.onclick = () =>
    openProfileModal(profs.find(p => p[".id"] === b.dataset.edit)));
  $("#p-add").onclick = () => openProfileModal(null);
}

function openProfileModal(p) {
  const isEdit = !!p;
  openModal(`
    <h3>${isEdit ? "تعديل بروفايل" : "بروفايل جديد"}</h3>
    <label>الاسم
      <input type="text" id="p-name" value="${esc(p?.name || "")}" ${isEdit ? "readonly" : ""} required />
    </label>
    <label>حد السرعة (مثل 2M/2M أو 5M/10M)
      <input type="text" id="p-rate" value="${esc(p?.["rate-limit"] || "")}" placeholder="upload/download" />
    </label>
    <label>مدة الجلسة (مثل 1d, 6h)
      <input type="text" id="p-session" value="${esc(p?.["session-timeout"] || "")}" />
    </label>
    <label>وقت الخمول (مثل 5m)
      <input type="text" id="p-idle" value="${esc(p?.["idle-timeout"] || "")}" />
    </label>
    <label>عدد المشتركين المتزامن
      <input type="number" id="p-shared" min="1" value="${esc(p?.["shared-users"] || "1")}" />
    </label>
    <div class="actions">
      <button class="primary" id="p-save">حفظ</button>
      <button class="ghost" onclick="closeModal()">إلغاء</button>
    </div>
    <div id="p-msg" class="msg"></div>
  `);
  $("#p-save").onclick = async () => {
    const data = {
      name: $("#p-name").value.trim(),
      "rate-limit": $("#p-rate").value.trim(),
      "session-timeout": $("#p-session").value.trim(),
      "idle-timeout": $("#p-idle").value.trim(),
      "shared-users": $("#p-shared").value,
    };
    Object.keys(data).forEach(k => { if (!data[k]) delete data[k]; });
    if (!data.name) { $("#p-msg").className = "msg error"; $("#p-msg").textContent = "الاسم مطلوب"; return; }
    try {
      if (isEdit) await rosCmd("/ip/hotspot/user/profile", { ...data, ".id": p[".id"], _method: "PATCH", _id: p[".id"] });
      else await rosCmd("/ip/hotspot/user/profile", { ...data, _method: "PUT" });
      showToast("تم الحفظ"); closeModal();
      navigateTo("more"); setTimeout(() => $("#m-profiles").click(), 50);
    } catch (e) {
      $("#p-msg").className = "msg error"; $("#p-msg").textContent = "فشل: " + e.message;
    }
  };
}

/* ============================================================
   التقارير
   ============================================================ */
function loadSales() {
  try { return JSON.parse(localStorage.getItem(SALES_KEY)) || []; } catch { return []; }
}
function addSalesEntry(e) {
  const list = loadSales(); list.unshift({ id: rndId("s"), ...e });
  localStorage.setItem(SALES_KEY, JSON.stringify(list.slice(0, 1000)));
}

function showSales(box) {
  const sales = loadSales();
  const today = todayIso();
  const todaySales = sales.filter(s => s.createdAt.startsWith(today));
  const todayTotal = todaySales.reduce((a, b) => a + (b.total || 0), 0);
  const todayCount = todaySales.reduce((a, b) => a + (b.count || 0), 0);

  // last 7 days chart
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0,10);
    const label = d.toLocaleDateString("ar-LY", { weekday: "short" });
    const total = sales.filter(s => s.createdAt.startsWith(key)).reduce((a,b) => a + (b.total||0), 0);
    days.push({ key, label, total });
  }
  const max = Math.max(1, ...days.map(d => d.total));

  box.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>المبيعات اليوم</h2>
        <button class="ghost" id="sales-clear">مسح السجل</button>
      </div>
      <div class="stats-grid">
        <div class="stat success"><div class="v">${todayTotal.toFixed(2)}</div><div class="l">إجمالي اليوم</div></div>
        <div class="stat cyan"><div class="v">${todayCount}</div><div class="l">كروت اليوم</div></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>آخر 7 أيام</h2></div>
      <div class="chart">
        ${days.map(d => `
          <div class="col">
            <div class="bar-fill" style="height:${Math.round((d.total/max)*100)}px"></div>
            <div class="lbl">${esc(d.label)}</div>
            <div class="lbl">${d.total.toFixed(0)}</div>
          </div>
        `).join("")}
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>سجل العمليات</h2>
        <span class="sub">${sales.length} عملية</span>
      </div>
      <div class="list">
        ${sales.slice(0, 30).map(s => `
          <div class="item">
            <header>
              <strong>${esc(s.profile || "—")} × ${s.count}</strong>
              <span class="badge success">${(s.total||0).toFixed(2)}</span>
            </header>
            <div class="meta">
              <span>${esc(new Date(s.createdAt).toLocaleString("ar-LY"))}</span>
              <span>سعر/كرت: ${(s.price||0).toFixed(2)}</span>
            </div>
          </div>
        `).join("") || '<div class="empty">لا توجد عمليات. أنشئ كروتاً بسعر لتسجيلها هنا.</div>'}
      </div>
    </div>
  `;
  $("#sales-clear").onclick = () => {
    if (!confirm("مسح كل سجل المبيعات؟")) return;
    localStorage.removeItem(SALES_KEY);
    showSales(box);
  };
}

async function showUsage(box) {
  box.innerHTML = '<div class="loading">جارٍ التحميل…</div>';
  const users = await rosCmd("/ip/hotspot/user", {});
  const sorted = users
    .filter(u => (Number(u["bytes-in"]||0) + Number(u["bytes-out"]||0)) > 0)
    .sort((a,b) => (Number(b["bytes-in"]||0)+Number(b["bytes-out"]||0))
                 - (Number(a["bytes-in"]||0)+Number(a["bytes-out"]||0)))
    .slice(0, 30);

  const totalIn = users.reduce((a,b) => a + Number(b["bytes-in"]||0), 0);
  const totalOut = users.reduce((a,b) => a + Number(b["bytes-out"]||0), 0);

  box.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>الاستهلاك الكلي</h2></div>
      <div class="stats-grid">
        <div class="stat cyan"><div class="v">${fmtBytes(totalIn)}</div><div class="l">إجمالي التحميل ⬇</div></div>
        <div class="stat success"><div class="v">${fmtBytes(totalOut)}</div><div class="l">إجمالي الرفع ⬆</div></div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>أعلى 30 مستخدماً</h2></div>
      <div class="list">
        ${sorted.map((u, i) => `
          <div class="item">
            <header>
              <strong>${i+1}. ${esc(u.name)}</strong>
              <span class="badge cyan">${fmtBytes(Number(u["bytes-in"]||0)+Number(u["bytes-out"]||0))}</span>
            </header>
            <div class="meta">
              <span>⬇ ${fmtBytes(u["bytes-in"])}</span>
              <span>⬆ ${fmtBytes(u["bytes-out"])}</span>
              <span>${esc(u.profile || "")}</span>
            </div>
          </div>
        `).join("") || '<div class="empty">لا توجد بيانات استهلاك.</div>'}
      </div>
    </div>
  `;
}

async function showInterfaces(box) {
  box.innerHTML = '<div class="loading">جارٍ التحميل…</div>';
  try {
    const [ifs, leases] = await Promise.all([
      rosCmd("/interface", {}).catch(() => []),
      rosCmd("/ip/dhcp-server/lease", {}).catch(() => []),
    ]);
    box.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h2>الواجهات</h2></div>
        <div class="list">
          ${ifs.map(i => `
            <div class="item">
              <header><strong>${esc(i.name)}</strong>
                <span class="badge ${i.running === "true" ? "success" : "danger"}">
                  ${i.running === "true" ? "نشطة" : "متوقفة"}
                </span></header>
              <div class="meta">
                <span>${esc(i.type || "")}</span>
                <span>MAC: ${esc(i["mac-address"] || "—")}</span>
              </div>
              <div class="meta">
                <span>⬇ ${fmtBytes(i["rx-byte"])}</span>
                <span>⬆ ${fmtBytes(i["tx-byte"])}</span>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>الأجهزة المتصلة (DHCP)</h2>
          <span class="sub">${leases.length} جهازاً</span></div>
        <div class="list">
          ${leases.slice(0, 50).map(l => `
            <div class="item">
              <header><strong>${esc(l["host-name"] || l.address)}</strong>
                <span class="badge ${l.status === "bound" ? "success" : "warning"}">${esc(l.status)}</span>
              </header>
              <div class="meta">
                <span>IP: ${esc(l.address)}</span>
                <span>MAC: ${esc(l["mac-address"])}</span>
              </div>
            </div>
          `).join("") || '<div class="empty">لا توجد إيجارات.</div>'}
        </div>
      </div>
    `;
  } catch (e) {
    box.innerHTML = `<div class="panel"><div class="empty">خطأ: ${esc(e.message)}</div></div>`;
  }
}

/* ============================================================
   قالب الطباعة
   ============================================================ */
function loadTemplate() {
  try { return { ...DEFAULT_TEMPLATE, ...(JSON.parse(localStorage.getItem(TEMPLATE_KEY)) || {}) }; }
  catch { return { ...DEFAULT_TEMPLATE }; }
}
function saveTemplate(t) { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(t)); }

function showTemplateEditor(box) {
  const t = loadTemplate();
  box.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>قالب طباعة الكروت</h2></div>
      <label>العنوان <input type="text" id="t-title" value="${esc(t.title)}" /></label>
      <label>سطر فرعي <input type="text" id="t-sub" value="${esc(t.subtitle)}" /></label>
      <label>اسم الشبكة <input type="text" id="t-net" value="${esc(t.network)}" /></label>
      <label>التذييل <input type="text" id="t-foot" value="${esc(t.footer)}" /></label>
      <label>كروت في الصفحة
        <select id="t-per">
          ${[4,6,8,10,12].map(n => `<option value="${n}" ${t.perPage===n?"selected":""}>${n}</option>`).join("")}
        </select>
      </label>
      <label class="row"><input type="checkbox" id="t-prof" ${t.showProfile?"checked":""}/> إظهار البروفايل</label>
      <label class="row"><input type="checkbox" id="t-val" ${t.showValidity?"checked":""}/> إظهار المدة</label>
      <div class="actions" style="margin-top:8px;">
        <button class="primary" id="t-save">حفظ</button>
        <button class="ghost" id="t-prev">معاينة</button>
      </div>
    </div>
  `;
  const collect = () => ({
    title: $("#t-title").value, subtitle: $("#t-sub").value,
    network: $("#t-net").value, footer: $("#t-foot").value,
    perPage: Number($("#t-per").value), showProfile: $("#t-prof").checked,
    showValidity: $("#t-val").checked,
  });
  $("#t-save").onclick = () => { saveTemplate(collect()); showToast("تم حفظ القالب"); };
  $("#t-prev").onclick = () => {
    saveTemplate(collect());
    const sample = Array.from({length: 4}, (_, i) => ({
      name: "demo" + (1000+i), password: "pass" + (1000+i), profile: "1day"
    }));
    printVouchers(sample);
  };
}

/* ============================================================
   إنتاج HTML للطباعة وإرساله للنظام
   ============================================================ */
function buildVouchersHtml(vouchers) {
  const t = loadTemplate();
  const cardWidthPct = 100 / 2; // 2 columns
  const css = `
    <style>
      @page { size: A4; margin: 8mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, "Cairo", sans-serif; margin: 0; direction: rtl; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
      .card { border: 1px dashed #333; border-radius: 4mm; padding: 4mm; text-align: center;
        page-break-inside: avoid; }
      .title { font-size: 12pt; font-weight: bold; margin: 0 0 1mm; }
      .net { font-size: 9pt; color: #555; margin: 0 0 2mm; }
      .creds { display: grid; grid-template-columns: auto 1fr; gap: 1mm 3mm;
        font-size: 11pt; text-align: start; margin: 2mm 0; }
      .creds dt { color: #666; }
      .creds dd { margin: 0; font-family: "Courier New", monospace; font-weight: bold; }
      .meta { font-size: 8pt; color: #666; }
      .foot { font-size: 7.5pt; color: #888; margin-top: 2mm; }
    </style>
  `;
  const cards = vouchers.map(v => `
    <div class="card">
      <div class="title">${esc(t.title)}</div>
      <div class="net">${esc(t.network)}</div>
      <dl class="creds">
        <dt>المستخدم</dt><dd>${esc(v.name)}</dd>
        <dt>كلمة المرور</dt><dd>${esc(v.password)}</dd>
      </dl>
      ${t.showProfile && v.profile ? `<div class="meta">البروفايل: ${esc(v.profile)}</div>` : ""}
      ${t.showValidity ? `<div class="meta">${esc(t.subtitle)}</div>` : ""}
      <div class="foot">${esc(t.footer)}</div>
    </div>
  `).join("");
  return `<!doctype html><html dir="rtl"><head><meta charset="UTF-8" />${css}</head>
    <body><div class="grid">${cards}</div></body></html>`;
}

function printVouchers(vouchers) {
  const html = buildVouchersHtml(vouchers);
  if (hasPrinter) {
    Printer.printHtml(html, "MicroNet Vouchers");
  } else {
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.print(); }
    else showToast("الطباعة تتطلب تشغيل التطبيق الأصلي");
  }
}

/* ============================================================
   Bootstrap
   ============================================================ */
function init() {
  // Debug banner — confirms JS is alive
  const tag = $(".brand .tag");
  if (tag) tag.textContent = "إدارة شبكات MikroTik — JS ✓ Bridge " + (hasBridge ? "✓" : "✗");

  renderConnList();
  try {
    const last = JSON.parse(localStorage.getItem(ACTIVE_CONN_KEY));
    if (last) fillForm(last);
  } catch {}
  $("#version").dispatchEvent(new Event("change"));
  if (!hasBridge) {
    const msg = $("#connect-msg");
    msg.className = "msg";
    msg.innerHTML = "⚠️ لا يوجد جسر أصلي — يجب تشغيل التطبيق من APK المُجمَّع، وليس من المتصفح.";
  }
}
window.addEventListener("DOMContentLoaded", init);
if (document.readyState !== "loading") init();
