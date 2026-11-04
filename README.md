# 表间 TableNest

中文浏览器 SQLite 数据工作台。数据库、CSV、SQL 和查询结果在本机处理，无应用后端。

- 在线使用：https://tablenest.137101.xyz
- SQLite 3.54.1 WebAssembly，独立 Worker 执行，长查询可停止。
- 数据库及 SQL 文件导入、CSV 预览与事务导入、结构浏览、多标签查询、格式化、执行计划。
- 筛选、排序、分页、柱状图，导出 SQLite 文件、SQL 脚本、CSV、JSON、INSERT SQL。
- 查询历史、收藏与本机自动保存，明暗主题、响应式布局与快捷键。

使用 Node 24：`npm run build` 生成 `dist`；`npm test` 检查数据转换；`npm run verify:browser -- <URL>` 运行真实浏览器验收。完整部署、限制与备份说明见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

保留第三方软件的版权与许可，见 [LICENSE](LICENSE)、字体许可和格式化器许可。SQLite 官方运行时为本地静态文件，不从第三方 CDN 加载。
