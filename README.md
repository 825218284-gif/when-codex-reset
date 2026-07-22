# Codex 额度重置雷达

面向 ChatGPT Plus 用户的公开信息仪表盘，集中展示：

- 最近四次已确认额度重置时间；
- 未来 48 小时重置可能性；
- 公开额度表格和 7 天变化曲线；
- 各模型的 IQ、价格与性价比趋势。

## 数据来源

- 重置时间：[Codex Resets](https://codex-resets.com/)
- 48 小时概率：[Codex Reset Radar](https://codexresetradar.com/)
- 额度和模型趋势：[Codex Radar](https://codexradar.com/)

这些数据是公开观察与汇总，不代表个人账户的实际余额，也不保证未来一定发生重置。

## GitHub Pages

`.github/workflows/pages.yml` 会在以下情况重新抓取数据并发布：

- `main` 分支收到更新；
- 每小时第 17 分钟；
- 在 GitHub Actions 页面手动运行。

GitHub Pages 读取 `public/data/briefing.json` 静态快照，因此刷新按钮会读取最近一次自动发布的数据。

## 本地使用

要求 Node.js 22.13 或更新版本。

```bash
npm install
npm run data:refresh
npm run build:pages
npm run preview:pages
```

原有服务端版本仍可使用：

```bash
npm run dev
npm run build
```
