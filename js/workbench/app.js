import {
  identifier,
  escapeHtml,
  parseCsv,
  displayValue,
  resultObjects,
  toCsv,
  sqlLiteral,
  examples,
} from "./data.js";
const $ = (selector) => document.querySelector(selector);
const paths = {
  database:
    "M20 6c0 2.2-3.6 4-8 4S4 8.2 4 6s3.6-4 8-4 8 1.8 8 4ZM4 6v12c0 2.2 3.6 4 8 4s8-1.8 8-4V6M4 12c0 2.2 3.6 4 8 4s8-1.8 8-4",
  table:
    "M3 9h18M9 9v12M3 15h18M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z",
  folder: "M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v1M3 7h18l-2 12H3V7Z",
  plus: "M12 5v14M5 12h14",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  shield: "M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4ZM8 12l3 3 5-6",
  sun: "M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z",
  keyboard:
    "M3 5h18v14H3V5ZM7 9h.01M11 9h.01M15 9h.01M18 9h.01M7 12h.01M11 12h.01M15 12h.01M18 12h.01M7 16h10",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
  bookmark: "M6 3h12v18l-6-4-6 4V3Z",
  upload: "M12 16V3M7 8l5-5 5 5M4 15v6h16v-6",
  download: "M12 3v13M7 11l5 5 5-5M4 16v5h16v-5",
  chevron: "m6 9 6 6 6-6",
  right: "m9 5 7 7-7 7",
  left: "m15 5-7 7 7 7",
  x: "M6 6l12 12M6 18 18 6",
  play: "m8 4 12 8-12 8V4Z",
  stop: "M5 5h14v14H5V5Z",
  align: "M3 5h18M3 10h12M3 15h18M3 20h12",
  route:
    "M5 5h8a5 5 0 0 1 0 10H7a3 3 0 0 0 0 6h12M4 3h2v4H4V3ZM18 19h3v3h-3v-3",
  chart: "M4 3v18h17M9 16v-5M14 16V7M19 16V4",
  menu: "M4 6h16M4 12h16M4 18h16",
  key: "M16 11a5 5 0 1 0-5-5 5 5 0 0 0 5 5ZM12 10 3 19v3h3v-3h3v-3h3l2-2",
  sparkles: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.table}"/></svg>`;
}
function hydrateIcons(root = document) {
  root
    .querySelectorAll("[data-icon]")
    .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
}
hydrateIcons();
const key = "tablenest-workspace-v1";
function loadJson(name, fallback) {
  try {
    return JSON.parse(localStorage.getItem(name)) ?? fallback;
  } catch {
    return fallback;
  }
}
let stored = loadJson(key, {}),
  tabs =
    Array.isArray(stored.tabs) && stored.tabs.length
      ? stored.tabs
      : [{ id: crypto.randomUUID(), title: "订单明细", sql: examples[0].sql }],
  active = stored.active || tabs[0].id;
if (!tabs.some((t) => t.id === active)) active = tabs[0].id;
let history = loadJson("tablenest-history", []),
  saved = loadJson("tablenest-saved", []);
let worker,
  pending = new Map(),
  seq = 0,
  operationVersion = 0,
  busy = false,
  schema = [],
  currentResult = { columns: [], values: [] },
  page = 0,
  sort = { index: -1, direction: 1 },
  snapshot = null,
  databaseName = "零售数据.db",
  isDirty = false,
  chart = false;
let toastTimer,
  saveTimer,
  dialogCleanup = () => {};
const editor = $("#sql-editor");
const currentTab = () => tabs.find((t) => t.id === active) || tabs[0];
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 3500);
}
function persistTabs() {
  try {
    localStorage.setItem(key, JSON.stringify({ tabs, active }));
  } catch {
    toast("浏览器存储空间不足，请下载 SQL 备份。");
  }
}
function persistCollections() {
  try {
    localStorage.setItem("tablenest-history", JSON.stringify(history));
    localStorage.setItem("tablenest-saved", JSON.stringify(saved));
  } catch {
    toast("查询记录无法保存，请检查浏览器存储空间。");
  }
  updateCounts();
}
function updateCounts() {
  $("#history-count").textContent = history.length;
  $("#saved-count").textContent = saved.length;
}
const databaseStorage = new Promise((resolve, reject) => {
  const req = indexedDB.open("tablenest-local", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("workspace");
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
async function storedDatabase(action, value) {
  const db = await databaseStorage;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      "workspace",
      action === "get" ? "readonly" : "readwrite",
    );
    const req =
      action === "get"
        ? tx.objectStore("workspace").get("current")
        : tx.objectStore("workspace").put(value, "current");
    req.onsuccess = () => {
      if (action === "get") resolve(req.result);
    };
    tx.oncomplete = () => {
      if (action !== "get") resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}
function checkpoint(state) {
  schema = state.schema || schema;
  if (state.bytes) snapshot = state.bytes;
  renderSchema();
  $("#engine-version").textContent = `SQLite ${state.version || ""} · WASM`;
  $("#database-name").textContent = databaseName;
  $("#database-meta").textContent =
    `${schema.filter((t) => t.type === "table").length} 张表 · ${snapshot ? formatBytes(snapshot.byteLength) : "本地内存"}`;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(
    () =>
      storedDatabase("put", { bytes: snapshot, name: databaseName })
        .then(() => {
          $("#database-meta").title = "已自动保存到此浏览器";
        })
        .catch(() => toast("自动保存失败，请导出数据库文件备份。")),
    350,
  );
}
function formatBytes(n) {
  return n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;
}
function startWorker() {
  worker = new Worker("/js/workbench/worker.js");
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id);
    if (!job) return;
    clearTimeout(job.timer);
    pending.delete(data.id);
    data.ok ? job.resolve(data.result) : job.reject(Error(data.error));
  };
  worker.onerror = (e) => {
    for (const job of pending.values()) {
      clearTimeout(job.timer);
      job.reject(Error(e.message || "SQLite 引擎加载失败，请刷新页面重试。"));
    }
    pending.clear();
  };
}
function request(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error("操作等待超时，请停止运行或刷新后重试。"));
    }, 25000);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, type, payload });
  });
}
function setBusy(value) {
  busy = value;
  $("#run-query").disabled = value;
  $("#cancel-query").hidden = !value;
  for (const selector of [
    "#open-file",
    "#new-database",
    "#load-demo",
    "#import-csv",
    "#export-database",
    "#export-dump",
    "#explain-query",
  ])
    $(selector).disabled = value;
  editor.disabled = false;
}
function status(message, error = false) {
  const node = $("#query-status");
  node.classList.toggle("error", error);
  node.innerHTML = `<span class="status-dot"></span><span>${escapeHtml(message)}</span>`;
}
function renderTabs() {
  const root = $("#query-tabs");
  root.innerHTML = tabs
    .map(
      (t) =>
        `<div role="tab" tabindex="${t.id === active ? 0 : -1}" class="query-tab" aria-selected="${t.id === active}" data-tab="${t.id}" aria-controls="editor-container"><span aria-hidden="true">SQL</span><span class="tab-title">${escapeHtml(t.title)}</span><button class="tab-close" aria-label="关闭查询 ${escapeHtml(t.title)}" data-close-tab="${t.id}">×</button></div>`,
    )
    .join("");
}
function switchTab(id) {
  if (!tabs.some((t) => t.id === id)) return;
  currentTab().sql = editor.value;
  active = id;
  editor.value = currentTab().sql;
  renderTabs();
  highlight();
  persistTabs();
  editor.focus();
}
function addTab(sql = "", title) {
  currentTab().sql = editor.value;
  const tab = {
    id: crypto.randomUUID(),
    title: title || `查询 ${tabs.length + 1}`,
    sql,
  };
  tabs.push(tab);
  active = tab.id;
  editor.value = sql;
  renderTabs();
  highlight();
  persistTabs();
  editor.focus();
}
function closeTab(id) {
  if (tabs.length === 1) {
    toast("至少保留一个查询标签。");
    return;
  }
  const index = tabs.findIndex((t) => t.id === id);
  tabs.splice(index, 1);
  if (active === id) {
    active = tabs[Math.max(0, index - 1)].id;
    editor.value = currentTab().sql;
  }
  renderTabs();
  highlight();
  persistTabs();
}
$("#query-tabs").addEventListener("click", (event) => {
  const close = event.target.closest("[data-close-tab]");
  if (close) {
    closeTab(close.dataset.closeTab);
    return;
  }
  const tab = event.target.closest("[data-tab]");
  if (tab) switchTab(tab.dataset.tab);
});
$("#query-tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const index = tabs.findIndex((t) => t.id === active);
  switchTab(
    tabs[
      (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length
    ].id,
  );
});
$("#query-tabs").addEventListener("dblclick", (event) => {
  const tab = event.target.closest("[data-tab]");
  if (tab) renameQuery(tab.dataset.tab);
});
const tokenPattern =
  /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:''|[^'])*'|"(?:""|[^"])*")|\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|DROP|ALTER|TABLE|INDEX|VIEW|TRIGGER|PRIMARY|KEY|INTEGER|TEXT|REAL|NOT|NULL|DEFAULT|AND|OR|IN|IS|LIKE|DISTINCT|UNION|ALL|CASE|WHEN|THEN|ELSE|END|WITH|RECURSIVE|OVER|PARTITION|DESC|ASC|COUNT|SUM|AVG|MIN|MAX|DENSE_RANK|EXPLAIN|QUERY|PLAN|BEGIN|COMMIT|ROLLBACK)\b|\b(\d+(?:\.\d+)?)\b/gi;
function highlight() {
  const sql = editor.value;
  let html = "",
    last = 0;
  for (const match of sql.matchAll(tokenPattern)) {
    html += escapeHtml(sql.slice(last, match.index));
    const type = match[1]
      ? "comment"
      : match[2]
        ? "string"
        : match[3]
          ? "keyword"
          : "number";
    html += `<span class="sql-${type}">${escapeHtml(match[0])}</span>`;
    last = match.index + match[0].length;
  }
  html += escapeHtml(sql.slice(last)) + "\n";
  $("#sql-highlight code").innerHTML = html;
  $("#line-numbers").textContent = Array.from(
    { length: sql.split("\n").length },
    (_, i) => i + 1,
  ).join("\n");
  syncScroll();
}
function syncScroll() {
  $("#sql-highlight").scrollTop = editor.scrollTop;
  $("#sql-highlight").scrollLeft = editor.scrollLeft;
  $("#line-numbers").scrollTop = editor.scrollTop;
}
editor.addEventListener("input", () => {
  currentTab().sql = editor.value;
  highlight();
  persistTabs();
});
editor.addEventListener("scroll", syncScroll);
editor.addEventListener("select", () => {
  $("#selection-hint").textContent =
    editor.selectionStart !== editor.selectionEnd
      ? "将运行选中的 SQL"
      : "选中一段，可单独运行";
});
editor.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    editor.setRangeText(
      "  ",
      editor.selectionStart,
      editor.selectionEnd,
      "end",
    );
    editor.dispatchEvent(new Event("input"));
  }
});
function renderSchema() {
  const filter = $("#schema-filter").value.toLowerCase();
  $("#object-count").textContent = schema.length;
  const items = schema.filter((t) => t.name.toLowerCase().includes(filter));
  $("#schema-tree").innerHTML = items.length
    ? items
        .map(
          (table) =>
            `<div class="schema-object"><div class="object-row"><button class="object-toggle" data-expand="${escapeHtml(table.name)}" aria-expanded="false" aria-label="展开 ${escapeHtml(table.name)} 的字段">${icon("right")}</button><button class="object-name" data-table="${escapeHtml(table.name)}" title="查看 ${escapeHtml(table.name)} 前 200 行">${icon(table.type === "view" ? "route" : "table")}<span>${escapeHtml(table.name)}</span></button></div><div class="object-fields" data-fields="${escapeHtml(table.name)}" hidden>${table.columns.map((c) => `<div class="field">${c.pk ? icon("key") : '<span style="width:11px"></span>'}<span class="field-name">${escapeHtml(c.name)}</span><span class="field-type">${escapeHtml(c.type || "ANY")}</span></div>`).join("")}</div></div>`,
        )
        .join("")
    : `<p class="sidebar-empty">${schema.length ? "没有匹配的表。" : "数据库是空的，试试 CREATE TABLE。"}</p>`;
}
$("#schema-tree").addEventListener("click", (event) => {
  const expand = event.target.closest("[data-expand]");
  if (expand) {
    const block = expand
      .closest(".schema-object")
      .querySelector(".object-fields");
    block.hidden = !block.hidden;
    expand.setAttribute("aria-expanded", String(!block.hidden));
    return;
  }
  const table = event.target.closest("[data-table]");
  if (table) {
    if (busy) return;
    addTab(
      `SELECT * FROM ${identifier(table.dataset.table)} LIMIT 200;`,
      table.dataset.table,
    );
    run();
    closeSidebar();
  }
});
$("#schema-filter").addEventListener("input", renderSchema);
async function run(override) {
  if (busy) return;
  const runVersion = ++operationVersion;
  const sql =
    typeof override === "string"
      ? override
      : editor.value.slice(editor.selectionStart, editor.selectionEnd).trim() ||
        editor.value;
  if (!sql.trim()) {
    status("写一条 SQL，再点击运行。");
    editor.focus();
    return;
  }
  setBusy(true);
  status("正在执行查询…");
  try {
    const result = await request("run", { sql });
    checkpoint(result);
    currentResult = result;
    page = 0;
    sort = { index: -1, direction: 1 };
    $("#result-filter").value = "";
    renderResult();
    status(
      `查询完成 · ${result.totalRows} 行结果 · ${result.elapsed} ms${result.truncated ? " · 预览限前 5,000 行" : ""}`,
    );
    history = [
      {
        id: crypto.randomUUID(),
        sql,
        date: Date.now(),
        rows: result.totalRows,
        elapsed: result.elapsed,
      },
      ...history.filter((h) => h.sql !== sql),
    ].slice(0, 100);
    persistCollections();
    isDirty = true;
  } catch (error) {
    if (runVersion === operationVersion)
      status(`执行失败：${error.message}`, true);
  } finally {
    if (runVersion === operationVersion) setBusy(false);
  }
}
function filteredRows() {
  let rows = currentResult.values.map((row, index) => ({ row, index }));
  const search = $("#result-filter").value.toLowerCase();
  if (search)
    rows = rows.filter((item) =>
      item.row.some((value) =>
        displayValue(value).toLowerCase().includes(search),
      ),
    );
  if (sort.index >= 0)
    rows.sort((a, b) => {
      const av = a.row[sort.index],
        bv = b.row[sort.index];
      return (
        sort.direction *
        (av === bv
          ? 0
          : av === null
            ? -1
            : bv === null
              ? 1
              : typeof av === "number" && typeof bv === "number"
                ? av - bv
                : String(av).localeCompare(String(bv), "zh-CN", {
                    numeric: true,
                  }))
      );
    });
  return rows;
}
function renderResult() {
  const rows = filteredRows(),
    size = Number($("#page-size").value),
    pages = Math.max(1, Math.ceil(rows.length / size));
  page = Math.max(0, Math.min(page, pages - 1));
  $("#result-count").textContent = currentResult.values.length;
  $("#result-summary").textContent =
    `${rows.length} 条记录${currentResult.truncated ? "（预览上限 5,000）" : ""}`;
  $("#page-number").textContent = `${page + 1} / ${pages}`;
  $("#previous-page").disabled = page === 0;
  $("#next-page").disabled = page === pages - 1;
  if (!currentResult.columns.length) {
    $("#result-table").innerHTML =
      `<div class="result-empty"><span>${icon("table")}</span><strong>执行完成，暂无结果集。</strong><p>SELECT 查询会在这里显示数据；写入操作后可在左侧查看表结构。</p></div>`;
  } else {
    const visible = rows.slice(page * size, (page + 1) * size);
    $("#result-table").innerHTML =
      `<table class="data-table"><thead><tr><th class="row-index">#</th>${currentResult.columns.map((column, index) => `<th scope="col" aria-sort="${sort.index === index ? (sort.direction === 1 ? "ascending" : "descending") : "none"}"><button data-sort="${index}">${escapeHtml(column)}<span aria-hidden="true">${sort.index === index ? (sort.direction === 1 ? "↑" : "↓") : "↕"}</span></button></th>`).join("")}</tr></thead><tbody>${visible.map((item, i) => `<tr><td class="row-index">${page * size + i + 1}</td>${item.row.map((value) => `<td class="${value === null ? "null" : typeof value === "number" ? "number" : value instanceof Uint8Array ? "blob" : ""}" title="${escapeHtml(displayValue(value))}">${escapeHtml(displayValue(value))}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${currentResult.columns.length + 1}" style="padding:30px;text-align:center">没有匹配的数据。</td></tr>`}</tbody></table>`;
  }
  if (chart) renderChart();
}
$("#result-table").addEventListener("click", (event) => {
  const button = event.target.closest("[data-sort]");
  if (button) {
    const index = Number(button.dataset.sort);
    sort = { index, direction: sort.index === index ? -sort.direction : 1 };
    renderResult();
  }
});
$("#result-filter").addEventListener("input", () => {
  page = 0;
  renderResult();
});
$("#page-size").addEventListener("change", () => {
  page = 0;
  renderResult();
});
$("#previous-page").onclick = () => {
  page--;
  renderResult();
};
$("#next-page").onclick = () => {
  page++;
  renderResult();
};
function setView(value) {
  chart = value;
  $("#result-table").hidden = chart;
  $("#result-chart").hidden = !chart;
  $("#view-table").setAttribute("aria-selected", String(!chart));
  $("#view-chart").setAttribute("aria-selected", String(chart));
  if (chart) renderChart();
}
function renderChart() {
  const rows = filteredRows()
    .slice(0, 50)
    .map((item) => item.row);
  const numeric = currentResult.columns.findIndex((_, i) =>
    rows.some((row) => typeof row[i] === "number"),
  );
  const label = currentResult.columns.findIndex((_, i) => i !== numeric);
  if (numeric < 0 || !rows.length) {
    $("#result-chart").innerHTML =
      '<div class="result-empty"><strong>先查询一组带数字的结果。</strong><p>例如运行“分类营收”，即可看到柱状图。</p></div>';
    return;
  }
  const max = Math.max(
    ...rows.map((row) => Math.abs(Number(row[numeric]) || 0)),
    1,
  );
  $("#result-chart").innerHTML =
    `<p class="chart-title">${escapeHtml(currentResult.columns[numeric])} <span style="color:var(--secondary);font-size:10px">· 前 ${rows.length} 条筛选结果 · 柱长表示绝对值</span></p>${rows.map((row, i) => `<div class="chart-row"><span class="chart-label" title="${escapeHtml(label < 0 ? i + 1 : displayValue(row[label]))}">${escapeHtml(label < 0 ? i + 1 : displayValue(row[label]))}</span><div class="chart-track"><div class="chart-bar" style="width:${Math.max(0, Math.min(100, (Math.abs(Number(row[numeric]) || 0) / max) * 100))}%"></div></div><span class="chart-value">${escapeHtml(displayValue(row[numeric]))}</span></div>`).join("")}`;
}
$("#view-table").onclick = () => setView(false);
$("#view-chart").onclick = () => setView(true);
function download(contents, name, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100) || "query";
}
$("#download-query").onclick = () =>
  download(editor.value, safeFilename(currentTab().title) + ".sql");
$("#export-database").onclick = async () => {
  closeMenus();
  if (busy) return;
  try {
    const result = await request("export");
    download(
      result.bytes,
      safeFilename(databaseName.replace(/\.db$/i, "")) + ".db",
      "application/vnd.sqlite3",
    );
    toast("数据库文件已导出。");
  } catch (error) {
    toast(error.message);
  }
};
$("#export-dump").onclick = async () => {
  closeMenus();
  if (busy) return;
  try {
    const result = await request("dump");
    download(
      result.sql,
      safeFilename(databaseName.replace(/\.db$/i, "")) + ".sql",
    );
    toast("SQL 脚本已导出。");
  } catch (error) {
    status(error.message, true);
  }
};
function exportResults(type) {
  closeMenus();
  if (!currentResult.columns.length) {
    toast("先运行查询，再导出结果。");
    return;
  }
  const result = {
    columns: currentResult.columns,
    values: filteredRows().map((item) => item.row),
  };
  if (type === "csv")
    download(toCsv(result), "查询结果.csv", "text/csv;charset=utf-8");
  else if (type === "json")
    download(
      JSON.stringify(resultObjects(result), null, 2),
      "查询结果.json",
      "application/json",
    );
  else
    download(
      `-- 将 result_table 替换为目标表名\n${result.values.map((row) => `INSERT INTO "result_table" (${result.columns.map(identifier).join(",")}) VALUES (${row.map(sqlLiteral).join(",")});`).join("\n")}`,
      "查询结果.sql",
    );
  toast(`已导出 ${result.values.length} 条筛选后的记录。`);
}
document
  .querySelectorAll("[data-export]")
  .forEach((el) => (el.onclick = () => exportResults(el.dataset.export)));
function closeMenus() {
  document.querySelectorAll(".menu").forEach((el) => (el.hidden = true));
  document
    .querySelectorAll('[aria-controls$="export-menu"]')
    .forEach((el) => el.setAttribute("aria-expanded", "false"));
}
for (const [button, menu] of [
  ["#export-database-button", "#database-export-menu"],
  ["#export-results-button", "#results-export-menu"],
])
  $(button).onclick = (event) => {
    event.stopPropagation();
    const next = $(menu).hidden;
    closeMenus();
    $(menu).hidden = !next;
    $(button).setAttribute("aria-expanded", String(next));
  };
document.addEventListener("click", (event) => {
  if (!event.target.closest(".menu-wrap")) closeMenus();
});
const dialog = $("#app-dialog");
let dialogOpener;
function showDialog(title, body, actions, setup) {
  dialogCleanup();
  dialogCleanup = () => {};
  dialogOpener = document.activeElement;
  $("#dialog-title").textContent = title;
  $("#dialog-body").innerHTML = body;
  $("#dialog-actions").innerHTML = actions;
  hydrateIcons(dialog);
  if (!dialog.open) dialog.showModal();
  $("#dialog-form").onsubmit = (event) => event.preventDefault();
  setup?.();
}
function closeDialog() {
  dialogCleanup();
  dialogCleanup = () => {};
  dialog.close();
  dialogOpener?.focus?.();
}
$("#dialog-close").onclick = closeDialog;
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) closeDialog();
});
dialog.addEventListener("cancel", () => dialogCleanup());
function confirmReplace(title, action) {
  if (busy) return;
  if (!isDirty) {
    action();
    return;
  }
  showDialog(
    title,
    "<p>这会替换当前数据库。请先使用“导出数据库”保存重要内容。</p><p>SQL 标签、历史和收藏会保留。</p>",
    '<button type="button" class="button" id="replace-cancel">取消</button><button type="button" class="button primary" id="replace-confirm">替换数据库</button>',
    () => {
      $("#replace-cancel").onclick = closeDialog;
      $("#replace-confirm").onclick = () => {
        closeDialog();
        action();
      };
    },
  );
}
function renameQuery(id) {
  const tab = tabs.find((t) => t.id === id);
  showDialog(
    "重命名查询",
    `<label for="query-name">查询名称</label><input id="query-name" type="text" maxlength="40" value="${escapeHtml(tab.title)}" required>`,
    '<button class="button primary" type="submit">保存名称</button>',
    () => {
      $("#dialog-form").onsubmit = (event) => {
        event.preventDefault();
        tab.title = $("#query-name").value.trim() || tab.title;
        renderTabs();
        persistTabs();
        closeDialog();
      };
    },
  );
}
$("#save-query").onclick = () => {
  const sql = editor.value.trim();
  if (!sql) {
    toast("当前查询是空的。");
    return;
  }
  showDialog(
    "收藏这个好问题",
    `<label for="saved-name">查询名称</label><input id="saved-name" type="text" maxlength="60" value="${escapeHtml(currentTab().title)}" required><p>收藏仅保存于当前浏览器。</p>`,
    '<button class="button primary" type="submit">保存到收藏</button>',
    () => {
      $("#dialog-form").onsubmit = (event) => {
        event.preventDefault();
        saved = [
          {
            id: crypto.randomUUID(),
            title: $("#saved-name").value.trim(),
            sql,
            date: Date.now(),
          },
          ...saved.filter((s) => s.sql !== sql),
        ].slice(0, 100);
        persistCollections();
        closeDialog();
        toast("已收藏，随时接着探索。");
      };
    },
  );
};
function openCollection(kind) {
  const items = kind === "saved" ? saved : history;
  const title = kind === "saved" ? "收藏的查询" : "查询历史";
  showDialog(
    title,
    items.length
      ? items
          .map(
            (item) =>
              `<article class="history-item"><div><strong>${escapeHtml(item.title || new Date(item.date).toLocaleString("zh-CN"))}</strong><pre>${escapeHtml(item.sql)}</pre><small>${kind === "saved" ? "本机收藏" : `${item.rows} 行 · ${item.elapsed} ms`}</small></div><button type="button" class="button" data-use-query="${item.id}">打开</button><button type="button" class="icon-button" data-delete-query="${item.id}" aria-label="删除这条记录">${icon("x")}</button></article>`,
          )
          .join("")
      : "<p>这里还没有记录。运行或收藏一条查询后，就会出现在这里。</p>",
    "",
    () => {
      $("#dialog-body").onclick = (event) => {
        const use = event.target.closest("[data-use-query]"),
          remove = event.target.closest("[data-delete-query]");
        if (use) {
          const item = items.find((i) => i.id === use.dataset.useQuery);
          closeDialog();
          addTab(item.sql, item.title || "历史查询");
        }
        if (remove) {
          if (kind === "saved")
            saved = saved.filter((i) => i.id !== remove.dataset.deleteQuery);
          else
            history = history.filter(
              (i) => i.id !== remove.dataset.deleteQuery,
            );
          persistCollections();
          openCollection(kind);
        }
      };
      dialogCleanup = () => ($("#dialog-body").onclick = null);
    },
  );
}
$("#open-history").onclick = () => openCollection("history");
$("#open-saved").onclick = () => openCollection("saved");
async function replaceDatabase(payload, name) {
  setBusy(true);
  status("正在加载数据库…");
  try {
    const result = await request("init", payload);
    databaseName = name;
    checkpoint(result);
    currentResult = { columns: [], values: [] };
    isDirty = false;
    renderResult();
    status("数据库已就绪，可从左侧选择表，或运行 SQL。");
    if (payload.demo) {
      editor.value = examples[0].sql;
      currentTab().sql = editor.value;
      highlight();
      persistTabs();
      setBusy(false);
      await run();
    }
  } catch (error) {
    status(`加载失败：${error.message}`, true);
  } finally {
    setBusy(false);
  }
}
$("#new-database").onclick = () =>
  confirmReplace("新建空数据库", () => replaceDatabase({}, "未命名.db"));
$("#load-demo").onclick = () =>
  confirmReplace("载入示例数据库", () =>
    replaceDatabase({ demo: true }, "零售数据.db"),
  );
$("#open-file").onclick = () => $("#database-file").click();
$("#database-file").onchange = async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > 50 * 1024 * 1024)
      throw Error("当前工作台支持最大 50 MB 的文件。");
    if (/\.sql$/i.test(file.name)) {
      addTab(await file.text(), file.name.replace(/\.sql$/i, ""));
      toast("SQL 文件已打开，点击运行以执行。");
    } else if (/\.csv$/i.test(file.name)) {
      await importCsvFile(file);
    } else {
      const bytes = await file.arrayBuffer();
      confirmReplace("打开数据库文件", () =>
        replaceDatabase({ bytes }, file.name),
      );
    }
  } catch (error) {
    status(error.message, true);
  }
};
$("#import-csv").onclick = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".csv,text/csv";
  input.onchange = () => {
    if (input.files[0])
      importCsvFile(input.files[0]).catch((error) =>
        status(error.message, true),
      );
  };
  input.click();
};
async function importCsvFile(file) {
  if (file.size > 10 * 1024 * 1024) throw Error("CSV 请控制在 10 MB 以内。");
  const text = await file.text();
  let parsed;
  function preview() {
    try {
      parsed = parseCsv(text, $("#csv-separator").value);
      if (parsed.values.length > 100000)
        throw Error("单次 CSV 导入上限为 100,000 行。");
      $("#csv-preview").innerHTML =
        `<p>识别到 ${parsed.columns.length} 列、${parsed.values.length} 行，所有列按 TEXT 类型导入。</p><div class="dialog-preview"><table class="data-table"><thead><tr>${parsed.columns.map((c) => `<th style="padding:9px">${escapeHtml(c)}</th>`).join("")}</tr></thead><tbody>${parsed.values
          .slice(0, 5)
          .map(
            (row) =>
              `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`,
          )
          .join("")}</tbody></table></div>`;
      $("#csv-confirm").disabled = false;
    } catch (error) {
      parsed = null;
      $("#csv-preview").textContent = error.message;
      $("#csv-confirm").disabled = true;
    }
  }
  showDialog(
    "让 CSV 变成一张表",
    `<p>文件：${escapeHtml(file.name)}。导入到当前数据库，不替换已有表。</p><label for="csv-table">新表名称</label><input id="csv-table" type="text" maxlength="64" value="${escapeHtml(file.name.replace(/\.csv$/i, "").replace(/[^\p{L}\p{N}_]/gu, "_") || "imported_data")}" required><label for="csv-separator">分隔符</label><select id="csv-separator"><option value=",">逗号 (,)</option><option value=";">分号 (;)</option><option value="&#9;">制表符 (Tab)</option></select><div id="csv-preview"></div>`,
    '<button type="submit" class="button primary" id="csv-confirm">确认导入</button>',
    () => {
      preview();
      $("#csv-separator").onchange = preview;
      $("#dialog-form").onsubmit = async (event) => {
        event.preventDefault();
        if (!parsed || busy) return;
        const table = $("#csv-table").value.trim();
        if (!table) return;
        $("#csv-confirm").disabled = true;
        setBusy(true);
        try {
          const result = await request("csv", { table, ...parsed });
          checkpoint(result);
          isDirty = true;
          closeDialog();
          setBusy(false);
          addTab(`SELECT * FROM ${identifier(table)} LIMIT 200;`, table);
          await run();
          toast("CSV 已导入到本机数据库。");
        } catch (error) {
          $("#csv-confirm").disabled = false;
          $("#csv-preview").textContent = "导入失败：" + error.message;
        } finally {
          setBusy(false);
        }
      };
    },
  );
}
$("#cancel-query").onclick = async () => {
  if (!busy) return;
  operationVersion++;
  worker.terminate();
  for (const job of pending.values()) {
    clearTimeout(job.timer);
    job.reject(Error("操作已停止。"));
  }
  pending.clear();
  startWorker();
  setBusy(true);
  try {
    const restored = await request("init", snapshot ? { bytes: snapshot } : {});
    checkpoint(restored);
    status("已停止，数据库已恢复到上次成功操作的状态。");
  } catch (error) {
    status(error.message, true);
  } finally {
    setBusy(false);
  }
};
$("#run-query").onclick = () => run();
$("#explain-query").onclick = () =>
  run(
    "EXPLAIN QUERY PLAN " +
      (editor.value.slice(editor.selectionStart, editor.selectionEnd).trim() ||
        editor.value),
  );
$("#format-query").onclick = () => {
  try {
    if (!window.sqlFormatter) throw Error("格式化组件尚未就绪，请稍后再试。");
    editor.value = window.sqlFormatter.format(editor.value, {
      language: "sqlite",
      keywordCase: "upper",
      tabWidth: 2,
    });
    editor.dispatchEvent(new Event("input"));
    toast("SQL 已整理。");
  } catch (error) {
    status("格式化失败：" + error.message, true);
  }
};
$("#add-tab").onclick = () => addTab();
$("#example-buttons").innerHTML = examples
  .map(
    (item, index) =>
      `<button data-example="${index}">${escapeHtml(item.title)} <span aria-hidden="true">↗</span></button>`,
  )
  .join("");
$("#example-buttons").onclick = (event) => {
  const button = event.target.closest("[data-example]");
  if (button) {
    const item = examples[Number(button.dataset.example)];
    addTab(item.sql, item.title);
  }
};
function closeSidebar() {
  $(".sidebar").classList.remove("open");
  $(".mobile-backdrop").hidden = true;
  $("#sidebar-open").setAttribute("aria-expanded", "false");
  $(".sidebar").inert = matchMedia("(max-width:800px)").matches;
  $("#workspace").inert = false;
  $(".app-header").inert = false;
  $(".sidebar").removeAttribute("role");
  $(".sidebar").removeAttribute("aria-modal");
}
$("#sidebar-open").onclick = () => {
  $(".sidebar").inert = false;
  $(".sidebar").setAttribute("role", "dialog");
  $(".sidebar").setAttribute("aria-modal", "true");
  $("#workspace").inert = true;
  $(".app-header").inert = true;
  $(".sidebar").classList.add("open");
  $(".mobile-backdrop").hidden = false;
  $("#sidebar-open").setAttribute("aria-expanded", "true");
  $("#sidebar-close").focus();
};
$("#sidebar-close").onclick = () => {
  closeSidebar();
  $("#sidebar-open").focus();
};
$(".mobile-backdrop").onclick = closeSidebar;
$("#theme-toggle").onclick = () => {
  const dark = document.documentElement.classList.toggle("dark");
  try {
    localStorage.setItem("tablenest-theme", dark ? "dark" : "light");
  } catch {}
  $("#theme-toggle").setAttribute(
    "aria-label",
    dark ? "切换浅色主题" : "切换深色主题",
  );
};
$("#help-button").onclick = () =>
  showDialog(
    "顺手一点的小技巧",
    '<div class="shortcut-list"><span>运行选中 SQL / 全部查询</span><kbd>Ctrl / ⌘ + Enter</kbd><span>下载当前 SQL</span><kbd>Ctrl / ⌘ + S</kbd><span>格式化查询</span><kbd>Ctrl / ⌘ + Shift + F</kbd><span>缩进</span><kbd>Tab</kbd><span>切换查询标签</span><kbd>标签上按 ← / →</kbd><span>重命名查询</span><kbd>双击标签</kbd></div><p style="margin-top:20px">查询最长执行 10 秒；运行中可停止，恢复到上次成功操作的数据库状态。结果最多预览 5,000 行，可添加 LIMIT 缩小查询范围。</p>',
    "",
  );
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenus();
    closeSidebar();
  }
  if (event.key === "Tab" && $(".sidebar").classList.contains("open")) {
    const items = Array.from(
      $(".sidebar").querySelectorAll("a,button,input,select"),
    ).filter((el) => !el.disabled && el.getClientRects().length);
    if (event.shiftKey && document.activeElement === items[0]) {
      event.preventDefault();
      items.at(-1).focus();
    } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
      event.preventDefault();
      items[0].focus();
    }
  }
  if (event.ctrlKey || event.metaKey) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (!dialog.open) run();
    }
    if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      $("#download-query").click();
    }
    if (event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      $("#format-query").click();
    }
  }
});
const narrow = matchMedia("(max-width:800px)");
narrow.addEventListener("change", () => closeSidebar());
closeSidebar();
async function init() {
  renderTabs();
  editor.value = currentTab().sql;
  highlight();
  updateCounts();
  startWorker();
  setBusy(true);
  let previous;
  try {
    previous = await storedDatabase("get");
  } catch {
    toast("浏览器存储不可用，本次可使用，关闭前请导出数据。");
  }
  try {
    const result = await request(
      "init",
      previous?.bytes ? { bytes: previous.bytes } : { demo: true },
    );
    databaseName = previous?.name || "零售数据.db";
    checkpoint(result);
    setBusy(false);
    if (editor.value.trim()) await run();
    else status("数据库已就绪。");
  } catch (error) {
    status("启动失败：" + error.message, true);
    setBusy(false);
  }
}
init();
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
