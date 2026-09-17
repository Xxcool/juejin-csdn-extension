# UI / UX 界面与体验深度重构实施方案

> [!NOTE]
> **【已归档 / ARCHIVED】**  
> 本文档为 v0.5.0 前端界面与体验重构的专项实施方案。相关设计、规范及评审细节已全量落地并验收通过。  
> 本项目全局战略、架构红线、功能演进与版本规划请统一查阅唯一事实来源：**[产品全景主规划 (SSOT)](/roadmap/)**。

---


## 一、 背景与重构目标

在 `v0.4.1` 及更早版本中，扩展界面呈现典型的初期工程师 MVP 特征：
1. **信息架构层级深**：弹窗首页占用大量面积展示 Hero 留白，用户查阅同步历史或草稿链接需要经过多级菜单点击；
2. **可访问性与字号硬伤**：大量使用 `9px` 和 `10px` 极小字号，在高分屏及常规显示器下阅读费力，行高和对比度不符合 Web 可访问性规范；
3. **色彩系统碎片化**：历史遗留的 `popup.css` 与 `popup-fixes.css` 相互层叠覆写，多种不一致的绿、红、蓝混合使用；
4. **缺失深色模式（Dark Mode）**：夜间写作时纯白弹窗视觉割裂且刺眼，与掘金夜间主题脱节；
5. **页面注入控件生硬**：文案“除掘金外还需同步”偏长，圆角边框与掘金原生编辑器风格存在违和感。

本次重构的目标是将产品交互升级为具备**现代生产力工具质感**的扁平化仪表盘，并全套支持自适应深色模式。

---

## 二、 核心交互与信息架构设计

### 1. 扁平化双 Tab 仪表盘
取消原有的“首页导航树”，打开扩展即见核心数据流：

* **顶部 Header**：
  * 左侧：精简品牌 Logo（24x24）与“文章摆渡”标题；
  * 右侧：**CSDN 状态胶囊（`.platform-pill`）**，直观展示当前 CSDN 登录账号及在线状态（如 `[CSDN: 用户名 ✓]` 或 `[CSDN 未登录 ↗]`），支持点击直接刷新状态或快捷跳转登录，彻底消灭原有层级深厚的“平台管理”二级页。
* **主体双 Tab 分段器（Segmented Navigation）**：
  * `[ 同步记录 (History) ]`：打开即见最近同步任务列表，包含动态任务总数徽标；
  * `[ 偏好设置 (Settings) ]`：即时切换发布联动、封面同步、草稿确认及标签分类映射。

### 2. 任务卡片与诊断交互
* **字体排版优化**：全面升级卡片元数据（最低 11px），标题 13px 加粗并支持两行截断省略；
* **一键复制诊断信息**：当任务出现异常时，诊断浮层右上角提供 `[复制诊断]` 快捷操作，点击自动将脱敏后的错误堆栈复制到剪贴板并触发 Toast；
* **友好引导式空状态**：无任务记录时展示专属空状态插图与详细使用指引，附带 `前往掘金文章管理 ↗` 快捷按钮。

### 3. 掘金页面原生拟态注入
* **文案优化**：文案优化为 `同步到 CSDN 草稿`，副标题动态展示 `已就绪，发布时保存为草稿`；
* **Semi Design 规范对齐**：调整控件高度为 36px、圆角 6px、边框颜色 `#e5e6eb`，完美融入掘金编辑器顶部操作栏；
* **掘金夜间主题适配**：监听 `html[data-theme="dark"]` 与 `body.dark`，夜间模式下自动调整为暗色背景与深色边框。

---

## 三、 设计系统与规范（Design Tokens）

通过 CSS 变量统一管理整套设计令牌，内建自适应深色模式支持：

```css
:root {
  /* 品牌色（对标掘金与现代开发者工具） */
  --brand: #1e80ff;
  --brand-hover: #1171ee;
  --brand-light: #e8f3ff;
  --brand-glow: rgba(30, 128, 255, 0.15);

  /* 功能语义色 */
  --success: #00b42a;
  --success-bg: #e8ffea;
  --success-border: #aff0b5;

  --danger: #f53f3f;
  --danger-bg: #ffece8;
  --danger-border: #fcd0cc;

  --warning: #ff7d00;
  --warning-bg: #fff7e8;
  --warning-border: #fedcb2;

  --working: #1e80ff;
  --working-bg: #e8f3ff;
  --working-border: #bfe0ff;

  /* 文字层级（杜绝 9px） */
  --text-primary: #1d2129;   /* 标题与主要文字: 13-14px */
  --text-regular: #4e5969;   /* 描述正文: 12px */
  --text-muted: #86909c;     /* 辅助信息、时间、统计: 11px */

  /* 背景与边框 */
  --bg-body: #f0f2f5;
  --bg-main: #ffffff;
  --bg-card: #ffffff;
  --bg-subtle: #f7f8fa;
  --bg-hover: #f2f3f5;
  --border: #e5e6eb;
  --border-subtle: #f0f2f5;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-body: #121214;
    --bg-main: #19191d;
    --bg-card: #222228;
    --bg-subtle: #292932;
    --bg-hover: #32323e;

    --text-primary: #f2f3f5;
    --text-regular: #c9cdd4;
    --text-muted: #86909c;

    --border: #363642;
    --border-subtle: #2c2c36;

    --brand-light: rgba(30, 128, 255, 0.2);
    --success-bg: rgba(0, 180, 42, 0.16);
    --danger-bg: rgba(245, 63, 63, 0.16);
    --warning-bg: rgba(255, 125, 0, 0.16);
  }
}
```

---

## 四、 核心代码改动清单

| 文件路径 | 改动核心说明 |
| :--- | :--- |
| `src/popup.html` | 重构为 Header（状态胶囊）+ 双 Tab 导航 + 任务/设置面板一体化结构。 |
| `src/popup.css` | 完整建立 Design Tokens、布局样式体系与 `@media (prefers-color-scheme: dark)` 深色模式。 |
| `src/popup-fixes.css` | 清理原有覆写补丁，样式合并归一。 |
| `src/popup.ts` | 适配双 Tab 切换、顶栏 CSDN 状态胶囊交互、诊断信息剪贴板复制、空状态引导。 |
| `src/juejin-content.css` | 对齐掘金 Semi Design 规范（36px 高度、6px 圆角），适配掘金深色主题。 |
| `src/juejin-content.ts` | 优化注入控件文案为“同步到 CSDN 草稿”。 |
| `scripts/extract-release-notes.mjs` | 新增发版自动化脚本，将更新日志格式化为带高颜值 Emoji 的 GitHub Release Notes。 |
| `.github/workflows/release.yml` | 接入 Release Notes 自动化提取与发布。 |

---

## 五、 验证与质量保证

1. **TypeScript 静态检查**：
   ```bash
   npm run check
   ```
   结果：全量通过，0 错误。
2. **自动化单元测试**：
   ```bash
   npm test
   ```
   结果：22 项核心逻辑测试 100% 通过，确保改动未破坏任何扩展通信协议。
3. **打包与构建测试**：
   ```bash
   npm run release:zip
   ```
   结果：成功生成包含完整资源与清单的 `release/article-ferry-v0.5.0.zip`。
