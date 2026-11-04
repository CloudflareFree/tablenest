import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
const output = "dist";
const origin = "https://tablenest.137101.xyz";
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const files = [
  "index.html",
  "css/workbench",
  "js/workbench",
  "js/sqlite/db.js",
  "js/sqlite/sqlite3.js",
  "js/sqlite/sqlite3.wasm",
  "fonts",
  "vendor",
  "img/mark.svg",
  "img/cover.png",
  "LICENSE",
  "_headers",
  "robots.txt",
  "sw.js",
];
for (const file of files) {
  await mkdir(dirname(`${output}/${file}`), { recursive: true });
  await cp(file, `${output}/${file}`, { recursive: true });
}
const page = (title, description, body, path) =>
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — 表间 TableNest</title><meta name="description" content="${description}"><meta name="robots" content="index, follow"><link rel="canonical" href="${origin}/${path}"><link rel="icon" href="/img/mark.svg"><link rel="stylesheet" href="/css/workbench/app.css?v=1"><style>.guide{max-width:850px;margin:50px auto;padding:35px;background:var(--panel);border:1px solid var(--line);border-radius:12px;font-size:15px;line-height:1.9}.guide h1{font-size:32px;margin:24px 0}.guide h2{font-size:21px;margin:25px 0 10px}.guide p{margin:14px 0}.guide code{font-family:JetBrains,monospace;color:var(--accent)}.guide a{color:var(--accent)}@media(max-width:600px){.guide{margin:15px;padding:22px;font-size:15px}}</style><main class="guide"><a href="/">← 返回表间工作台</a><h1>${title}</h1><p>${description}</p>${body}<p><a href="/">开始查询</a> · <a href="/guide">使用指南</a> · <a href="/privacy">隐私与本地存储</a></p></main></html>`;
await writeFile(
  `${output}/guide.html`,
  page(
    "从一张表，开始探索数据",
    "中文 SQLite 工作台使用指南：导入文件、编写查询、浏览结构、查看执行计划和导出结果。",
    `<h2>打开即用的 SQLite</h2><p>首次打开会载入本地零售示例库，包含 customers、orders 和 customer_totals 视图。点击“订单明细”“分类营收”等示例，再点击运行查询。所有 SQLite 运算在独立 Web Worker 中完成。</p><h2>打开你的数据库</h2><p>“打开文件”支持 .db、.sqlite、.sqlite3、.sql 和 .csv。数据库文件最大 50 MB；SQL 脚本会先打开为查询标签，由你决定何时执行。导入正在被其他程序写入的数据库前，请在原程序关闭数据库或执行 WAL checkpoint，确保文件包含完整数据。</p><h2>CSV 变成可查询的表</h2><p>支持逗号、分号及 Tab 分隔。首行为表头，导入前可预览；双引号、引号转义、换行与 UTF-8 BOM 均可识别。每次最多 100,000 行、10 MB，所有列以 TEXT 类型导入；可在 SQL 中通过 CAST 进行数字运算。已有同名表会拒绝导入，避免覆盖。</p><h2>把问题写成 SQL</h2><p>支持多查询标签、标签重命名、语法高亮、Tab 缩进、SQL 格式化和选中片段执行。<code>Ctrl/⌘ + Enter</code> 运行，<code>Ctrl/⌘ + S</code> 下载 SQL，<code>Ctrl/⌘ + Shift + F</code> 格式化。执行计划通过 SQLite 的 EXPLAIN QUERY PLAN 展示。</p><h2>结果、图表与导出</h2><p>查询结果可按列排序、筛选和分页。图表使用第一个数字列，并取另一个字段作标签，最多展示前 50 条筛选结果；柱长表示绝对值。CSV、JSON 和 INSERT SQL 导出的是当前筛选后的预览记录。NULL 与 BLOB 分别显示，JSON 中 BLOB 用十六进制对象、64 位整数用字符串保留。</p><h2>运行限制与停止</h2><p>长查询在约 10 秒后中断；运行中可停止，恢复到上次成功操作的数据库状态。结果最多预览 5,000 行，可用 SQL 的 WHERE、LIMIT 和聚合缩小结果。多条语句运行时显示最后一个查询结果集（包括空结果）；脚本中的先前已提交语句遵循 SQLite 的事务规则。</p><h2>保存与备份</h2><p>数据库自动存入 IndexedDB，查询标签、最近 100 条查询和收藏保存于本机浏览器。自动保存不能替代备份；导出 .db 文件可完整保留数据库。SQL 导出覆盖常规表、索引、视图和触发器；含虚拟表的数据库请使用 .db 导出。清理站点数据、无痕窗口关闭或浏览器空间回收都可能删除本地记录。</p>`,
    "guide",
  ),
);
await writeFile(
  `${output}/privacy.html`,
  page(
    "数据留在手边，隐私说清楚",
    "表间的数据处理、本地存储与访问统计说明。",
    `<h2>数据库、查询与结果</h2><p>SQLite 数据库文件、SQL、CSV 和查询结果由浏览器处理，不上传应用服务器。表间没有应用后端，也不连接远程数据库。导入内容不会成为网址的一部分。</p><h2>本机存储</h2><p>当前数据库保存在 IndexedDB；SQL 标签、查询历史和收藏使用 localStorage。任何能使用同一浏览器配置的人可能看到这些内容。使用共享电脑时，请在完成工作后通过浏览器设置清除本站存储；保留重要数据的导出备份。</p><h2>访问统计</h2><p>本站使用 Google Analytics 4 统计页面访问。页面浏览事件仅使用固定的站点网址和产品标题，不发送数据库文件名、SQL 文本、导入内容或结果。Google 等统计服务可能处理 IP、设备及基本访问元数据。数据库运算不依赖统计服务。</p><h2>离线与第三方组件</h2><p>首次加载需要获取本站的 SQLite WebAssembly 和界面资源。浏览器支持时会缓存工作台核心资源，以便后续离线打开。SQLite 引擎、格式化器和字体均从本站提供。</p><h2>软件许可</h2><p>第三方软件版权及使用许可保留于 <a href="/LICENSE">软件许可证</a>、<a href="/vendor/sql-formatter.LICENSE">格式化器许可</a>及字体许可文件。产品名称及界面为表间 TableNest。</p>`,
    "privacy",
  ),
);
await writeFile(
  `${output}/sitemap.xml`,
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["", "guide", "privacy"].map((path) => `<url><loc>${origin}/${path}</loc></url>`).join("")}</urlset>\n`,
);
await writeFile(
  `${output}/404.html`,
  '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>页面不存在 — 表间</title><main style="font-family:system-ui;padding:10%"><h1>这里没有这张表</h1><p>页面可能已移动。</p><a href="/">返回表间工作台</a></main></html>',
);
const html = await readFile("index.html", "utf8");
if (html.includes("GA_MEASUREMENT_ID"))
  throw Error("Configure the site measurement ID before publishing.");
console.log(
  "TableNest static build complete: browser SQLite engine, 3 canonical pages, sitemap and real 404.",
);
