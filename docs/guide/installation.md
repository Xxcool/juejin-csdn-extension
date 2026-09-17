# 安装与加载指南

本文档介绍如何在 Chromium 内核浏览器（Google Chrome、Microsoft Edge、Brave、Arc 等）中安装和启用「文章摆渡」扩展。

<DownloadBox />

## 方式一：直接下载 ZIP 离线安装（推荐）



这是最快捷、最适合普通创作者的安装方式，无需配置开发环境。

### 第一步：下载最新发行包
1. 前往 GitHub 发行版页面：[GitHub Releases](https://github.com/Xxcool/juejin-csdn-extension/releases)；
2. 在最新版本（如 `v0.6.0`）的 **Assets** 列表中，下载名为 `article-ferry-v*.zip` 的压缩包；
3. 将下载的 ZIP 压缩包解压到本地固定目录（例如 `~/Documents/article-ferry`，**请勿放在临时下载目录以防误删**）。

### 第二步：在浏览器中加载已解压扩展
1. 打开 Chrome 浏览器，在地址栏输入并回车：
   ```text
   chrome://extensions
   ```
   > 提示：若使用 Edge 浏览器，请输入 `edge://extensions`。

2. 在扩展页面右上角，找到并开启 **“开发者模式” (Developer mode)** 开关；
3. 开启后，页面左上方将出现新按钮，点击 **“加载已解压的扩展程序” (Load unpacked)**；
4. 在弹出的文件选择器中，选中刚才解压后的文件夹（确保选中的目录下包含 `manifest.json` 文件）；
5. 点击确认，页面列表中将立即出现 **「文章摆渡｜掘金同步到 CSDN」** 图标。

### 第三步：固定扩展图标到工具栏
1. 点击浏览器右上角的“拼图”扩展管理图标；
2. 找到「文章摆渡」，点击旁边的 **“图钉”** 图标，将其固定在浏览器地址栏右侧，方便随时查看同步状态。

## 方式二：从源码构建安装（开发者推荐）

如果您需要二次开发、调试或自行审计代码，可从源码直接构建。

### 环境要求
- **Node.js**: >= 20.0.0
- **npm**: >= 10.0.0
- **Git**

### 构建步骤

```bash
# 1. 克隆代码仓库
git clone https://github.com/Xxcool/juejin-csdn-extension.git
cd juejin-csdn-extension

# 2. 安装依赖项
npm install

# 3. 运行静态类型检查与单元测试
npm run check    # TypeScript 无错检查
npm test         # 执行 Vitest 41 项全量测试

# 4. 构建生产产物
npm run build:release
```

构建完成后，生产产物将输出在项目的 `dist/` 目录下。随后参考方式一中的步骤，在 `chrome://extensions` 中点击“加载已解压的扩展程序”，选择当前项目的 `dist/` 目录即可。

## 浏览器兼容性列表

| 浏览器 | 支持状态 | 说明 |
| :--- | :---: | :--- |
| **Google Chrome** | 🟢 完全支持 | 官方基准环境，完美支持 MV3 Service Worker、DNR 与系统通知 |
| **Microsoft Edge** | 🟢 完全支持 | Chromium 内核，体验与 Chrome 保持完全一致 |
| **Brave Browser** | 🟢 完全支持 | 内核兼容，请确保允许本地跨域声明网络请求 |
| **Arc Browser** | 🟢 完全支持 | 支持侧边栏常驻与扩展快速弹窗 |
| **Firefox / Safari** | ⚪ 暂未支持 | 计划在后续版本适配标准 WebExtension 规范 |

## 关键权限声明清单


为了保障透明度，文章摆渡在 `manifest.json` 中声明的权限如下：

| 权限声明 | 核心用途 | 安全定性 |
| :--- | :--- | :--- |
| `storage` | 本地存储用户的同步偏好设置与历史任务记录 | 仅保存在本地设备，不上传云端 |
| `notifications` | 长耗时/多图任务完成时弹出系统通知，点击直达草稿 | 仅用于完成提醒 |
| `alarms` | 定时（每 12 小时）拉取接口健康状态预警文件 | 无状态定时器 |
| `declarativeNetRequestWithHostAccess` | 为跨平台上传请求补充官方校验头部（Referer、Origin） | 严控接口规则范围，不拦截其他流量 |
| `host_permissions` | 声明对掘金、CSDN 以及官方 CDN 域的访问能力 | 仅用于正文拉取与图床上传 |

> [!NOTE]
> 本扩展**没有**申请 `cookies` 权限，也不会收集或转存您的账号凭证。所有操作均复用您在浏览器标签页中的现有登录状态。
