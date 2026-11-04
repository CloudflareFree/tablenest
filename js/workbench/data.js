// Data conversion stays in the browser. Never evaluate imported values as SQL.
export const identifier = (value) =>
  '"' + String(value).replaceAll('"', '""') + '"';
export const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function parseCsv(text, delimiter = ",") {
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    cell = "",
    quoted = false,
    endedQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          endedQuote = true;
        }
      } else cell += c;
    } else if (c === '"' && cell === "" && !endedQuote) quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
      endedQuote = false;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      endedQuote = false;
    } else {
      if (endedQuote && c.trim())
        throw new Error("CSV 引号后存在无效字符，请检查分隔符。");
      if (!endedQuote) cell += c;
    }
  }
  if (quoted) throw new Error("CSV 中有未闭合的双引号。");
  if (cell !== "" || row.length || endedQuote) {
    row.push(cell);
    rows.push(row);
  }
  if (rows.length < 2) throw new Error("CSV 至少需要一行表头和一行数据。");
  const columns = rows
    .shift()
    .map((value, index) => value.trim() || `column_${index + 1}`);
  if (new Set(columns.map((c) => c.toLowerCase())).size !== columns.length)
    throw new Error("CSV 表头不能重复。");
  for (const [index, values] of rows.entries())
    if (values.length !== columns.length)
      throw new Error(
        `CSV 第 ${index + 2} 行有 ${values.length} 列，表头为 ${columns.length} 列。`,
      );
  return { columns, values: rows };
}
export function displayValue(value) {
  if (value === null) return "NULL";
  if (value instanceof Uint8Array) return `BLOB (${value.byteLength} bytes)`;
  return String(value);
}
export function resultObjects(result) {
  const used = new Set();
  const names = result.columns.map((name, index) => {
    let unique = name;
    let suffix = index + 1;
    while (used.has(unique)) unique = `${name}_${suffix++}`;
    used.add(unique);
    return unique;
  });
  return result.values.map((row) =>
    Object.fromEntries(
      names.map((name, index) => [
        name,
        row[index] instanceof Uint8Array
          ? {
              type: "blob",
              hex: Array.from(row[index], (v) =>
                v.toString(16).padStart(2, "0"),
              ).join(""),
            }
          : typeof row[index] === "bigint"
            ? String(row[index])
            : row[index],
      ]),
    ),
  );
}
export function toCsv(result) {
  const cell = (value) => {
    const text = value === null ? "" : displayValue(value);
    return /[",\r\n]/.test(text)
      ? '"' + text.replaceAll('"', '""') + '"'
      : text;
  };
  return (
    "\uFEFF" +
    [result.columns, ...result.values]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
export function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Uint8Array)
    return (
      "X'" +
      Array.from(value, (v) => v.toString(16).padStart(2, "0")).join("") +
      "'"
    );
  if (typeof value === "bigint") return String(value);
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "NULL";
  return String(value)
    .split("\0")
    .map((part) => "'" + part.replaceAll("'", "''") + "'")
    .join("||char(0)||");
}
export const demoSql = `CREATE TABLE customers (\n  id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT, email TEXT\n);\nCREATE TABLE orders (\n  id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id),\n  product TEXT, category TEXT, amount REAL, status TEXT, created_at TEXT\n);\nINSERT INTO customers VALUES\n(1,'林晓','杭州','lin@example.com'),(2,'陈一','上海','chen@example.com'),\n(3,'周可','成都','zhou@example.com'),(4,'许安','深圳','xu@example.com'),\n(5,'苏禾','北京','su@example.com'),(6,'江宁','南京','jiang@example.com');\nINSERT INTO orders VALUES\n(1001,1,'机械键盘','数码',399,'已完成','2026-10-01'),\n(1002,2,'无线耳机','数码',699,'已完成','2026-10-02'),\n(1003,1,'咖啡豆','生活',128,'已完成','2026-10-03'),\n(1004,3,'桌面灯','家居',259,'配送中','2026-10-04'),\n(1005,4,'显示器支架','数码',329,'已完成','2026-10-05'),\n(1006,5,'笔记本','文具',49,'已完成','2026-10-06'),\n(1007,2,'咖啡杯','生活',89,'配送中','2026-10-07'),\n(1008,6,'蓝牙音箱','数码',459,'已完成','2026-10-08'),\n(1009,3,'文件收纳','文具',79,'已完成','2026-10-09'),\n(1010,4,'无线鼠标','数码',199,'已完成','2026-10-10'),\n(1011,5,'绿植','家居',59,'配送中','2026-10-11'),\n(1012,6,'扩展坞','数码',299,'已完成','2026-10-12');\nCREATE INDEX idx_orders_customer ON orders(customer_id);\nCREATE VIEW customer_totals AS\nSELECT c.name, c.city, COUNT(o.id) AS orders, SUM(o.amount) AS total\nFROM customers c LEFT JOIN orders o ON o.customer_id=c.id GROUP BY c.id;`;
export const examples = [
  {
    title: "订单明细",
    sql: `-- 从一个问题开始，发现数据里的答案。\nSELECT\n  o.id AS 订单号,\n  c.name AS 客户,\n  o.product AS 商品,\n  o.category AS 分类,\n  o.amount AS 金额,\n  o.status AS 状态\nFROM orders AS o\nJOIN customers AS c ON c.id = o.customer_id\nORDER BY o.id;`,
  },
  {
    title: "分类营收",
    sql: `SELECT category AS 分类, SUM(amount) AS 营收\nFROM orders\nGROUP BY category\nORDER BY 营收 DESC;`,
  },
  {
    title: "客户分析",
    sql: `SELECT name AS 客户, city AS 城市, orders AS 订单数, total AS 总金额\nFROM customer_totals\nORDER BY total DESC;`,
  },
  {
    title: "窗口函数",
    sql: `SELECT product AS 商品, amount AS 金额,\n  DENSE_RANK() OVER (ORDER BY amount DESC) AS 排名,\n  SUM(amount) OVER (ORDER BY id) AS 累计金额\nFROM orders;`,
  },
];
