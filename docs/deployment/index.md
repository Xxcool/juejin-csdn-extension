# 网站部署与上线方案完全指南 (Deployment)

本文档提供本 VitePress 官方网站的多种生产部署方案。所有方案均基于纯静态资源生成，零后端运维成本。

## 方案一：GitHub Pages 自动化 CI/CD（推荐）

GitHub Pages 是开源项目最理想的免费托管平台。本项目已配置自动化 GitHub Actions 工作流，代码推送到 `master` 分支后自动触发构建并部署。

### 1. 开启 GitHub Pages 权限
1. 打开您的 GitHub 仓库页面：`https://github.com/Xxcool/juejin-csdn-extension`；
2. 点击顶部 **Settings（仓库设置）**；
3. 在左侧菜单栏选择 **Pages**；
4. 在 **Build and deployment** 下方的 **Source** 下拉菜单中，将默认的 Deploy from a branch 改为：
   ```text
   GitHub Actions
   ```
5. 保存即可，无需手动创建 `gh-pages` 分支。

### 2. CI/CD 工作流配置解析
项目根目录已包含 `.github/workflows/deploy-docs.yml`：

```yaml
name: Deploy Docs to GitHub Pages

on:
  push:
    branches: [master]
    paths:
      - 'docs/**'
      - '.github/workflows/deploy-docs.yml'
      - 'package.json'

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: 'pages'
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build with VitePress
        env:
          VITEPRESS_BASE: /juejin-csdn-extension/
        run: npm run docs:build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: docs/.vitepress/dist

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

> **Base 路径自动兼容**：  
> 若您在 GitHub Pages 绑定了独立自定义域名（如 `ferry.yourdomain.com`），只需在 GitHub Secrets 或 Actions 环境变量中将 `VITEPRESS_BASE` 设为 `/` 即可。

## 方案二：Vercel 一键零配置部署（推荐）

Vercel 提供全球边缘 Anycast CDN 加速与秒级构建，支持自动化拉取 GitHub 仓库并在每次提交或提 PR 时自动部署。

由于项目根目录已预设工业级 [`vercel.json`](file:///Users/xiabin/Documents/juejin-csdn-extension/vercel.json) 规范，部署过程为 **100% 零配置开箱即用**：

### 极速接入步骤

1. 登录您的 [Vercel 控制台 (xxcools-projects)](https://vercel.com/xxcools-projects)；
2. 点击右上角 **「Add New...」➔「Project」**；
3. 在 GitHub 列表中找到 **`juejin-csdn-extension`** 并点击 **Import**；
4. **无需修改任何配置**（`vercel.json` 会自动声明 VitePress 框架、构建脚本 `npm run docs:build` 与输出目录 `docs/.vitepress/dist`）；
5. 点击 **Deploy**，约 25 秒即可完成全量构建，并获得专属生产域名（如 `https://juejin-csdn-extension.vercel.app`）。

```json
/* 项目已内置 vercel.json 零配置契约 */
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vitepress",
  "buildCommand": "npm run docs:build",
  "outputDirectory": "docs/.vitepress/dist",
  "cleanUrls": true
}
```

> **Base 路径自适应**：  
> 当在 Vercel 部署时，`base` 自动为 `/`（根路径域名），所有文章路由与资源直达加载，离线安装包（`/downloads/article-ferry-latest.zip`）直接可用。

## 方案三：Cloudflare Pages 部署

Cloudflare Pages 拥有顶级的全球 CDN 网络与无限制免费带宽：

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) ➔ **Workers & Pages** ➔ **Create application** ➔ **Pages**；
2. 关联您的 GitHub 仓库；
3. 构建配置设置：
   - **Framework preset**：`VitePress`
   - **Build command**：`npm run docs:build`
   - **Build output directory**：`docs/.vitepress/dist`
   - **Root directory**：`/`
4. 环境变量（Environment Variables）：
   - `NODE_VERSION`: `22`
   - `VITEPRESS_BASE`: `/`
5. 点击 **Save and Deploy** 即可完成上线。

## 方案四：本地运行与离线静态预览

在本地开发调试或内网离线预览时：

::: code-group

```bash [本地开发热更新]
# 启动本地热重载调试服务器 (默认端口 http://localhost:5173)
npm run docs:dev
```

```bash [生产产物构建]
# 生成高压缩率的纯静态 HTML/CSS/JS (输出至 docs/.vitepress/dist)
npm run docs:build
```

```bash [本地预览生产产物]
# 启动本地 HTTP 静态服务器模拟真实生产环境
npm run docs:preview
```

:::

## 方案五：Nginx / Docker 私有化容器部署


如果需要在企业内部服务器或个人 VPS 部署：

### 1. Nginx 配置示例
```nginx
server {
    listen 80;
    server_name docs.yourdomain.com;
    root /var/www/juejin-csdn-extension/docs/.vitepress/dist;
    index index.html;

    # 启用 gzip 压缩
    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    location / {
        try_files $uri $uri/ $uri.html =404;
    }

    # 静态资源长期缓存
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }
}
```

### 2. Dockerfile 示例
```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run docs:build

FROM nginx:alpine
COPY --from=builder /app/docs/.vitepress/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```
