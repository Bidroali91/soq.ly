/* ===== اشتراكات ستارلينك — منطق التطبيق ===== */

const STORAGE_KEY = "starlink-subs-v2";
const SETTINGS_KEY = "starlink-settings-v1";
const THEME_KEY = "starlink-theme";

const DEFAULT_SETTINGS = {
  businessName: "ستارلينك ليبيا",
  defaultCurrency: "LYD",
  defaultAmount: 450,
  countryCode: "218",
  reminderTemplate:
    "السلام عليكم {name}،\nنذكّركم باستحقاق اشتراك ستارلينك (رقم الخدمة: {serviceId}) بمبلغ {amount} في {dueDate}.\nشكراً لتعاونكم.",
};

const state = {
  subscriptions: [],
  activities: [],
  settings: { ...DEFAULT_SETTINGS },
  editingId: "",
  search: "",
  status: "all",
  sort: "dueDate",
  view: "table",
};

const today = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const el = {
  overdueCount: $("#overdueCount"),
  overdueAmount: $("#overdueAmount"),
  dueSoonCount: $("#dueSoonCount"),
  dueSoonAmount: $("#dueSoonAmount"),
  paidCount: $("#paidCount"),
  paidAmount: $("#paidAmount"),
  expectedCount: $("#expectedCount"),
  expectedAmount: $("#expectedAmount"),
  totalCount: $("#totalCount"),
  activeCount: $("#activeCount"),
  resultCount: $("#resultCount"),
  body: $("#subscriptionsBody"),
  cards: $("#cardsView"),
  tableView: $("#tableView"),
  cardsView: $("#cardsView"),
  activityList: $("#activityList"),
  formPanel: $("#subscriptionFormPanel"),
  formTitle: $("#formTitle"),
  form: $("#subscriptionForm"),
  searchInput: $("#searchInput"),
  statusFilter: $("#statusFilter"),
  sortSelect: $("#sortSelect"),
  viewSelect: $("#viewSelect"),
  emailText: $("#emailText"),
  importPreview: $("#importPreview"),
  chart: $("#revenueChart"),
  chartTotal: $("#chartTotal"),
  settingsForm: $("#settingsForm"),
  toast: $("#toast"),
};

/* ===== Utilities ===== */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(amount, currency = state.settings.defaultCurrency) {
  const label = currency === "USD" ? "$" : currency === "EUR" ? "€" : "د.ل";
  const num = Number(amount || 0).toLocaleString("ar-LY", { maximumFractionDigits: 2 });
  return `${num} ${label}`;
}

function parseDate(value) {
  if (!value) return null;
  return new Date(`${value}T00:00:00`);
}

function dateDiffDays(dateValue) {
  const date = parseDate(dateValue);
  if (!date) return 9999;
  return Math.floor((date - today) / 86_400_000);
}

function localIso() { return new Date().toISOString(); }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function createLocalId(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }

function showToast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.toast.hidden = true; }, 2200);
}

function nativeBridge() { return typeof AndroidBridge !== "undefined" ? AndroidBridge : null; }

/* ===== Storage ===== */

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
      activities: Array.isArray(parsed.activities) ? parsed.activities : [],
    };
  } catch { return null; }
}

function saveStore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    subscriptions: state.subscriptions,
    activities: state.activities,
  }));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

async function loadSeedData() {
  try {
    const r = await fetch("data/starlink-subscriptions.json");
    const j = await r.json();
    return {
      subscriptions: Array.isArray(j.subscriptions) ? j.subscriptions : [],
      activities: Array.isArray(j.activities) ? j.activities : [],
    };
  } catch { return { subscriptions: [], activities: [] }; }
}

/* ===== Domain ===== */

function classify(sub) {
  if (sub.subscriptionStatus === "inactive") return { key: "inactive", label: "متوقف", className: "neutral" };
  if (sub.paymentStatus === "paid") return { key: "paid", label: "مدفوع", className: "success" };
  const days = dateDiffDays(sub.dueDate);
  if (days < 0) return { key: "overdue", label: `متأخر ${Math.abs(days)} يوم`, className: "danger" };
  if (days <= 7) return { key: "due-soon", label: days === 0 ? "مستحق اليوم" : `بعد ${days} أيام`, className: "warning" };
  return { key: "unpaid", label: "غير مدفوع", className: "neutral" };
}

function normalize(input, existing = {}) {
  const now = localIso();
  return {
    id: existing.id || createLocalId("sub"),
    customerName: String(input.customerName || "").trim(),
    serviceId: String(input.serviceId || "").trim(),
    email: String(input.email || "").trim(),
    phone: String(input.phone || "").trim(),
    city: String(input.city || "").trim(),
    dueDate: String(input.dueDate || "").trim(),
    cycle: ["monthly", "quarterly", "yearly", "none"].includes(input.cycle) ? input.cycle : (existing.cycle || "monthly"),
    amount: Number(input.amount || 0),
    currency: ["LYD", "USD", "EUR"].includes(input.currency) ? input.currency : state.settings.defaultCurrency,
    paymentStatus: input.paymentStatus === "paid" ? "paid" : "unpaid",
    subscriptionStatus: input.subscriptionStatus === "inactive" ? "inactive" : "active",
    lastPaidAt: input.paymentStatus === "paid"
      ? String(input.lastPaidAt || existing.lastPaidAt || input.dueDate || "").slice(0, 10)
      : (existing.lastPaidAt || ""),
    notes: String(input.notes || "").trim(),
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
}

function validate(sub) {
  if (!sub.customerName) throw new Error("اسم الزبون مطلوب");
  if (!sub.serviceId) throw new Error("رقم الخدمة مطلوب");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sub.dueDate)) throw new Error("تاريخ الاستحقاق مطلوب");
  if (!Number.isFinite(sub.amount) || sub.amount < 0) throw new Error("المبلغ غير صحيح");
}

function addActivity(type, text) {
  state.activities.unshift({ id: createLocalId("act"), type, text, createdAt: localIso() });
  state.activities = state.activities.slice(0, 100);
}

function advanceDate(iso, cycle) {
  const d = parseDate(iso);
  if (!d) return iso;
  if (cycle === "monthly") d.setMonth(d.getMonth() + 1);
  else if (cycle === "quarterly") d.setMonth(d.getMonth() + 3);
  else if (cycle === "yearly") d.setFullYear(d.getFullYear() + 1);
  else return iso;
  return d.toISOString().slice(0, 10);
}

function markPaid(id) {
  const sub = state.subscriptions.find((s) => s.id === id);
  if (!sub) return;
  const paidAt = todayIso();
  sub.lastPaidAt = paidAt;
  sub.updatedAt = localIso();

  if (sub.cycle && sub.cycle !== "none") {
    addActivity("payment", `تم تسجيل دفع ${sub.customerName} وتجديد الاشتراك`);
    sub.paymentStatus = "unpaid";
    sub.dueDate = advanceDate(sub.dueDate, sub.cycle);
  } else {
    sub.paymentStatus = "paid";
    addActivity("payment", `تم تسجيل دفع ${sub.customerName} بتاريخ ${paidAt}`);
  }
  saveStore();
}

function deleteSub(id) {
  const target = state.subscriptions.find((s) => s.id === id);
  state.subscriptions = state.subscriptions.filter((s) => s.id !== id);
  if (target) addActivity("delete", `تم حذف اشتراك ${target.customerName}`);
  saveStore();
}

function upsert(payload, id = "") {
  const idx = id ? state.subscriptions.findIndex((s) => s.id === id) : -1;
  const existing = idx >= 0 ? state.subscriptions[idx] : {};
  const sub = normalize(payload, existing);
  validate(sub);
  if (idx >= 0) {
    state.subscriptions[idx] = sub;
    addActivity("update", `تم تعديل اشتراك ${sub.customerName}`);
  } else {
    state.subscriptions.unshift(sub);
    addActivity("create", `تمت إضافة اشتراك ${sub.customerName}`);
  }
  saveStore();
}

/* ===== Email parsing (client-side, AR + EN) ===== */

const arDigits = "٠١٢٣٤٥٦٧٨٩";
function normalizeDigits(s) {
  return String(s || "").replace(/[٠-٩]/g, (d) => String(arDigits.indexOf(d)));
}

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  "يناير": 1, "كانون الثاني": 1, "فبراير": 2, "شباط": 2, "مارس": 3, "آذار": 3,
  "أبريل": 4, "نيسان": 4, "مايو": 5, "أيار": 5, "يونيو": 6, "حزيران": 6,
  "يوليو": 7, "تموز": 7, "أغسطس": 8, "آب": 8, "سبتمبر": 9, "أيلول": 9,
  "أكتوبر": 10, "تشرين الأول": 10, "نوفمبر": 11, "تشرين الثاني": 11, "ديسمبر": 12, "كانون الأول": 12,
};

function parseFlexibleDate(raw) {
  if (!raw) return "";
  const text = normalizeDigits(raw).trim();
  // ISO 2026-06-05
  let m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  // DD/MM/YYYY or DD-MM-YYYY
  m = text.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  }
  // "5 June 2026" / "June 5, 2026" / "٥ يونيو ٢٠٢٦"
  m = text.match(/(\d{1,2})\s+([؀-ۿa-zA-Z]+)\s+(\d{4})/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()] || MONTHS[m[2]];
    if (month) return `${m[3]}-${String(month).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  }
  m = text.match(/([؀-ۿa-zA-Z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()] || MONTHS[m[1]];
    if (month) return `${m[3]}-${String(month).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
  }
  return "";
}

function parseEmailText(rawText) {
  const text = normalizeDigits(rawText);
  const out = { customerName: "", serviceId: "", email: "", phone: "", dueDate: "", amount: 0, currency: state.settings.defaultCurrency, notes: "" };

  const emailM = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (emailM) out.email = emailM[0];

  const phoneM = text.match(/(?:\+?\d[\d\s\-]{7,}\d)/);
  if (phoneM) out.phone = phoneM[0].replace(/\s|-/g, "");

  const kitM = text.match(/(?:KIT[-\s]?STAR[-\s]?\d+|KIT[-\s]?\d{3,}|Kit\s*ID[:\s]*([A-Z0-9-]+))/i);
  if (kitM) out.serviceId = (kitM[1] || kitM[0]).replace(/\s+/g, "");

  const accountM = text.match(/(?:Account|الحساب|رقم\s*الحساب|رقم\s*الخدمة|Service)[\s:#]*([A-Z0-9-]{4,})/i);
  if (accountM && !out.serviceId) out.serviceId = accountM[1];

  // Amount: prefer currency-tagged numbers
  const amountM = text.match(/(\d+(?:[.,]\d+)?)\s*(USD|\$|EUR|€|LYD|د\.ل|دينار)/i);
  if (amountM) {
    out.amount = parseFloat(amountM[1].replace(",", "."));
    const c = amountM[2].toUpperCase();
    out.currency = c.includes("USD") || c.includes("$") ? "USD"
                 : c.includes("EUR") || c.includes("€") ? "EUR" : "LYD";
  } else {
    const numM = text.match(/(?:amount|total|due|المبلغ|المستحق|الإجمالي)[^\d]{0,20}(\d+(?:[.,]\d+)?)/i);
    if (numM) out.amount = parseFloat(numM[1].replace(",", "."));
  }

  // Due date — look near keywords first
  const dueWindow = text.match(/(?:due|payable|by|الاستحقاق|تاريخ\s*الاستحقاق|يستحق|قبل)[\s:]*([^\n]{1,40})/i);
  if (dueWindow) out.dueDate = parseFlexibleDate(dueWindow[1]);
  if (!out.dueDate) out.dueDate = parseFlexibleDate(text);

  // Customer name — look after "Dear" / "عزيزي" / "السيد"
  const nameM = text.match(/(?:Dear|Hello|Hi|عزيزي|السيد|السيدة|الزبون)\s+([^\n,،]{2,40})/i);
  if (nameM) out.customerName = nameM[1].trim();

  return out;
}

/* ===== Filtering / sorting ===== */

function visible() {
  const q = state.search.trim().toLowerCase();
  return state.subscriptions
    .filter((sub) => {
      const status = classify(sub).key;
      const ok = state.status === "all"
        || state.status === status
        || (state.status === "unpaid" && ["overdue", "due-soon", "unpaid"].includes(status));
      if (!ok) return false;
      if (!q) return true;
      return [sub.customerName, sub.serviceId, sub.email, sub.phone, sub.city, sub.notes]
        .join(" ").toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (state.sort === "customerName") return a.customerName.localeCompare(b.customerName, "ar");
      if (state.sort === "amount") return Number(b.amount || 0) - Number(a.amount || 0);
      if (state.sort === "updatedAt") return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
      return dateDiffDays(a.dueDate) - dateDiffDays(b.dueDate);
    });
}

function sumAmount(list) { return list.reduce((s, x) => s + Number(x.amount || 0), 0); }

/* ===== Rendering ===== */

function renderStats() {
  const active = state.subscriptions.filter((s) => s.subscriptionStatus !== "inactive");
  const overdue = active.filter((s) => classify(s).key === "overdue");
  const dueSoon = active.filter((s) => classify(s).key === "due-soon");
  const month = new Date().toISOString().slice(0, 7);
  const paidThisMonth = active.filter((s) => s.paymentStatus === "paid" && (s.lastPaidAt || "").startsWith(month));
  const expectedThisMonth = active.filter((s) => (s.dueDate || "").startsWith(month));

  el.overdueCount.textContent = overdue.length;
  el.overdueAmount.textContent = formatMoney(sumAmount(overdue));
  el.dueSoonCount.textContent = dueSoon.length;
  el.dueSoonAmount.textContent = formatMoney(sumAmount(dueSoon));
  el.paidCount.textContent = paidThisMonth.length;
  el.paidAmount.textContent = formatMoney(sumAmount(paidThisMonth));
  el.expectedCount.textContent = expectedThisMonth.length;
  el.expectedAmount.textContent = formatMoney(sumAmount(expectedThisMonth));
  el.totalCount.textContent = state.subscriptions.length;
  el.activeCount.textContent = `${active.length} نشط`;
}

function dueText(dateValue) {
  const days = dateDiffDays(dateValue);
  if (days < 0) return `فات منذ ${Math.abs(days)} يوم`;
  if (days === 0) return "اليوم";
  return `بعد ${days} يوم`;
}

function actionButtons(sub) {
  const hasPhone = !!sub.phone;
  return `
    <div class="row-actions">
      <button type="button" data-action="pay" data-id="${sub.id}" title="تسجيل الدفع">دفع</button>
      <button type="button" data-action="edit" data-id="${sub.id}" title="تعديل">تعديل</button>
      ${hasPhone ? `<button type="button" data-action="whatsapp" data-id="${sub.id}" title="إرسال تذكير واتساب">واتساب</button>` : ""}
      ${hasPhone ? `<button type="button" data-action="sms" data-id="${sub.id}" title="رسالة SMS">SMS</button>` : ""}
      ${hasPhone ? `<button type="button" data-action="call" data-id="${sub.id}" title="اتصال">📞</button>` : ""}
      <button type="button" data-action="delete" data-id="${sub.id}" title="حذف">حذف</button>
    </div>
  `;
}

function renderTable() {
  const rows = visible();
  el.resultCount.textContent = `${rows.length} نتيجة`;
  const tableActive = state.view === "table";
  el.tableView.hidden = !tableActive;
  el.cardsView.hidden = tableActive;

  if (!rows.length) {
    el.body.innerHTML = '<tr><td colspan="7" class="empty-cell">لا توجد اشتراكات مطابقة.</td></tr>';
    el.cards.innerHTML = '<p class="empty-state">لا توجد اشتراكات مطابقة.</p>';
    return;
  }

  el.body.innerHTML = rows.map((sub) => {
    const status = classify(sub);
    return `
      <tr>
        <td>
          <strong>${escapeHtml(sub.customerName)}</strong>
          <span>${escapeHtml(sub.phone || sub.email || sub.city || "بدون وسيلة اتصال")}</span>
        </td>
        <td>${escapeHtml(sub.serviceId)}</td>
        <td>
          <strong>${escapeHtml(sub.dueDate)}</strong>
          <span>${status.key === "paid" ? "مدفوع" : dueText(sub.dueDate)}</span>
        </td>
        <td>${formatMoney(sub.amount, sub.currency)}</td>
        <td><span class="badge ${status.className}">${escapeHtml(status.label)}</span></td>
        <td>${escapeHtml(sub.lastPaidAt || "-")}</td>
        <td>${actionButtons(sub)}</td>
      </tr>
    `;
  }).join("");

  el.cards.innerHTML = rows.map((sub) => {
    const status = classify(sub);
    return `
      <article class="sub-card">
        <header>
          <h3>${escapeHtml(sub.customerName)}</h3>
          <span class="badge ${status.className}">${escapeHtml(status.label)}</span>
        </header>
        <dl>
          <dt>الخدمة</dt><dd>${escapeHtml(sub.serviceId)}</dd>
          <dt>الاستحقاق</dt><dd>${escapeHtml(sub.dueDate)} (${escapeHtml(status.key === "paid" ? "مدفوع" : dueText(sub.dueDate))})</dd>
          <dt>المبلغ</dt><dd>${formatMoney(sub.amount, sub.currency)}</dd>
          ${sub.phone ? `<dt>الهاتف</dt><dd>${escapeHtml(sub.phone)}</dd>` : ""}
          ${sub.city ? `<dt>المنطقة</dt><dd>${escapeHtml(sub.city)}</dd>` : ""}
        </dl>
        ${actionButtons(sub)}
      </article>
    `;
  }).join("");
}

function renderActivities() {
  if (!state.activities.length) {
    el.activityList.innerHTML = '<p class="empty-state">لا توجد عمليات بعد.</p>';
    return;
  }
  el.activityList.innerHTML = state.activities.slice(0, 25).map((a) => {
    const date = new Date(a.createdAt).toLocaleString("ar-LY", { dateStyle: "short", timeStyle: "short" });
    return `<article class="activity-item"><span>${escapeHtml(date)}</span><strong>${escapeHtml(a.text)}</strong></article>`;
  }).join("");
}

function renderChart() {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: d.toISOString().slice(0, 7),
      label: d.toLocaleDateString("ar-LY", { month: "short" }),
      total: 0,
    });
  }
  state.subscriptions.forEach((sub) => {
    if (sub.paymentStatus !== "paid" || !sub.lastPaidAt) return;
    const k = sub.lastPaidAt.slice(0, 7);
    const m = months.find((x) => x.key === k);
    if (m) m.total += Number(sub.amount || 0);
  });
  const max = Math.max(1, ...months.map((m) => m.total));
  el.chart.innerHTML = months.map((m) => {
    const h = Math.round((m.total / max) * 130);
    return `
      <div class="bar-col">
        <div class="bar" style="height:${h}px">
          ${m.total > 0 ? `<span class="bar-value">${formatMoney(m.total)}</span>` : ""}
        </div>
        <span class="bar-label">${escapeHtml(m.label)}</span>
      </div>
    `;
  }).join("");
  el.chartTotal.textContent = formatMoney(months.reduce((s, m) => s + m.total, 0));
}

function render() {
  renderStats();
  renderTable();
  renderActivities();
  renderChart();
}

/* ===== Form ===== */

function openForm(sub = null) {
  el.formPanel.hidden = false;
  el.formTitle.textContent = sub ? "تعديل اشتراك" : "إضافة اشتراك";
  state.editingId = sub?.id || "";
  el.form.reset();
  el.form.elements.id.value = sub?.id || "";

  if (sub) {
    Object.entries(sub).forEach(([k, v]) => {
      if (el.form.elements[k]) el.form.elements[k].value = v ?? "";
    });
  } else {
    el.form.elements.currency.value = state.settings.defaultCurrency;
    el.form.elements.amount.value = state.settings.defaultAmount;
    el.form.elements.paymentStatus.value = "unpaid";
    el.form.elements.subscriptionStatus.value = "active";
    el.form.elements.cycle.value = "monthly";
  }
  el.formPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeForm() {
  state.editingId = "";
  el.form.reset();
  el.formPanel.hidden = true;
}

function formPayload() { return Object.fromEntries(new FormData(el.form).entries()); }

function saveForm(event) {
  event.preventDefault();
  try {
    const payload = formPayload();
    const id = state.editingId || payload.id;
    upsert(payload, id);
    closeForm();
    render();
    showToast(id ? "تم تحديث الاشتراك" : "تمت إضافة الاشتراك");
  } catch (e) {
    showToast(e.message);
  }
}

/* ===== Actions ===== */

function reminderText(sub) {
  return state.settings.reminderTemplate
    .replaceAll("{name}", sub.customerName)
    .replaceAll("{amount}", formatMoney(sub.amount, sub.currency))
    .replaceAll("{dueDate}", sub.dueDate)
    .replaceAll("{serviceId}", sub.serviceId);
}

function handleTableAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const id = button.dataset.id;
  const sub = state.subscriptions.find((s) => s.id === id);
  if (!sub) return;
  const action = button.dataset.action;

  if (action === "edit") return openForm(sub);

  if (action === "pay") {
    markPaid(id);
    render();
    showToast("تم تسجيل الدفع");
    return;
  }

  if (action === "delete") {
    if (window.confirm(`حذف اشتراك ${sub.customerName}؟`)) {
      deleteSub(id);
      render();
      showToast("تم الحذف");
    }
    return;
  }

  const bridge = nativeBridge();
  const msg = reminderText(sub);

  if (action === "whatsapp") {
    if (bridge) bridge.openWhatsApp(sub.phone, msg);
    else window.open(`https://wa.me/${sub.phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`, "_blank");
    return;
  }
  if (action === "sms") {
    if (bridge) bridge.openSms(sub.phone, msg);
    else window.location.href = `sms:${sub.phone}?body=${encodeURIComponent(msg)}`;
    return;
  }
  if (action === "call") {
    if (bridge) bridge.openDialer(sub.phone);
    else window.location.href = `tel:${sub.phone}`;
  }
}

/* ===== Email import ===== */

function handleParseEmail() {
  const text = el.emailText.value.trim();
  if (!text) {
    el.importPreview.hidden = false;
    el.importPreview.innerHTML = '<p class="empty-state">الصق نص الإيميل أولاً.</p>';
    return;
  }
  const parsed = parseEmailText(text);
  el.importPreview.hidden = false;
  el.importPreview.innerHTML = `
    <h3>تم استخراج البيانات التالية</h3>
    <dl>
      <dt>الزبون</dt><dd>${escapeHtml(parsed.customerName || "يحتاج إدخال")}</dd>
      <dt>رقم الخدمة</dt><dd>${escapeHtml(parsed.serviceId || "يحتاج إدخال")}</dd>
      <dt>الإيميل</dt><dd>${escapeHtml(parsed.email || "—")}</dd>
      <dt>الهاتف</dt><dd>${escapeHtml(parsed.phone || "—")}</dd>
      <dt>تاريخ الاستحقاق</dt><dd>${escapeHtml(parsed.dueDate || "يحتاج إدخال")}</dd>
      <dt>المبلغ</dt><dd>${parsed.amount ? formatMoney(parsed.amount, parsed.currency) : "يحتاج إدخال"}</dd>
    </dl>
    <button class="primary-button" type="button" id="useParsedEmailButton">مراجعة وحفظ</button>
  `;
  $("#useParsedEmailButton").addEventListener("click", () => openForm(parsed));
}

/* ===== Export / Backup / Restore ===== */

function exportCsv() {
  const headers = ["customerName", "serviceId", "email", "phone", "city", "dueDate", "cycle", "amount", "currency", "paymentStatus", "subscriptionStatus", "lastPaidAt", "notes"];
  const csv = [
    headers.join(","),
    ...visible().map((item) =>
      headers.map((k) => `"${String(item[k] ?? "").replaceAll('"', '""')}"`).join(",")
    ),
  ].join("\n");
  download(`starlink-subscriptions-${todayIso()}.csv`, `﻿${csv}`, "text/csv;charset=utf-8");
}

function backup() {
  const payload = JSON.stringify({
    exportedAt: localIso(),
    settings: state.settings,
    subscriptions: state.subscriptions,
    activities: state.activities,
  }, null, 2);
  download(`starlink-backup-${todayIso()}.json`, payload, "application/json");
  showToast("تم إنشاء نسخة احتياطية");
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  URL.revokeObjectURL(url);
}

function restoreFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!confirm("سيتم استبدال البيانات الحالية. هل تريد المتابعة؟")) return;
      if (Array.isArray(parsed.subscriptions)) state.subscriptions = parsed.subscriptions;
      if (Array.isArray(parsed.activities)) state.activities = parsed.activities;
      if (parsed.settings && typeof parsed.settings === "object") {
        state.settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
        saveSettings();
        fillSettingsForm();
      }
      saveStore();
      render();
      showToast("تمت الاستعادة بنجاح");
    } catch (e) {
      showToast("ملف غير صالح");
    }
  };
  reader.readAsText(file);
}

/* ===== Settings ===== */

function fillSettingsForm() {
  Object.entries(state.settings).forEach(([k, v]) => {
    if (el.settingsForm.elements[k]) el.settingsForm.elements[k].value = v ?? "";
  });
}

function saveSettingsForm(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(el.settingsForm).entries());
  state.settings = {
    ...state.settings,
    businessName: String(data.businessName || "").trim() || DEFAULT_SETTINGS.businessName,
    defaultCurrency: ["LYD", "USD", "EUR"].includes(data.defaultCurrency) ? data.defaultCurrency : "LYD",
    defaultAmount: Number(data.defaultAmount || 0),
    countryCode: String(data.countryCode || "").replace(/\D/g, "") || "218",
    reminderTemplate: String(data.reminderTemplate || "").trim() || DEFAULT_SETTINGS.reminderTemplate,
  };
  saveSettings();
  render();
  showToast("تم حفظ الإعدادات");
}

/* ===== Theme ===== */

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(THEME_KEY, t);
  const btn = $("#themeToggleButton");
  if (btn) btn.textContent = t === "light" ? "☀️ الوضع" : "🌙 الوضع";
}

/* ===== Bootstrap ===== */

async function init() {
  state.settings = loadSettings();
  fillSettingsForm();
  applyTheme(localStorage.getItem(THEME_KEY) || "dark");

  let store = loadStore();
  if (!store || (!store.subscriptions.length && !store.activities.length)) {
    store = await loadSeedData();
  }
  state.subscriptions = store.subscriptions;
  state.activities = store.activities;
  render();

  $("#openAddFormButton").addEventListener("click", () => openForm());
  $("#closeFormButton").addEventListener("click", closeForm);
  $("#resetFormButton").addEventListener("click", () => el.form.reset());
  $("#exportCsvButton").addEventListener("click", exportCsv);
  $("#backupButton").addEventListener("click", backup);
  $("#restoreButton").addEventListener("click", () => $("#restoreInput").click());
  $("#restoreInput").addEventListener("change", (e) => { if (e.target.files[0]) restoreFromFile(e.target.files[0]); e.target.value = ""; });
  $("#parseEmailButton").addEventListener("click", handleParseEmail);
  $("#clearEmailButton").addEventListener("click", () => { el.emailText.value = ""; el.importPreview.hidden = true; });
  $("#clearActivityButton").addEventListener("click", () => {
    if (!confirm("مسح سجل العمليات؟")) return;
    state.activities = []; saveStore(); render();
  });
  $("#themeToggleButton").addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
  });

  el.form.addEventListener("submit", saveForm);
  el.settingsForm.addEventListener("submit", saveSettingsForm);
  $("#resetSettingsButton").addEventListener("click", () => {
    state.settings = { ...DEFAULT_SETTINGS };
    saveSettings(); fillSettingsForm(); showToast("تمت استعادة القيم الافتراضية");
  });

  el.body.addEventListener("click", handleTableAction);
  el.cards.addEventListener("click", handleTableAction);

  el.searchInput.addEventListener("input", (e) => { state.search = e.target.value; renderTable(); });
  el.statusFilter.addEventListener("change", (e) => { state.status = e.target.value; renderTable(); });
  el.sortSelect.addEventListener("change", (e) => { state.sort = e.target.value; renderTable(); });
  el.viewSelect.addEventListener("change", (e) => { state.view = e.target.value; renderTable(); });

  $$(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      $$(".nav-item").forEach((n) => n.classList.remove("active"));
      item.classList.add("active");
    });
  });
}

init().catch((e) => { console.error(e); showToast("خطأ في التحميل"); });
