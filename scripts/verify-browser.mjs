import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] || "http://127.0.0.1:8896";
const profile = mkdtempSync(join(tmpdir(), "toolbox-browser-"));
const port = 9400 + Math.floor(Math.random() * 500);
const browser = spawn(
  process.env.CHROME_BIN ||
    "/root/.cache/ms-playwright/chromium-1148/chrome-linux/chrome",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errors = [],
  analytics = [],
  analyticsResponses = [],
  expectedOfflineFailures = [];
let intentionalOffline = false;
let ws,
  passed = 0;
try {
  let endpoint;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      endpoint = (
        await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
      ).webSocketDebuggerUrl;
      break;
    } catch {
      await sleep(200);
    }
  }
  assert.ok(endpoint, "Chromium started");
  ws = new WebSocket(endpoint);
  await new Promise((resolve) => {
    ws.onopen = resolve;
  });
  let sequence = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      clearTimeout(timer);
      pending.delete(message.id);
      message.error
        ? reject(new Error(JSON.stringify(message.error)))
        : resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown")
      errors.push(
        message.params.exceptionDetails.exception?.description ||
          message.params.exceptionDetails.text,
      );
    if (
      message.method === "Log.entryAdded" &&
      message.params.entry.level === "error"
    ) {
      const entry = message.params.entry;
      if (
        intentionalOffline &&
        entry.text.includes("ERR_INTERNET_DISCONNECTED")
      )
        expectedOfflineFailures.push(entry.url || entry.text);
      else errors.push(entry.text);
    }
    if (
      message.method === "Network.requestWillBeSent" &&
      /google-analytics\.com\/g\/collect/.test(message.params.request.url)
    )
      analytics.push(
        message.params.request.url + (message.params.request.postData || ""),
      );
    if (
      message.method === "Network.responseReceived" &&
      /google-analytics\.com\/g\/collect/.test(message.params.response.url)
    )
      analyticsResponses.push(message.params.response.status);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 20000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const { targetId } = await send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const page = (method, params = {}) => send(method, params, sessionId);
  await page("Page.enable");
  await page("Runtime.enable");
  await page("Log.enable");
  await page("Network.enable");
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const evaluate = async (expression) => {
    const result = await page("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text,
      );
    return result.result.value;
  };
  const until = async (expression, label) => {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await sleep(150);
    }
    throw new Error(`Timed out: ${label}`);
  };
  const navigate = async (path) => {
    await page("Page.navigate", { url: new URL(path, base).href });
    await until(
      'document.querySelector(".app-header") !== null',
      "Workspace rendered",
    );
    await sleep(350);
  };
  const check = (label, result) => {
    assert.ok(result, label);
    passed++;
    console.log(`PASS ${label}`);
  };
  const input = async (selector, value) =>
    evaluate(
      `(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el)throw Error('Missing input'); Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true})); })()`,
    );

  const downloads = mkdtempSync(join(tmpdir(), "tablenest-downloads-"));
  await send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloads,
    eventsEnabled: true,
  });
  const click = async (selector) =>
    evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const sql = async (value) => input("#sql-editor", value);
  const runSql = async (value) => {
    await sql(value);
    await click("#run-query");
    await until(
      '!document.querySelector("#run-query").disabled',
      "SQL finished",
    );
  };
  const firstCell = () =>
    evaluate(
      'document.querySelector(".data-table tbody tr td:nth-child(2)")?.textContent',
    );
  const downloadFile = async (suffix) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const file = readdirSync(downloads).find((name) => name.endsWith(suffix));
      if (file) return join(downloads, file);
      await sleep(100);
    }
    throw Error("Download missing: " + suffix);
  };
  const setFile = async (filename) => {
    const { root } = await page("DOM.getDocument");
    const { nodeId } = await page("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "#database-file",
    });
    await page("DOM.setFileInputFiles", { nodeId, files: [filename] });
  };
  await navigate("/?visit_test=privacy-check");
  await until(
    'document.querySelector("#query-status")?.textContent.includes("查询完成")',
    "SQLite initialized",
  );
  check(
    "Chinese workspace and exactly one heading",
    await evaluate(
      'document.documentElement.lang==="zh-CN" && document.querySelectorAll("h1").length===1 && document.title.includes("表间")',
    ),
  );
  check(
    "Real SQLite returns twelve demo orders",
    await evaluate(
      'document.querySelectorAll(".data-table tbody tr").length===12',
    ),
  );
  check(
    "Schema includes tables and view",
    await evaluate('document.querySelectorAll(".schema-object").length===3'),
  );
  await click(".object-toggle");
  check(
    "Schema field explorer expands",
    await evaluate(
      'document.querySelector(".object-toggle").getAttribute("aria-expanded")==="true" && !document.querySelector(".object-fields").hidden',
    ),
  );
  await runSql(
    "CREATE TABLE \"edge cases\" (id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT, payload BLOB, missing TEXT, huge INTEGER); INSERT INTO \"edge cases\" (note,payload,missing,huge) VALUES ('O''Brien <img src=x onerror=alert(1)>',X'00ff',NULL,9223372036854775807); SELECT * FROM \"edge cases\";",
  );
  check(
    "Write queries update schema and return data",
    await evaluate(
      'document.querySelectorAll(".schema-object").length===4 && document.querySelector(".data-table").textContent.includes("O\'Brien")',
    ),
  );
  check(
    "Result text is escaped, NULL and BLOB are distinct",
    await evaluate(
      '!document.querySelector(".data-table img") && document.querySelector(".data-table .null")?.textContent==="NULL" && document.querySelector(".data-table .blob")?.textContent.includes("2 bytes")',
    ),
  );
  await runSql(
    "CREATE TABLE nul_text(value TEXT); INSERT INTO nul_text VALUES ('a'||char(0)||'b');",
  );
  await runSql("SELECT 1 AS first; SELECT 42 AS answer;");
  check(
    "Multiple statements show final populated result",
    (await firstCell()) === "42",
  );
  await runSql("SELECT 1 AS old; SELECT 42 AS empty WHERE 0;");
  check(
    "Empty final result retains its column metadata",
    await evaluate(
      'document.querySelector(".data-table th")?.parentElement.textContent.includes("empty") && document.querySelector("#result-count").textContent==="0"',
    ),
  );
  await sql("SELECT 17 AS selected; THIS IS NOT VALID SQL;");
  await evaluate(
    'document.querySelector("#sql-editor").setSelectionRange(0,22)',
  );
  await click("#run-query");
  await until(
    '!document.querySelector("#run-query").disabled',
    "selected SQL executed",
  );
  check("Only selected SQL executes", (await firstCell()) === "17");
  await runSql("SELECT * FROM this_table_does_not_exist;");
  check(
    "SQL errors are visible and recoverable",
    await evaluate(
      'document.querySelector("#query-status").classList.contains("error") && document.querySelector("#query-status")?.textContent.includes("no such table")',
    ),
  );
  await click("#add-tab");
  await sql("SELECT 123 AS shortcut;");
  await page("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    modifiers: 2,
  });
  await page("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    modifiers: 2,
  });
  await until(
    'document.querySelector(".data-table tbody tr td:nth-child(2)")?.textContent==="123"',
    "keyboard run",
  );
  check(
    "Query tabs and Ctrl+Enter work",
    await evaluate('document.querySelectorAll(".query-tab").length===2'),
  );
  await sql(
    "select 'Keep CASE and  spaces' as label, 3 as total from orders limit 1",
  );
  await click("#format-query");
  check(
    "Formatter preserves literals and formats keywords",
    await evaluate(
      'document.querySelector("#sql-editor").value.includes("SELECT") && document.querySelector("#sql-editor").value.includes("Keep CASE and  spaces")',
    ),
  );
  await runSql(
    "WITH RECURSIVE data(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM data WHERE n<205) SELECT n, 'record '||n AS label FROM data;",
  );
  check(
    "Pagination limits displayed rows",
    await evaluate(
      'document.querySelectorAll(".data-table tbody tr").length===50 && document.querySelector("#page-number").textContent==="1 / 5"',
    ),
  );
  await click("#next-page");
  check("Next page contains the next rows", (await firstCell()) === "51");
  await click(".data-table th:nth-child(2) button");
  await click(".data-table th:nth-child(2) button");
  await click("#previous-page");
  check("Numeric sort is descending", (await firstCell()) === "205");
  await input("#result-filter", "record 205");
  check(
    "Result filtering works across all preview rows",
    await evaluate(
      'document.querySelectorAll(".data-table tbody tr").length===1 && document.querySelector("#result-summary").textContent.includes("1 条")',
    ),
  );
  await click("#export-results-button");
  check(
    "Export menu opens accessibly",
    await evaluate(
      'document.querySelector("#export-results-button").getAttribute("aria-expanded")==="true"',
    ),
  );
  await click("[data-export=json]");
  const jsonFile = await downloadFile(".json");
  const exported = JSON.parse(readFileSync(jsonFile, "utf8"));
  check(
    "JSON download contains filtered real results",
    exported.length === 1 && exported[0].n === 205,
  );
  await click("#export-results-button");
  await click("[data-export=csv]");
  const csvFile = await downloadFile(".csv");
  check(
    "CSV download contains only the filtered record",
    readFileSync(csvFile, "utf8").includes("record 205") &&
      !readFileSync(csvFile, "utf8").includes("record 204"),
  );
  await sql(
    "SELECT category, SUM(amount) AS revenue FROM orders GROUP BY category ORDER BY revenue DESC;",
  );
  await click("#run-query");
  await until(
    '!document.querySelector("#run-query").disabled',
    "aggregate query",
  );
  await click("#view-chart");
  check(
    "Chart uses actual numeric query results",
    await evaluate(
      'document.querySelectorAll(".chart-row").length===4 && document.querySelector(".chart-value").textContent.includes("2384")',
    ),
  );
  await click("#view-table");
  await click("#explain-query");
  await until('!document.querySelector("#run-query").disabled', "query plan");
  check(
    "Execution plan is returned by SQLite",
    await evaluate(
      'document.querySelector(".data-table").textContent.includes("SCAN")',
    ),
  );
  await click("#save-query");
  await input("#saved-name", "测试收藏");
  await click("#dialog-actions button");
  await until(
    '!document.querySelector("#app-dialog").open',
    "saved query dialog closes",
  );
  await click("#open-saved");
  check(
    "Saved query is available locally",
    await evaluate(
      'document.querySelector("#dialog-body").textContent.includes("测试收藏")',
    ),
  );
  await click("#dialog-close");
  await click("#open-history");
  check(
    "Query history records successful SQL",
    await evaluate('document.querySelectorAll(".history-item").length>=5'),
  );
  await click("#dialog-close");
  const importedCsv = join(downloads, "import-check.csv");
  writeFileSync(
    importedCsv,
    '\uFEFFname,notes\r\n林晓,"one, two"\r\n陈一,"say ""hi""\nand bye"\r\n',
  );
  await setFile(importedCsv);
  await until('document.querySelector("#csv-confirm")', "CSV import preview");
  await input("#csv-table", "csv_notes");
  await click("#csv-confirm");
  await until(
    '!document.querySelector("#app-dialog").open && !document.querySelector("#run-query").disabled',
    "CSV transaction imported",
  );
  check(
    "CSV import preserves quotes, commas and multiline values",
    await evaluate(
      'document.querySelector(".data-table").textContent.includes("one, two") && document.querySelector(".data-table").textContent.includes(\'say "hi"\')',
    ),
  );
  await setFile(importedCsv);
  await until(
    'document.querySelector("#csv-confirm")',
    "duplicate CSV preview",
  );
  await input("#csv-table", "csv_notes");
  await click("#csv-confirm");
  await until(
    'document.querySelector("#csv-preview").textContent.includes("already exists")',
    "duplicate CSV rejected",
  );
  check("Duplicate-table CSV import rolls back", true);
  await click("#dialog-close");
  await runSql('SELECT * FROM "edge cases";');
  await click("#export-database-button");
  await click("#export-database");
  const dbFile = await downloadFile(".db");
  check(
    "Binary database export is a real SQLite file",
    readFileSync(dbFile).subarray(0, 16).toString() === "SQLite format 3\0",
  );
  await setFile(dbFile);
  await until(
    'document.querySelector("#replace-confirm")',
    "database replacement confirmation",
  );
  await click("#replace-confirm");
  await until(
    '!document.querySelector("#run-query").disabled',
    "database reimport",
  );
  await runSql('SELECT hex(payload), huge, note FROM "edge cases";');
  check(
    "Binary export/reimport preserves BLOB and 64-bit integer",
    await evaluate(
      'document.querySelector(".data-table").textContent.includes("00FF") && document.querySelector(".data-table").textContent.includes("9223372036854775807")',
    ),
  );
  await click("#export-database-button");
  await click("#export-dump");
  const dumpFile = await downloadFile(".sql");
  const dump = readFileSync(dumpFile, "utf8");
  check(
    "SQL dump includes views, indexes and original values",
    dump.includes("CREATE VIEW customer_totals") &&
      dump.includes("idx_orders_customer") &&
      dump.includes("X'00FF'"),
  );
  await click("#new-database");
  await until(
    'document.querySelector("#replace-confirm")',
    "new database confirmation",
  );
  await click("#replace-confirm");
  await until(
    '!document.querySelector("#run-query").disabled',
    "empty database initialized",
  );
  check(
    "New empty database is usable",
    await evaluate('document.querySelectorAll(".schema-object").length===0'),
  );
  await runSql(dump);
  await runSql("SELECT COUNT(*) AS n FROM orders;");
  check("SQL dump restores a working database", (await firstCell()) === "12");
  await runSql("SELECT hex(value) FROM nul_text;");
  check(
    "SQL dump preserves embedded NUL text",
    (await firstCell()) === "610062",
  );
  await sql(
    "WITH RECURSIVE x(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM x WHERE n<1000000000) SELECT sum(n) FROM x;",
  );
  await click("#run-query");
  await sleep(120);
  await click("#cancel-query");
  await until(
    'document.querySelector("#query-status")?.textContent.includes("已停止") && !document.querySelector("#run-query").disabled',
    "cancel and restore",
  );
  await runSql("SELECT COUNT(*) AS n FROM orders;");
  check(
    "Cancel stops expensive SQL and preserves previous data",
    (await firstCell()) === "12",
  );
  await sleep(1000);
  await page("Page.reload");
  await until(
    'document.querySelector("#query-status")?.textContent.includes("查询完成")',
    "saved database restored",
  );
  check(
    "Database and query tabs persist after reload",
    (await firstCell()) === "12" &&
      (await evaluate('document.querySelectorAll(".query-tab").length>=2')),
  );
  await click("#theme-toggle");
  check(
    "Dark theme switches",
    await evaluate('document.documentElement.classList.contains("dark")'),
  );
  await sleep(250);
  await page("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  }).then((result) =>
    writeFileSync(
      "/tmp/tablenest-final-dark.png",
      Buffer.from(result.data, "base64"),
    ),
  );
  await click("#theme-toggle");
  for (const width of [375, 768, 1024, 1440]) {
    await page("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(200);
    check(
      `${width}px viewport has no horizontal overflow`,
      await evaluate("document.documentElement.scrollWidth<=innerWidth"),
    );
    if (width === 375) {
      await click("#sidebar-open");
      check(
        "Mobile navigation opens and isolates workspace",
        await evaluate(
          'document.querySelector(".sidebar").classList.contains("open") && document.querySelector("#workspace").inert',
        ),
      );
      await click("#sidebar-close");
      check(
        "Mobile navigation closes and restores workspace",
        await evaluate('!document.querySelector("#workspace").inert'),
      );
    }
  }
  await sql(
    "SELECT o.id AS 订单号, c.name AS 客户, o.product AS 商品, o.amount AS 金额, o.status AS 状态 FROM orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.id;",
  );
  await click("#run-query");
  await until(
    '!document.querySelector("#run-query").disabled',
    "final demo result",
  );
  await page("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  }).then((result) =>
    writeFileSync(
      "/tmp/tablenest-final-desktop.png",
      Buffer.from(result.data, "base64"),
    ),
  );
  await page("Emulation.setDeviceMetricsOverride", {
    width: 375,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  }).then((result) =>
    writeFileSync(
      "/tmp/tablenest-final-mobile.png",
      Buffer.from(result.data, "base64"),
    ),
  );
  await evaluate(
    "navigator.serviceWorker.ready.then(() => new Promise(resolve => setTimeout(resolve, 1500)))",
  );
  check(
    "Analytics strips navigation parameters and excludes SQL, filenames and results",
    analytics.length > 0 &&
      analytics.every((url) => {
        const parameters = new URL(url).searchParams;
        return (
          parameters.get("dl") === "https://tablenest.137101.xyz/" &&
          parameters.get("dt") === "表间 TableNest" &&
          ![
            "edge%20cases",
            "O%27Brien",
            "WITH%20RECURSIVE",
            "csv_notes",
            "9223372036854775807",
            "privacy-check",
          ].some((value) => url.includes(value))
        );
      }),
  );
  intentionalOffline = true;
  await page("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await page("Page.reload");
  await until(
    'document.querySelector("#query-status")?.textContent.includes("查询完成")',
    "offline cached workspace",
  );
  await runSql("SELECT 314 AS offline;");
  check(
    "Cached workspace executes SQLite completely offline",
    (await firstCell()) === "314",
  );
  await page("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  check(
    "No browser runtime, network-resource or CSP errors",
    errors.length === 0,
  );
  console.log(
    JSON.stringify(
      {
        passed,
        errors,
        analyticsRequests: analytics.length,
        analyticsResponses,
        expectedOfflineFailures,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(JSON.stringify({ passed, errors }, null, 2));
  throw error;
} finally {
  ws?.close();
  browser.kill("SIGTERM");
  await sleep(200);
  rmSync(profile, { recursive: true, force: true });
}
