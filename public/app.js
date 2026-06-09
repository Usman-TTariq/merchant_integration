const DEFAULT_TIMEZONE = "America/Los_Angeles";

const state = {
  tab: "overview",
  koronaPage: 1,
  koronaOrdersPage: 1,
  mappingsPage: 1,
  ordersPage: 1,
  receiptsPage: 1,
  koronaReceiptsPage: 1,
  logsPage: 1,
  reportsPage: 1,
  reportsSalesPage: 1,
  reportsDays: 1,
  reportsSearch: "",
  reportsSalesSearch: "",
  reportsFilter: "all",
  productSearch: "",
  logLevel: "",
  displayTimezone: DEFAULT_TIMEZONE,
};

function looksLikeIsoTimestamp(value) {
  return /^\d{4}-\d{2}-\d{2}T/.test(value) || /[+-]\d{2}:\d{2}$/.test(value) || value.endsWith("Z");
}

function formatTime(value) {
  if (value == null || value === "") return "";
  const raw = String(value).trim();
  if (!looksLikeIsoTimestamp(raw)) return raw;
  const normalized =
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) && !raw.includes("T")
      ? `${raw.replace(" ", "T")}Z`
      : raw;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return raw;
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: state.displayTimezone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
    return `${formatted} PT`;
  } catch {
    return raw;
  }
}

function fmtTime(value) {
  return esc(formatTime(value));
}

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json();
  if (res.status === 401 && data.authenticated === false) {
    window.location.href = "/login.html";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setBadge(id, ok, label, detail) {
  const el = document.getElementById(id);
  el.className = `badge ${ok ? "ok" : "err"}`;
  el.title = detail ?? "";
  el.textContent = `${label}: ${ok ? "OK" : "Fail"}`;
}

function renderStats(stats) {
  document.getElementById("stats").innerHTML = [
    ["Product mappings", stats.productMappings],
    ["Order mappings", stats.orderMappings],
    ["Processed receipts", stats.processedReceipts],
    ["Log errors", stats.logErrors],
    ["Log warnings", stats.logWarnings],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat-card"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`
    )
    .join("");
}

function renderConfig(status) {
  const cfg = status.config;
  document.getElementById("config-list").innerHTML = `
    <div><dt>Korona Account</dt><dd>${esc(cfg.accountId)}</dd></div>
    <div><dt>Korona detail</dt><dd>${esc(status.korona.detail ?? "")}</dd></div>
    <div><dt>Display timezone</dt><dd>Pacific Time (PT)</dd></div>
  `;
}

function table(headers, rows) {
  if (!rows.length) return `<div class="empty">No data yet</div>`;
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function pager(containerId, page, total, limit, onPage) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const el = document.getElementById(containerId);
  el.innerHTML = `
    <button type="button" ${page <= 1 ? "disabled" : ""} data-p="${page - 1}">Prev</button>
    <span>Page ${page} / ${pages} (${total} total)</span>
    <button type="button" ${page >= pages ? "disabled" : ""} data-p="${page + 1}">Next</button>
  `;
  el.querySelectorAll("button[data-p]").forEach((btn) => {
    btn.addEventListener("click", () => onPage(Number(btn.dataset.p)));
  });
}

async function loadOverview() {
  const errorEl = document.getElementById("load-error");
  const results = await Promise.allSettled([
    api("/api/status"),
    api("/api/stats"),
    api("/api/cursors"),
  ]);

  const errors = results
    .map((r, i) => {
      if (r.status === "rejected") {
        const label = ["/api/status", "/api/stats", "/api/cursors"][i];
        return `${label}: ${r.reason?.message ?? r.reason}`;
      }
      return null;
    })
    .filter(Boolean);

  if (errors.length) {
    errorEl.hidden = false;
    errorEl.textContent = `Dashboard data failed: ${errors.join(" | ")}. On Vercel, set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and redeploy.`;
  } else {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  const status = results[0].status === "fulfilled" ? results[0].value : null;
  const stats = results[1].status === "fulfilled" ? results[1].value : null;
  const cursors = results[2].status === "fulfilled" ? results[2].value : [];

  if (status) {
    if (status.config?.displayTimezone) {
      state.displayTimezone = status.config.displayTimezone;
    }
    setBadge("status-korona", status.korona.ok, "Korona", status.korona.detail);
    setBadge("status-shiphero", status.shiphero.ok, "ShipHero", status.shiphero.detail);
    renderConfig(status);
  }

  if (stats) renderStats(stats);

  document.getElementById("cursors").innerHTML = table(
    ["Key", "Value", "Updated"],
    cursors.map((c) => [esc(c.key), esc(c.value), fmtTime(c.updated_at)])
  );
}

async function loadKorona() {
  const data = await api(`/api/korona/products?page=${state.koronaPage}&size=25`);
  document.getElementById("korona-table").innerHTML = table(
    ["Number", "Name", "Barcode", "Price", "Revision", "ID"],
    data.products.map((p) => [
      esc(p.number),
      `<span class="${p.deleted ? "deleted" : ""}">${esc(p.name)}</span>`,
      esc(p.barcode),
      esc(p.price ?? ""),
      esc(p.revision ?? ""),
      `<code>${esc(p.id)}</code>`,
    ])
  );
  pager("korona-pager", data.page, data.total, 25, (p) => {
    state.koronaPage = p;
    loadKorona();
  });
}

async function loadMappings() {
  const q = state.productSearch ? `&search=${encodeURIComponent(state.productSearch)}` : "";
  const data = await api(`/api/products?page=${state.mappingsPage}&limit=50${q}`);
  document.getElementById("mappings-table").innerHTML = table(
    ["Korona #", "ShipHero SKU", "Revision", "Updated", "Korona ID"],
    data.rows.map((r) => [
      esc(r.korona_product_number),
      `<strong>${esc(r.shiphero_sku)}</strong>`,
      esc(r.korona_revision ?? ""),
      fmtTime(r.updated_at),
      `<code>${esc(r.korona_product_id)}</code>`,
    ])
  );
  pager("mappings-pager", data.page, data.total, data.limit, (p) => {
    state.mappingsPage = p;
    loadMappings();
  });
}

async function loadOrders() {
  const data = await api(`/api/orders?page=${state.ordersPage}&limit=50`);
  const hintEl = document.getElementById("orders-hint");
  hintEl.textContent = data.hint ?? "";
  hintEl.hidden = !data.hint;

  document.getElementById("orders-table").innerHTML = table(
    ["Korona Order", "Type", "ShipHero #", "ShipHero ID", "Created"],
    data.rows.map((r) => [
      esc(r.korona_order_id),
      esc(r.korona_order_type),
      esc(r.shiphero_order_number),
      esc(r.shiphero_order_id),
      fmtTime(r.created_at),
    ])
  );
  pager("orders-pager", data.page, data.total, data.limit, (p) => {
    state.ordersPage = p;
    loadOrders();
  });

  const live = await api(`/api/korona/orders?page=${state.koronaOrdersPage}`);
  document.getElementById("korona-orders-table").innerHTML = table(
    ["Number", "ID", "Lines", "Revision", "Created", "Deleted"],
    live.orders.map((o) => [
      esc(o.number),
      `<code>${esc(o.id)}</code>`,
      esc(o.lineCount),
      esc(o.revision ?? ""),
      fmtTime(o.creationTime),
      o.deleted ? "yes" : "no",
    ])
  );
  pager("korona-orders-pager", live.page, live.total, 100, (p) => {
    state.koronaOrdersPage = p;
    loadOrders();
  });
}

async function loadReceipts() {
  const data = await api(`/api/receipts?page=${state.receiptsPage}&limit=50`);
  const hintEl = document.getElementById("receipts-hint");
  hintEl.textContent = data.hint ?? "";
  hintEl.hidden = !data.hint;

  document.getElementById("receipts-table").innerHTML = table(
    ["Receipt ID", "Processed at", ""],
    data.rows.map((r) => [
      `<code>${esc(r.receipt_id)}</code>`,
      fmtTime(r.processed_at),
      receiptDownloadLink(r.receipt_id),
    ])
  );
  pager("receipts-pager", data.page, data.total, data.limit, (p) => {
    state.receiptsPage = p;
    loadReceipts();
  });

  const live = await api(`/api/korona/receipts?page=${state.koronaReceiptsPage}`);
  document.getElementById("korona-receipts-table").innerHTML = table(
    ["Number", "ID", "Sale lines", "Revision", "Created", "Modified", ""],
    live.receipts.map((r) => [
      esc(r.number),
      `<code>${esc(r.id)}</code>`,
      esc(r.lineCount),
      esc(r.revision ?? ""),
      fmtTime(r.creationTime),
      fmtTime(r.modificationTime),
      receiptDownloadLink(r.id),
    ])
  );
  pager("korona-receipts-pager", live.page, live.total, 100, (p) => {
    state.koronaReceiptsPage = p;
    loadReceipts();
  });
}

function statusBadge(status, label) {
  return `<span class="report-status report-status-${esc(status)}">${esc(label)}</span>`;
}

function qtyCell(value) {
  if (value == null) return '<span class="muted">—</span>';
  return esc(value);
}

function receiptDownloadLink(receiptId, label = "Download") {
  const href = `/api/korona/receipts/${encodeURIComponent(receiptId)}/download`;
  return `<a class="btn secondary btn-sm" href="${href}" download>${esc(label)}</a>`;
}

function renderReportsSummary(summary) {
  const s = summary.sync;
  const scan = summary.stockScan;

  document.getElementById("reports-summary").innerHTML = `
    <div class="reports-grid">
      <div class="card">
        <h3>Connections</h3>
        <dl class="kv">
          <div><dt>Korona</dt><dd>${summary.connections.korona ? '<span class="report-status report-status-synced">OK</span>' : '<span class="report-status report-status-mismatch">Fail</span>'}</dd></div>
          <div><dt>ShipHero</dt><dd>${summary.connections.shiphero ? '<span class="report-status report-status-synced">OK</span>' : '<span class="report-status report-status-mismatch">Fail</span>'}</dd></div>
        </dl>
      </div>
      <div class="card">
        <h3>Sync coverage</h3>
        <dl class="kv">
          <div><dt>Product mappings</dt><dd>${esc(s.productMappings)}</dd></div>
          <div><dt>Order mappings</dt><dd>${esc(s.orderMappings)}</dd></div>
          <div><dt>Korona POS receipts</dt><dd>${esc(s.orderReceipts)}</dd></div>
          <div><dt>Korona Studio orders</dt><dd>${esc(s.orderStudio)}</dd></div>
          <div><dt>Processed receipts</dt><dd>${esc(s.processedReceipts)}</dd></div>
          <div><dt>Korona → SH stock</dt><dd>${s.syncKoronaStock ? "On" : "Off"}</dd></div>
        </dl>
      </div>
      <div class="card">
        <h3>Stock sample (first ${esc(scan.sampled)} SKUs)</h3>
        <dl class="kv">
          <div><dt>In sync</dt><dd>${esc(scan.synced)}</dd></div>
          <div><dt>Mismatch</dt><dd>${esc(scan.mismatch)}</dd></div>
          <div><dt>Not tracked</dt><dd>${esc(scan.untracked)}</dd></div>
          <div><dt>No Korona rows</dt><dd>${esc(scan.noRows)}</dd></div>
          <div><dt>Missing ShipHero</dt><dd>${esc(scan.missingShiphero)}</dd></div>
        </dl>
      </div>
      <div class="card">
        <h3>Logs</h3>
        <dl class="kv">
          <div><dt>Errors</dt><dd>${esc(summary.logs.errors)}</dd></div>
          <div><dt>Warnings</dt><dd>${esc(summary.logs.warnings)}</dd></div>
          <div><dt>Stock “not tracked”</dt><dd>${esc(summary.logs.stockUntrackedHints)} <span class="muted">(recent warns)</span></dd></div>
          <div><dt>Stock cron page</dt><dd>${esc(s.stockBatchCursor ?? "1")}</dd></div>
        </dl>
      </div>
    </div>
  `;
}

async function loadReports() {
  const loading = document.getElementById("reports-loading");
  loading.hidden = false;

  try {
    const summary = await api("/api/reports/summary");
    renderReportsSummary(summary);

    const salesQ = new URLSearchParams({
      page: String(state.reportsSalesPage),
      limit: "50",
      days: String(state.reportsDays),
    });
    if (state.reportsSalesSearch) salesQ.set("search", state.reportsSalesSearch);
    const sales = await api(`/api/reports/sales?${salesQ}`);
    document.getElementById("reports-sales-period").textContent = `— ${sales.periodLabel}`;
    document.getElementById("reports-sales-table").innerHTML = table(
      ["Product", "SKU", "Sold", "Source", "Korona left", "ShipHero left", "Status"],
      sales.rows.map((r) => [
        esc(r.productName),
        `<strong>${esc(r.sku)}</strong>`,
        esc(r.soldQty),
        esc(r.sources.map((s) => (s === "korona_pos" ? "POS" : "Studio")).join(", ")),
        qtyCell(r.koronaQty),
        qtyCell(r.shipheroQty),
        statusBadge(r.status, r.statusLabel),
      ])
    );
    pager("reports-sales-pager", sales.page, sales.total, sales.limit, (p) => {
      state.reportsSalesPage = p;
      loadReports();
    });

    const q = new URLSearchParams({
      page: String(state.reportsPage),
      limit: "25",
      filter: state.reportsFilter,
      days: String(state.reportsDays),
    });
    if (state.reportsSearch) q.set("search", state.reportsSearch);

    const stock = await api(`/api/reports/stock?${q}`);
    document.getElementById("reports-stock-table").innerHTML = table(
      ["Product", "SKU", "Sold", "Korona on-hand", "ShipHero on-hand", "Diff", "Status"],
      stock.rows.map((r) => [
        esc(r.productName),
        `<strong>${esc(r.sku)}</strong>`,
        r.soldQty > 0 ? esc(r.soldQty) : '<span class="muted">0</span>',
        qtyCell(r.koronaQty) + (r.koronaSource ? `<span class="muted"> ${esc(r.koronaSource)}</span>` : ""),
        qtyCell(r.shipheroQty),
        r.diff == null ? '<span class="muted">—</span>' : `<span class="${r.diff === 0 ? "" : "diff-warn"}">${r.diff > 0 ? "+" : ""}${esc(r.diff)}</span>`,
        statusBadge(r.status, r.statusLabel),
      ])
    );
    pager("reports-pager", stock.page, stock.total, stock.limit, (p) => {
      state.reportsPage = p;
      loadReports();
    });
  } finally {
    loading.hidden = true;
  }
}

async function loadLogs() {
  const level = state.logLevel ? `&level=${state.logLevel}` : "";
  const [data, summary] = await Promise.all([
    api(`/api/logs?page=${state.logsPage}&limit=100${level}`),
    api("/api/logs/summary"),
  ]);

  const warnTotal = summary.warnCategories.reduce((n, r) => n + r.c, 0);
  const errTotal = summary.errorSamples.reduce((n, r) => n + r.c, 0);

  document.getElementById("logs-summary").innerHTML = `
    <div class="card">
      <h3>Warnings by type (${esc(warnTotal)} total)</h3>
      <dl class="kv">
        ${summary.warnCategories
          .map(
            (r) =>
              `<div><dt>${esc(r.category)}</dt><dd>${esc(r.c)}</dd></div>`
          )
          .join("")}
      </dl>
    </div>
    <div class="card">
      <h3>Top errors (${esc(errTotal)} unique messages)</h3>
      <dl class="kv log-error-list">
        ${summary.errorSamples
          .map(
            (r) =>
              `<div><dt title="${esc(r.message)}">${esc(r.message.length > 70 ? r.message.slice(0, 70) + "…" : r.message)}</dt><dd>${esc(r.c)}×</dd></div>`
          )
          .join("") || "<div><dt>—</dt><dd>0</dd></div>"}
      </dl>
    </div>
    <div class="card">
      <h3>By job</h3>
      <dl class="kv">
        ${summary.byJobLevel
          .map(
            (r) =>
              `<div><dt>${esc(r.job)} / ${esc(r.level)}</dt><dd>${esc(r.c)}</dd></div>`
          )
          .join("")}
      </dl>
    </div>
  `;

  document.getElementById("logs-table").innerHTML = table(
    ["Time", "Job", "Level", "Message"],
    data.rows.map((r) => [
      fmtTime(r.created_at),
      esc(r.job),
      `<span class="level-${esc(r.level)}">${esc(r.level)}</span>`,
      esc(r.message),
    ])
  );
  pager("logs-pager", data.page, data.total, data.limit, (p) => {
    state.logsPage = p;
    loadLogs();
  });
}

async function loadActiveTab() {
  try {
    if (state.tab === "overview") await loadOverview();
    if (state.tab === "korona") await loadKorona();
    if (state.tab === "mappings") await loadMappings();
    if (state.tab === "orders") await loadOrders();
    if (state.tab === "receipts") await loadReceipts();
    if (state.tab === "reports") await loadReports();
    if (state.tab === "logs") await loadLogs();
  } catch (err) {
    console.error(err);
  }
}

async function refreshAll() {
  try {
    await loadOverview();
    if (state.tab !== "overview") await loadActiveTab();
  } catch (err) {
    console.error(err);
    const errorEl = document.getElementById("load-error");
    errorEl.hidden = false;
    errorEl.textContent = err instanceof Error ? err.message : String(err);
  }
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.tab = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === btn));
    document.querySelectorAll(".tab-panel").forEach((p) => {
      p.classList.toggle("active", p.id === `tab-${state.tab}`);
    });
    loadActiveTab();
  });
});

document.getElementById("btn-refresh").addEventListener("click", refreshAll);

document.getElementById("btn-logout").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login.html";
});

document.querySelectorAll("[data-sync]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const job = btn.dataset.sync;
    const msg = document.getElementById("sync-msg");
    msg.textContent = `Starting ${job} sync…`;
    try {
      await api(`/api/sync/${job}`, { method: "POST" });
      msg.textContent = `${job} sync started — check Logs tab`;
      setTimeout(refreshAll, 2000);
    } catch (err) {
      msg.textContent = err.message;
    }
  });
});

document.getElementById("product-search").addEventListener("input", (e) => {
  state.productSearch = e.target.value;
  state.mappingsPage = 1;
  clearTimeout(window._searchTimer);
  window._searchTimer = setTimeout(loadMappings, 300);
});

document.getElementById("log-level").addEventListener("change", (e) => {
  state.logLevel = e.target.value;
  state.logsPage = 1;
  const exportLogs = document.getElementById("btn-export-logs");
  const level = e.target.value;
  exportLogs.href = level ? `/api/export/logs.csv?level=${encodeURIComponent(level)}` : "/api/export/logs.csv";
  loadLogs();
});

document.getElementById("btn-reports-refresh").addEventListener("click", () => {
  state.reportsPage = 1;
  loadReports();
});

document.getElementById("reports-search").addEventListener("input", (e) => {
  state.reportsSearch = e.target.value;
  state.reportsPage = 1;
  clearTimeout(window._reportsSearchTimer);
  window._reportsSearchTimer = setTimeout(loadReports, 400);
});

document.getElementById("reports-filter").addEventListener("change", (e) => {
  state.reportsFilter = e.target.value;
  state.reportsPage = 1;
  loadReports();
});

document.getElementById("reports-days").addEventListener("change", (e) => {
  state.reportsDays = Number(e.target.value);
  state.reportsPage = 1;
  state.reportsSalesPage = 1;
  loadReports();
});

document.getElementById("reports-sales-search").addEventListener("input", (e) => {
  state.reportsSalesSearch = e.target.value;
  state.reportsSalesPage = 1;
  clearTimeout(window._reportsSalesSearchTimer);
  window._reportsSalesSearchTimer = setTimeout(loadReports, 400);
});

document.getElementById("btn-clear-errors").addEventListener("click", async () => {
  try {
    const res = await api("/api/logs/clear-errors", { method: "POST" });
    document.getElementById("sync-msg").textContent = `Cleared ${res.deleted} error log(s)`;
    await refreshAll();
  } catch (err) {
    document.getElementById("sync-msg").textContent = err.message;
  }
});

document.getElementById("btn-clear-warnings").addEventListener("click", async () => {
  try {
    const res = await api("/api/logs/clear-warnings", { method: "POST" });
    document.getElementById("sync-msg").textContent = `Cleared ${res.deleted} warning log(s)`;
    await refreshAll();
  } catch (err) {
    document.getElementById("sync-msg").textContent = err.message;
  }
});

refreshAll();
setInterval(refreshAll, 15000);
