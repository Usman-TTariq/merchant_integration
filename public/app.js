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
    return new Intl.DateTimeFormat("en-US", {
      timeZone: state.displayTimezone,
      dateStyle: "medium",
      timeStyle: "short",
      timeZoneName: "short",
    }).format(d);
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
    <div><dt>SKU field</dt><dd>${esc(cfg.skuField)}</dd></div>
    <div><dt>ShipHero auth</dt><dd>${esc(cfg.shipheroAuthMode)}</dd></div>
    <div><dt>Warehouse ID</dt><dd>${esc(cfg.warehouseId ?? "not set")}</dd></div>
    <div><dt>Database</dt><dd>${esc(cfg.databaseProvider)} — ${esc(cfg.databaseDetail ?? "")}</dd></div>
    <div><dt>Display timezone</dt><dd>${esc(cfg.displayTimezone ?? DEFAULT_TIMEZONE)}</dd></div>
    <div><dt>Korona detail</dt><dd>${esc(status.korona.detail ?? "")}</dd></div>
    <div><dt>ShipHero detail</dt><dd>${esc(status.shiphero.detail ?? "")}</dd></div>
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
    ["Receipt ID", "Processed at"],
    data.rows.map((r) => [esc(r.receipt_id), fmtTime(r.processed_at)])
  );
  pager("receipts-pager", data.page, data.total, data.limit, (p) => {
    state.receiptsPage = p;
    loadReceipts();
  });

  const live = await api(`/api/korona/receipts?page=${state.koronaReceiptsPage}`);
  document.getElementById("korona-receipts-table").innerHTML = table(
    ["Number", "ID", "Sale lines", "Revision", "Created", "Modified"],
    live.receipts.map((r) => [
      esc(r.number),
      `<code>${esc(r.id)}</code>`,
      esc(r.lineCount),
      esc(r.revision ?? ""),
      fmtTime(r.creationTime),
      fmtTime(r.modificationTime),
    ])
  );
  pager("korona-receipts-pager", live.page, live.total, 100, (p) => {
    state.koronaReceiptsPage = p;
    loadReceipts();
  });
}

async function loadLogs() {
  const level = state.logLevel ? `&level=${state.logLevel}` : "";
  const data = await api(`/api/logs?page=${state.logsPage}&limit=100${level}`);
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
  loadLogs();
});

refreshAll();
setInterval(refreshAll, 15000);
