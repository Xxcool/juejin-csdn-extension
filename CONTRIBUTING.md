# 参与贡献

新增目标平台时，请实现独立适配器并保持“登录检测、内容转换、图片处理、草稿写入、结果链接”职责边界。不要提交账号凭据、Cookie、平台私有数据或直接复制第三方扩展源码。

提交前请确保本地全量通过：

```bash
npm run check          # TypeScript 类型检查
npm test               # 全量自动化单元测试
npm run build:release  # 生产环境产物打包
```

发布版本前还需要运行 `npm run release:zip`，确认生成的 ZIP 根目录直接包含 `manifest.json`。新增站点权限或请求头规则时，请在 PR 中说明最小权限范围及其必要性。

Bug 报告请包含浏览器版本、失效页面、复现步骤和经过脱敏的错误信息。

---

### 🤖 AI 辅助与结对编程规范 (AI-Assisted Pair Programming)

本项目倡导现代化的 AI-Native 协作实践，鼓励借助 Claude、Cursor 等 AI 编码工具提升开发效率、优化架构与完善单测：

1. **联合署名倡议**：若提交的 PR 包含实质性 AI 辅助重构或代码生成，推荐在 Commit Message 结尾添加标准的 Git Trailer 署名（如 `Co-authored-by: Claude <noreply@anthropic.com>`），以保持开源研发历史的透明与可追溯；
2. **端侧安全底线**：无论是否使用 AI 生成代码，均须严守“零 Cookie 收集、零服务端中转、零敏感数据上报”的端侧隐私底线；
3. **工程质量把关**：所有 AI 参与产出的代码必须通过本地完整的静态类型检查与全量自动化测试（`npm run check && npm test`）。

