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
  koronaSearch: "",
  ordersSearch: "",
  koronaOrdersSearch: "",
  receiptsSearch: "",
  koronaReceiptsSearch: "",
  logsSearch: "",
  logLevel: "",
  displayTimezone: DEFAULT_TIMEZONE,
  // ShipHero tab
  shOrdersAfter: null,
  shOrdersHistory: [],
  shOrdersSearch: "",
  shOrdersStatus: "",
  shProductsAfter: null,
  shProductsHistory: [],
  shProductsSearch: "",
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
    <span class="pager-goto">
      <input type="number" min="1" max="${pages}" value="${page}" class="pager-input" title="Go to page" />
      <button type="button" class="pager-go-btn">Go</button>
    </span>
  `;
  el.querySelectorAll("button[data-p]").forEach((btn) => {
    btn.addEventListener("click", () => onPage(Number(btn.dataset.p)));
  });
  const input = el.querySelector(".pager-input");
  const goBtn = el.querySelector(".pager-go-btn");
  const goToPage = () => {
    const p = Math.min(pages, Math.max(1, Number(input.value)));
    if (p !== page) onPage(p);
  };
  goBtn.addEventListener("click", goToPage);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") goToPage(); });
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

function searchQuery(term) {
  const q = term?.trim();
  return q ? `&search=${encodeURIComponent(q)}` : "";
}

function showTableError(containerId, err, prefix = "Error") {
  const msg = err instanceof Error ? err.message : String(err);
  document.getElementById(containerId).innerHTML =
    `<div class="empty">${esc(prefix)}: ${esc(msg)}</div>`;
}

function bindSearchInput(inputId, { getValue, setValue, resetPages, load, delay = 300 }) {
  const el = document.getElementById(inputId);
  const runLoad = () => {
    clearTimeout(window[`_${inputId}Timer`]);
    window[`_${inputId}Timer`] = setTimeout(load, delay);
  };
  el.addEventListener("input", (e) => {
    setValue(e.target.value);
    resetPages();
    runLoad();
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      setValue(e.target.value);
      resetPages();
      clearTimeout(window[`_${inputId}Timer`]);
      load();
    }
  });
  if (el && getValue()) el.value = getValue();
}

async function loadKorona() {
  try {
    const data = await api(
      `/api/korona/products?page=${state.koronaPage}&size=25${searchQuery(state.koronaSearch)}`
    );
    const rows = data.products.map((p) => [
      esc(p.number),
      `<span class="${p.deleted ? "deleted" : ""}">${esc(p.name)}</span>`,
      esc(p.barcode),
      esc(p.price ?? ""),
      esc(p.revision ?? ""),
      `<code>${esc(p.id)}</code>`,
    ]);
    const emptyMsg = state.koronaSearch.trim()
      ? `No products found for "${esc(state.koronaSearch.trim())}". Try exact SKU/number, full product ID, or barcode.`
      : "No data yet";
    document.getElementById("korona-table").innerHTML = rows.length
      ? table(["Number", "Name", "Barcode", "Price", "Revision", "ID"], rows)
      : `<div class="empty">${emptyMsg}</div>`;
    pager("korona-pager", data.page, data.total, 25, (p) => {
      state.koronaPage = p;
      loadKorona();
    });
  } catch (err) {
    showTableError("korona-table", err, "Korona search failed");
  }
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
  const ordersTable = document.getElementById("orders-table");
  const koronaOrdersTable = document.getElementById("korona-orders-table");
  ordersTable.innerHTML = '<div class="empty muted">Loading order mappings…</div>';
  koronaOrdersTable.innerHTML = '<div class="empty muted">Loading Korona receipts…</div>';

  const data = await api(`/api/orders?page=${state.ordersPage}&limit=50${searchQuery(state.ordersSearch)}`);
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

  const live = await api(
    `/api/korona/receipts?page=${state.koronaOrdersPage}${searchQuery(state.koronaOrdersSearch)}`
  );
  const receiptRows = (live.receipts ?? []).map((r) => [
    esc(r.number),
    `<code>${esc(r.id)}</code>`,
    esc(r.lineCount),
    esc(r.revision ?? ""),
    fmtTime(r.creationTime),
    fmtTime(r.modificationTime),
  ]);
  const receiptSearch = state.koronaOrdersSearch.trim();
  const receiptEmpty = live.productMatch
    ? `Product "${esc(live.productMatch.name)}" (${esc(live.productMatch.number)}) is in Korona but has not been sold on any receipt yet.`
    : receiptSearch
      ? `No receipts found for "${esc(receiptSearch)}". Try receipt #, full receipt/product ID, or product SKU.`
      : "No POS receipts in Korona yet.";
  document.getElementById("korona-orders-table").innerHTML = receiptRows.length
    ? table(["Number", "ID", "Sale lines", "Revision", "Created", "Modified"], receiptRows)
    : `<div class="empty">${receiptEmpty}</div>`;
  pager("korona-orders-pager", live.page ?? 1, live.total ?? 0, 100, (p) => {
    state.koronaOrdersPage = p;
    loadOrders();
  });
}

async function loadReceipts() {
  document.getElementById("korona-receipts-table").innerHTML =
    '<div class="empty muted">Loading Korona receipts…</div>';

  const [processedResult, liveResult] = await Promise.allSettled([
    api(`/api/receipts?page=${state.receiptsPage}&limit=50${searchQuery(state.receiptsSearch)}`),
    api(
      `/api/korona/receipts?page=${state.koronaReceiptsPage}${searchQuery(state.koronaReceiptsSearch)}`
    ),
  ]);

  if (processedResult.status === "fulfilled") {
    try {
      const data = processedResult.value;
      const hintEl = document.getElementById("receipts-hint");
      hintEl.textContent = data.hint ?? "";
      hintEl.hidden = !data.hint;

      const processedRows = (data.rows ?? []).map((r) => [
        `<code>${esc(r.receipt_id)}</code>`,
        fmtTime(r.processed_at),
        receiptDownloadLink(r.receipt_id),
      ]);
      const processedSearch = state.receiptsSearch.trim();
      const processedEmpty = processedSearch
        ? `No processed receipts match "${esc(processedSearch)}". This search is for synced receipt IDs only — use Korona Receipts (live) below for product SKU/ID.`
        : "No data yet";
      document.getElementById("receipts-table").innerHTML = processedRows.length
        ? table(["Receipt ID", "Processed at", ""], processedRows)
        : `<div class="empty">${processedEmpty}</div>`;
      pager("receipts-pager", data.page, data.total ?? 0, data.limit ?? 50, (p) => {
        state.receiptsPage = p;
        loadReceipts();
      });
    } catch (err) {
      showTableError("receipts-table", err, "Processed receipt search failed");
    }
  } else {
    showTableError("receipts-table", processedResult.reason, "Processed receipt search failed");
  }

  if (liveResult.status === "fulfilled") {
    try {
      const live = liveResult.value;
      const receiptRows = (live.receipts ?? []).map((r) => [
        esc(r.number),
        `<code>${esc(r.id)}</code>`,
        esc(r.lineCount),
        esc(r.revision ?? ""),
        fmtTime(r.creationTime),
        fmtTime(r.modificationTime),
        receiptDownloadLink(r.id),
      ]);
      const receiptEmpty = live.productMatch
        ? `Product "${esc(live.productMatch.name)}" (${esc(live.productMatch.number)}) is in Korona but has not been sold on any receipt yet.`
        : state.koronaReceiptsSearch.trim()
          ? `No receipts found for "${esc(state.koronaReceiptsSearch.trim())}". Try receipt #, full receipt/product ID, or product SKU (e.g. 1432021).`
          : "No data yet";
      document.getElementById("korona-receipts-table").innerHTML = receiptRows.length
        ? table(["Number", "ID", "Sale lines", "Revision", "Created", "Modified", ""], receiptRows)
        : `<div class="empty">${receiptEmpty}</div>`;
      pager("korona-receipts-pager", live.page ?? 1, live.total ?? 0, 100, (p) => {
        state.koronaReceiptsPage = p;
        loadReceipts();
      });
    } catch (err) {
      showTableError("korona-receipts-table", err, "Receipt search failed");
    }
  } else {
    showTableError("korona-receipts-table", liveResult.reason, "Receipt search failed");
  }
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
    const salesQ = new URLSearchParams({
      page: String(state.reportsSalesPage),
      limit: "50",
      days: String(state.reportsDays),
    });
    if (state.reportsSalesSearch) salesQ.set("search", state.reportsSalesSearch);

    const stockQ = new URLSearchParams({
      page: String(state.reportsPage),
      limit: "25",
      filter: state.reportsFilter,
      days: String(state.reportsDays),
    });
    if (state.reportsSearch) stockQ.set("search", state.reportsSearch);

    const [summary, sales, stock] = await Promise.all([
      api("/api/reports/summary"),
      api(`/api/reports/sales?${salesQ}`),
      api(`/api/reports/stock?${stockQ}`),
    ]);

    renderReportsSummary(summary);

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

    // If still no results, try ShipHero SKU lookup as last resort
    if (stock.rows.length === 0 && state.reportsSearch.trim()) {
      const sku = state.reportsSearch.trim();
      document.getElementById("reports-stock-table").innerHTML =
        `<div class="empty">Not in sync database — checking ShipHero directly…</div>`;
      try {
        const sh = await api(`/api/shiphero/sku?sku=${encodeURIComponent(sku)}`);
        if (sh.found) {
          document.getElementById("reports-stock-table").innerHTML = table(
            ["Product", "SKU", "Korona on-hand", "ShipHero on-hand", "Status"],
            [[
              esc(sh.name ?? "—"),
              `<strong>${esc(sh.sku)}</strong>`,
              '<span class="muted">Not mapped</span>',
              qtyCell(sh.onHand),
              `<span class="badge badge-warn">Not in Korona sync</span>`,
            ]]
          );
        } else {
          document.getElementById("reports-stock-table").innerHTML =
            `<div class="empty">No match in sync database, Korona live, or ShipHero for <strong>${esc(sku)}</strong>.</div>`;
        }
      } catch {
        document.getElementById("reports-stock-table").innerHTML =
          `<div class="empty">No match found for <strong>${esc(sku)}</strong>.</div>`;
      }
      pager("reports-pager", 1, 0, 25, () => {});
    } else {
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
    }
  } catch (err) {
    showTableError("reports-stock-table", err, "Report load failed");
  } finally {
    loading.hidden = true;
  }
}

async function loadLogs() {
  const level = state.logLevel ? `&level=${encodeURIComponent(state.logLevel)}` : "";
  const [data, summary] = await Promise.all([
    api(`/api/logs?page=${state.logsPage}&limit=100${level}${searchQuery(state.logsSearch)}`),
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

// ─── ShipHero Tab ────────────────────────────────────────────────────────────

function shStatusBadge(status) {
  if (!status) return '<span class="muted">—</span>';
  const cls = status === "fulfilled" || status === "shipped" || status === "closed"
    ? "report-status-synced"
    : status === "pending"
    ? "report-status-pending"
    : "report-status-error";
  return `<span class="report-status ${cls}">${esc(status)}</span>`;
}

function canPrintShipheroLabel(status) {
  const s = (status ?? "").toLowerCase();
  if (!s) return true;
  return !["fulfilled", "closed", "cancelled", "canceled"].includes(s);
}

function printLabelAction(orderId, fulfillmentStatus) {
  if (!canPrintShipheroLabel(fulfillmentStatus)) {
    return '<span class="muted">—</span>';
  }
  return `<button type="button" class="btn secondary btn-sm sh-print-label" data-order-id="${esc(orderId)}">Print Label</button>`;
}

async function printShipheroLabel(orderId, btn) {
  const msg = document.getElementById("sync-msg");
  const prevText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Printing…";
  msg.textContent = `Printing label for order…`;
  try {
    const data = await api(`/api/shiphero/orders/${encodeURIComponent(orderId)}/print-label`, {
      method: "POST",
    });
    const labels = data.labels ?? [];
    const tracking = labels.map((l) => l.tracking_number).filter(Boolean).join(", ");
    const pdfUrl =
      labels[0]?.pdf_location ||
      labels[0]?.thermal_pdf_location ||
      labels[0]?.paper_pdf_location ||
      labels[0]?.image_location;
    msg.textContent = tracking
      ? `Label printed — tracking: ${tracking}`
      : "Label printed successfully";
    if (pdfUrl) window.open(pdfUrl, "_blank", "noopener,noreferrer");
    setTimeout(refreshAll, 1500);
  } catch (err) {
    msg.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = prevText;
  }
}

async function loadShipheroOrders() {
  const hint = document.getElementById("sh-orders-hint");
  hint.textContent = "Loading orders…";
  try {
    const params = new URLSearchParams({ limit: "25" });
    if (state.shOrdersAfter) params.set("after", state.shOrdersAfter);
    if (state.shOrdersSearch) params.set("search", state.shOrdersSearch);
    if (state.shOrdersStatus) params.set("status", state.shOrdersStatus);

    const data = await api(`/api/shiphero/orders?${params}`);
    const orders = data.orders ?? [];
    hint.textContent = orders.length ? "" : "No orders found for this filter.";

    document.getElementById("sh-orders-table").innerHTML = table(
      ["Order #", "Status", "Updated", "Ship To", "SKUs", "Actions"],
      orders.map((o) => {
        const edges = o.line_items?.edges ?? [];
        const skuList = edges.map((e) => `<code>${esc(e.node.sku)}</code> ×${esc(e.node.quantity)}`).join(" &nbsp;");
        const addr = o.shipping_address
          ? [o.shipping_address.full_name, o.shipping_address.city, o.shipping_address.state].filter(Boolean).join(", ")
          : "";
        return [
          `<strong>${esc(o.order_number ?? "")}</strong><br><span class="muted" style="font-size:0.8rem">${esc(o.partner_order_id ?? "")}</span>`,
          shStatusBadge(o.fulfillment_status),
          fmtTime(o.updated_at),
          esc(addr),
          skuList || '<span class="muted">—</span>',
          printLabelAction(o.id, o.fulfillment_status),
        ];
      })
    );

    // cursor-based pager
    const { hasNextPage, endCursor } = data.pageInfo ?? {};
    const pagerEl = document.getElementById("sh-orders-pager");
    const histLen = state.shOrdersHistory.length;
    pagerEl.innerHTML = `
      ${histLen > 0 ? `<button type="button" id="sh-orders-prev">Prev</button>` : ""}
      <span class="muted" style="font-size:0.85rem">Page ${histLen + 1}</span>
      ${hasNextPage ? `<button type="button" id="sh-orders-next">Next</button>` : ""}
    `;
    pagerEl.querySelector("#sh-orders-prev")?.addEventListener("click", () => {
      state.shOrdersAfter = state.shOrdersHistory.pop() ?? null;
      loadShipheroOrders();
    });
    pagerEl.querySelector("#sh-orders-next")?.addEventListener("click", () => {
      state.shOrdersHistory.push(state.shOrdersAfter);
      state.shOrdersAfter = endCursor;
      loadShipheroOrders();
    });
  } catch (err) {
    hint.textContent = "Error: " + err.message;
  }
}

async function loadShipheroProducts() {
  const hint = document.getElementById("sh-products-hint");
  hint.textContent = "Loading products…";
  try {
    const params = new URLSearchParams({ limit: "25" });
    if (state.shProductsAfter) params.set("after", state.shProductsAfter);
    if (state.shProductsSearch) params.set("search", state.shProductsSearch);

    const data = await api(`/api/shiphero/products?${params}`);
    const products = data.products ?? [];
    hint.textContent = products.length ? "" : "No products found for this search.";

    document.getElementById("sh-products-table").innerHTML = table(
      ["Name", "SKU", "On Hand", "Available", "Allocated", "Backorder", "Price", "Value"],
      products.map((p) => [
        `<a class="link" href="https://app.shiphero.com/dashboard/products/v2/manage?search=${encodeURIComponent(p.sku)}" target="_blank" rel="noopener">${esc(p.name || p.sku)}</a>`,
        `<code>${esc(p.sku)}</code>`,
        esc(p.onHand ?? 0),
        esc(p.available ?? 0),
        esc(p.allocated ?? 0),
        esc(p.backorder ?? 0),
        p.price ? esc(p.price) : '<span class="muted">—</span>',
        p.value ? esc(p.value) : '<span class="muted">—</span>',
      ])
    );

    const { hasNextPage, endCursor } = data.pageInfo ?? {};
    const pagerEl = document.getElementById("sh-products-pager");
    const histLen = state.shProductsHistory.length;
    pagerEl.innerHTML = `
      ${histLen > 0 ? `<button type="button" id="sh-products-prev">Prev</button>` : ""}
      <span class="muted" style="font-size:0.85rem">Page ${histLen + 1}</span>
      ${hasNextPage ? `<button type="button" id="sh-products-next">Next</button>` : ""}
    `;
    pagerEl.querySelector("#sh-products-prev")?.addEventListener("click", () => {
      state.shProductsAfter = state.shProductsHistory.pop() ?? null;
      loadShipheroProducts();
    });
    pagerEl.querySelector("#sh-products-next")?.addEventListener("click", () => {
      state.shProductsHistory.push(state.shProductsAfter);
      state.shProductsAfter = endCursor;
      loadShipheroProducts();
    });
  } catch (err) {
    hint.textContent = "Error: " + err.message;
  }
}

async function loadShiphero() {
  await Promise.all([loadShipheroOrders(), loadShipheroProducts()]);
}

// ─────────────────────────────────────────────────────────────────────────────

async function loadActiveTab() {
  try {
    if (state.tab === "overview") await loadOverview();
    if (state.tab === "korona") await loadKorona();
    if (state.tab === "mappings") await loadMappings();
    if (state.tab === "orders") await loadOrders();
    if (state.tab === "receipts") await loadReceipts();
    if (state.tab === "reports") await loadReports();
    if (state.tab === "shiphero") await loadShiphero();
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

bindSearchInput("korona-search", {
  getValue: () => state.koronaSearch,
  setValue: (v) => { state.koronaSearch = v; },
  resetPages: () => { state.koronaPage = 1; },
  load: () => { if (state.tab === "korona") loadKorona(); },
});

bindSearchInput("orders-search", {
  getValue: () => state.ordersSearch,
  setValue: (v) => { state.ordersSearch = v; },
  resetPages: () => { state.ordersPage = 1; },
  load: () => { if (state.tab === "orders") loadOrders(); },
});

bindSearchInput("korona-orders-search", {
  getValue: () => state.koronaOrdersSearch,
  setValue: (v) => { state.koronaOrdersSearch = v; },
  resetPages: () => { state.koronaOrdersPage = 1; },
  load: () => { if (state.tab === "orders") loadOrders(); },
});

bindSearchInput("receipts-search", {
  getValue: () => state.receiptsSearch,
  setValue: (v) => { state.receiptsSearch = v; },
  resetPages: () => { state.receiptsPage = 1; },
  load: () => { if (state.tab === "receipts") loadReceipts(); },
});

bindSearchInput("korona-receipts-search", {
  getValue: () => state.koronaReceiptsSearch,
  setValue: (v) => { state.koronaReceiptsSearch = v; },
  resetPages: () => { state.koronaReceiptsPage = 1; },
  load: () => { if (state.tab === "receipts") loadReceipts(); },
});

bindSearchInput("logs-search", {
  getValue: () => state.logsSearch,
  setValue: (v) => { state.logsSearch = v; },
  resetPages: () => { state.logsPage = 1; },
  load: () => { if (state.tab === "logs") loadLogs(); },
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

// ShipHero tab event listeners
document.getElementById("sh-orders-search").addEventListener("input", (e) => {
  state.shOrdersSearch = e.target.value;
  state.shOrdersAfter = null;
  state.shOrdersHistory = [];
  clearTimeout(window._shOrdersTimer);
  window._shOrdersTimer = setTimeout(() => {
    if (state.tab === "shiphero") loadShipheroOrders();
  }, 400);
});

document.getElementById("sh-orders-status").addEventListener("change", (e) => {
  state.shOrdersStatus = e.target.value;
  state.shOrdersAfter = null;
  state.shOrdersHistory = [];
  if (state.tab === "shiphero") loadShipheroOrders();
});

document.getElementById("sh-orders-refresh").addEventListener("click", () => {
  state.shOrdersAfter = null;
  state.shOrdersHistory = [];
  if (state.tab === "shiphero") loadShipheroOrders();
});

document.getElementById("sh-orders-table").addEventListener("click", (e) => {
  const btn = e.target.closest(".sh-print-label");
  if (!btn || btn.disabled) return;
  const orderId = btn.dataset.orderId;
  if (!orderId) return;
  void printShipheroLabel(orderId, btn);
});

document.getElementById("sh-products-search").addEventListener("input", (e) => {
  state.shProductsSearch = e.target.value;
  state.shProductsAfter = null;
  state.shProductsHistory = [];
  clearTimeout(window._shProductsTimer);
  window._shProductsTimer = setTimeout(() => {
    if (state.tab === "shiphero") loadShipheroProducts();
  }, 400);
});

document.getElementById("sh-products-refresh").addEventListener("click", () => {
  state.shProductsAfter = null;
  state.shProductsHistory = [];
  if (state.tab === "shiphero") loadShipheroProducts();
});

// ShipHero Inventory CSV: set default date range (last 7 days)
(function () {
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(toDate.getDate() - 7);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const fromEl = document.getElementById("sh-csv-from");
  const toEl = document.getElementById("sh-csv-to");
  if (fromEl && !fromEl.value) fromEl.value = fmt(fromDate);
  if (toEl && !toEl.value) toEl.value = fmt(toDate);
})();

document.getElementById("sh-csv-btn").addEventListener("click", async () => {
  const from = document.getElementById("sh-csv-from").value.trim();
  const to = document.getElementById("sh-csv-to").value.trim();
  const store = document.getElementById("sh-csv-store").value.trim();
  const status = document.getElementById("sh-csv-status");

  if (!from || !to) {
    status.textContent = "Please select both From and To dates.";
    return;
  }

  status.textContent = "Generating CSV… this may take a minute.";
  const btn = document.getElementById("sh-csv-btn");
  btn.disabled = true;

  try {
    let url = `/api/export/shiphero-inventory.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    if (store) url += `&store=${encodeURIComponent(store)}`;

    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? res.statusText);
    }

    const blob = await res.blob();
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `shiphero-inventory-${from}-to-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    status.textContent = "CSV downloaded successfully.";
  } catch (err) {
    status.textContent = "Error: " + err.message;
  } finally {
    btn.disabled = false;
  }
});

refreshAll();
setInterval(refreshAll, 30000);
