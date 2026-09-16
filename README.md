<div align="center">
  <img src="assets/logo-128.png" width="96" height="96" alt="文章摆渡 Logo">
  <h1>文章摆渡</h1>
  <p>把掘金文章可靠地送到 CSDN 草稿箱。</p>

  [![CI](https://github.com/Xxcool/juejin-csdn-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/Xxcool/juejin-csdn-extension/actions/workflows/ci.yml)
  [![Release](https://img.shields.io/github/v/release/Xxcool/juejin-csdn-extension?display_name=tag)](https://github.com/Xxcool/juejin-csdn-extension/releases)
  [![License](https://img.shields.io/github/license/Xxcool/juejin-csdn-extension)](LICENSE)
</div>

## 项目简介

文章摆渡是一个 Chrome Manifest V3 扩展。它以掘金为写作入口，在用户明确选择后，将新文章或本人历史文章同步保存到 CSDN 草稿箱。

插件不会替用户公开发布 CSDN 文章。标题、分类、标签、封面和最终发布内容仍由作者在 CSDN 中确认。

> 当前处于早期版本，依赖掘金和 CSDN 现有页面结构及 Web 接口。平台更新可能导致部分功能暂时失效。

## 功能

- 发布联动：在掘金点击“确定并发布”时，可选择立即生成一份 CSDN 草稿，不依赖掘金审核结果。
- 历史文章同步：在本人文章列表中，将已发布文章一键同步到 CSDN。
- 内容迁移：同步标题、Markdown 正文、代码块和正文图片；历史文章同时迁移可读取的标签与封面。
- 草稿更新：同一篇掘金文章再次同步时，更新对应的 CSDN 草稿。
- 同步记录：查看同步结果、失败原因和处理进度，支持重新同步并打开 CSDN 草稿。
- 登录续接：未登录 CSDN 时引导完成登录，返回掘金后继续历史文章同步。
- 同步偏好：可设置掘金发布面板中的 CSDN 同步选项是否默认勾选。
- 同步策略：可配置默认分类、标签分类映射、封面同步、图片失败处理以及草稿更新确认。
- 历史管理：可按状态筛选、删除单条本地记录并批量重试失败任务。
- 草稿模式：只写入 CSDN 草稿箱，不自动公开发布文章。

## 可靠性设计

- 正文和封面图片会转存到 CSDN 图片存储，降低外链失效和防盗链影响。
- 图片转存采用有限并发和失败重试；个别正文图片失败时保留原链接，避免整篇文章丢失。
- 浏览器或扩展后台重启后，会恢复尚未完成的同步任务。
- 同步任务、CSDN 草稿映射和失败信息只保存在当前浏览器中。
- 同步历史会区分登录、网络、限流、平台接口变化等失败类型，并显示图片转存统计和处理耗时。

## 安装

### 从 GitHub Release 安装

1. 前往 [Releases](https://github.com/Xxcool/juejin-csdn-extension/releases) 下载最新的 `article-ferry-v*.zip`。
2. 解压 ZIP。
3. 在 Chrome 打开 `chrome://extensions`。
4. 开启右上角“开发者模式”。
5. 点击“加载已解压的扩展程序”，选择解压后的目录。
6. 在同一个 Chrome 中登录掘金和 CSDN。

GitHub 安装版不会自动更新。升级时需要下载新版本并重新加载。

### 从源码构建

需要 Node.js 20 或更高版本：

```bash
npm install
npm run check
npm run build
```

随后在 `chrome://extensions` 中加载生成的 `dist` 目录。

生成 Release ZIP：

```bash
npm run release:zip
```

安装包会输出到 `release/`。

## 使用方法

### 同步新文章

1. 在掘金新建并完成文章。
2. 打开发布面板并勾选 CSDN 同步选项。
3. 正常发布掘金文章。
4. 点击“确定并发布”后，掘金提交和 CSDN 草稿同步分别执行，互不等待。
5. 在插件同步历史中打开草稿并完成最终检查。

### 同步历史文章

1. 进入自己的掘金文章列表。
2. 打开目标文章的“更多”菜单。
3. 点击“同步到 CSDN”。
4. 如果尚未登录 CSDN，先完成登录并返回掘金。
5. 从插件同步历史中打开生成的 CSDN 草稿。

## 权限说明

| 权限或站点 | 用途 |
| --- | --- |
| `storage` | 在当前浏览器保存设置、任务状态和同步历史 |
| `declarativeNetRequestWithHostAccess` | 仅为指定的掘金/CSDN 接口设置其 Web 客户端要求的请求头 |
| `juejin.cn` / `api.juejin.cn` | 注入同步入口并读取用户主动同步的文章 |
| 掘金图片 CDN | 下载正文及封面图片以便转存 |
| `bizapi.csdn.net` | 检查登录状态、获取上传凭证和保存草稿 |
| CSDN 图片存储 | 上传同步文章中的图片 |

扩展不申请 `cookies` 权限，也不读取、导出或保存 Cookie。详情请阅读 [隐私说明](PRIVACY.md) 和 [安全政策](SECURITY.md)。

## 技术实现

```text
掘金页面集成
    ↓ 读取标题、Markdown 和文章 ID
后台任务协调器
    ↓ 登录检查、任务状态和失败重试
内容适配层
    ↓ 清理元数据、解析 GFM、转存图片
CSDN Web 适配器
    ↓ 保存草稿并返回草稿地址
```

掘金编辑器数据通过一个运行在 MAIN world 的窄桥接脚本读取；同步任务由 Manifest V3 Service Worker 管理。CSDN 适配器使用其网页编辑器当前采用的签名协议，不是稳定的官方开放 API。



## 已知限制

- 仅支持“掘金 → CSDN”。
- CSDN 接口、签名方式或编辑器字段变化后需要更新适配器。
- CSDN 分类按用户设置的名称写入；平台改名或删除分类后需要同步调整映射。
- GitHub 安装版需要手动更新。

## 参与贡献

欢迎提交 Issue 和 Pull Request。开始开发前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题请通过 [SECURITY.md](SECURITY.md) 中的方式报告。

## License

[MIT](LICENSE) © Xxcool。第三方依赖信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
