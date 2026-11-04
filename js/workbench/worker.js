/* SQLite runs in a dedicated worker; database bytes never leave the browser. */
importScripts("../sqlite/sqlite3.js");
let sqlite3, database, SQLite, identifier, demoSql;
const ready = Promise.all([
  sqlite3InitModule({
    print: () => {},
    printErr: () => {},
    locateFile: (file) => new URL("../sqlite/" + file, self.location.href).href,
  }),
  import("../sqlite/db.js"),
  import("./data.js"),
]).then(([api, wrapper, data]) => {
  sqlite3 = api;
  SQLite = wrapper.SQLite;
  identifier = data.identifier;
  demoSql = data.demoSql;
});
const native = () => database.db;
function schema() {
  const rows = [];
  native().exec({
    sql: `SELECT name,type,sql FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type,name`,
    rowMode: "object",
    resultRows: rows,
  });
  return rows.map((row) => {
    const columns = [];
    native().exec({
      sql: `PRAGMA table_info(${identifier(row.name)})`,
      rowMode: "object",
      resultRows: columns,
    });
    return { ...row, columns };
  });
}
function bytes() {
  return sqlite3.capi.sqlite3_js_db_export(native().pointer);
}
function state() {
  return {
    schema: schema(),
    bytes: bytes(),
    version: sqlite3.capi.sqlite3_libversion(),
  };
}
function create(input) {
  const db = new sqlite3.oo1.DB(":memory:", "c");
  const candidate = new SQLite(
    input.name || "workspace.db",
    { type: "memory" },
    sqlite3.capi,
    db,
  );
  try {
    if (input.bytes) {
      const data = new Uint8Array(input.bytes);
      if (
        new TextDecoder().decode(data.subarray(0, 16)) !== "SQLite format 3\0"
      )
        throw Error("不是有效的 SQLite 数据库文件。");
      // Make an isolated copy before adjusting the WAL read/write flags.
      const copy = data.slice();
      copy[18] = 1;
      copy[19] = 1;
      const pointer = sqlite3.wasm.allocFromTypedArray(copy);
      const rc = sqlite3.capi.sqlite3_deserialize(
        db.pointer,
        "main",
        pointer,
        copy.length,
        copy.length,
        sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
          sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
      );
      if (rc) {
        sqlite3.wasm.dealloc(pointer);
        throw Error("数据库文件无法载入（" + rc + "）。");
      }
    } else if (input.demo) db.exec(demoSql);
    else db.exec("PRAGMA user_version=0");
    db.exec("PRAGMA schema_version");
    const old = database;
    database = candidate;
    try {
      const snapshot = state();
      old?.db.close();
      return snapshot;
    } catch (error) {
      database = old;
      throw error;
    }
  } catch (error) {
    db.close();
    throw error;
  }
}
function run(sql) {
  if (!sql.trim()) throw Error("先写一条 SQL，再点击运行。");
  const started = performance.now(),
    deadline = Date.now() + 10000;
  let columns = [],
    values = [],
    totalRows = 0;
  sqlite3.capi.sqlite3_progress_handler(
    native().pointer,
    10000,
    () => (Date.now() > deadline ? 1 : 0),
    0,
  );
  try {
    // SQLite's OO exec callback only visits the first result set. Let SQLite
    // identify each statement (including complete triggers), then execute it
    // before preparing the next so schema changes remain visible.
    const allocation = sqlite3.wasm.scopedAllocPush();
    try {
      const wasm = sqlite3.wasm;
      let cursor = wasm.scopedAllocCString(sql);
      const end = cursor + wasm.jstrlen(sql);
      const statementPointer = wasm.scopedAlloc(wasm.ptr.size);
      const tailPointer = wasm.scopedAlloc(wasm.ptr.size);
      while (cursor < end) {
        wasm.pokePtr([statementPointer, tailPointer], 0);
        const rc = sqlite3.capi.sqlite3_prepare_v3(
          native().pointer,
          cursor,
          end - cursor,
          0,
          statementPointer,
          tailPointer,
        );
        const prepared = wasm.peekPtr(statementPointer);
        if (rc) {
          if (prepared) sqlite3.capi.sqlite3_finalize(prepared);
          throw Error(sqlite3.capi.sqlite3_errmsg(native().pointer));
        }
        const next = wasm.peekPtr(tailPointer);
        if (!next || next <= cursor) break;
        cursor = next;
        if (!prepared) continue;
        const current = sqlite3.capi.sqlite3_sql(prepared);
        const hasColumns = sqlite3.capi.sqlite3_column_count(prepared) > 0;
        sqlite3.capi.sqlite3_finalize(prepared);
        if (hasColumns) {
          columns = [];
          values = [];
          totalRows = 0;
        }
        native().exec({
          sql: current,
          rowMode: "array",
          columnNames: hasColumns ? columns : undefined,
          callback: (row) => {
            totalRows++;
            if (values.length < 5000) values.push(row);
          },
        });
      }
    } finally {
      sqlite3.wasm.scopedAllocPop(allocation);
    }
    return {
      columns,
      values,
      totalRows,
      truncated: totalRows > values.length,
      elapsed: Math.round((performance.now() - started) * 100) / 100,
      changes: sqlite3.capi.sqlite3_changes(native().pointer),
      ...state(),
    };
  } finally {
    sqlite3.capi.sqlite3_progress_handler(native().pointer, 0, null, 0);
  }
}
function csv(input) {
  if (!input.table.trim() || input.table.length > 64)
    throw Error("请填写 1–64 个字符的表名。");
  if (!input.columns.length || !input.values.length)
    throw Error("CSV 没有可导入的数据。");
  native().exec("BEGIN");
  try {
    native().exec(
      `CREATE TABLE ${identifier(input.table)} (${input.columns.map((c) => identifier(c) + " TEXT").join(",")})`,
    );
    const stmt = native().prepare(
      `INSERT INTO ${identifier(input.table)} VALUES (${input.columns.map(() => "?").join(",")})`,
    );
    try {
      for (const row of input.values) {
        stmt.bind(row);
        stmt.step();
        stmt.reset();
      }
    } finally {
      stmt.finalize();
    }
    native().exec("COMMIT");
    return state();
  } catch (error) {
    native().exec("ROLLBACK");
    throw error;
  }
}
function dump() {
  const tables = schema().filter((t) => t.type === "table");
  if (tables.some((t) => /^CREATE\s+VIRTUAL\s+TABLE/i.test(t.sql || "")))
    throw Error("包含虚拟表，请使用数据库文件导出以完整保留内容。");
  const statements = ["PRAGMA foreign_keys=OFF;", "BEGIN TRANSACTION;"];
  for (const table of tables) statements.push(table.sql + ";");
  for (const table of tables) {
    const visible = table.columns.filter((c) => !c.hidden).map((c) => c.name);
    const values = visible
      .map((c) => {
        const column = identifier(c);
        return `CASE WHEN typeof(${column})='text' AND instr(${column},char(0))>0 THEN 'CAST(X'''||hex(${column})||''' AS TEXT)' ELSE quote(${column}) END`;
      })
      .join(`||','||`);
    native().exec({
      sql: `SELECT ${values} AS literals FROM ${identifier(table.name)}`,
      rowMode: "object",
      callback: (row) =>
        statements.push(
          `INSERT INTO ${identifier(table.name)} (${visible.map(identifier).join(",")}) VALUES (${row.literals});`,
        ),
    });
  }
  const sequence = [];
  native().exec({
    sql: "SELECT name FROM sqlite_schema WHERE name='sqlite_sequence'",
    rowMode: "array",
    resultRows: sequence,
  });
  if (sequence.length) {
    statements.push("DELETE FROM sqlite_sequence;");
    native().exec({
      sql: "SELECT name,seq FROM sqlite_sequence",
      rowMode: "array",
      callback: (row) =>
        statements.push(
          `INSERT INTO sqlite_sequence VALUES ('${row[0].replaceAll("'", "''")}',${row[1]});`,
        ),
    });
  }
  native().exec({
    sql: "SELECT sql FROM sqlite_schema WHERE type IN ('view','index','trigger') AND sql IS NOT NULL ORDER BY CASE type WHEN 'view' THEN 0 WHEN 'index' THEN 1 ELSE 2 END",
    rowMode: "array",
    callback: (row) => statements.push(row[0] + ";"),
  });
  statements.push("COMMIT;", "PRAGMA foreign_keys=ON;");
  return statements.join("\n");
}
self.onmessage = async (event) => {
  const { id, type, payload = {} } = event.data;
  try {
    await ready;
    let result;
    if (type === "init") result = create(payload);
    else if (type === "run") result = run(payload.sql);
    else if (type === "csv") result = csv(payload);
    else if (type === "dump") result = { sql: dump() };
    else if (type === "export") result = { bytes: bytes() };
    else throw Error("未知工作台操作。");
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: String(error.message || error).replace(/^SQLITE_ERROR:\s*/, ""),
    });
  }
};
