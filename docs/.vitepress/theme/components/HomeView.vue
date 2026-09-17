<script setup>
import { withBase } from 'vitepress'
import { ref, computed } from 'vue'

const activeTab = ref('new')
const activeDimensionIndex = ref(0)

const comparisonDimensions = [
  {
    id: 'security',
    icon: '🛡️',
    title: '账号与 Cookie 隐私',
    link: '/deep-dive/security-privacy',
    linkText: '阅读零信任隐私架构深度剖析',
    badSide: {
      tag: '高危妥协 · 凭证出海',
      title: '第三方托管平台 & 暴力脚本',
      desc: '要求用户输入平台账号密码，或将包含全权限的会话 Cookie 上传至第三方远程服务器托管。一旦云端遭遇渗透或接口泄露，账号主权彻底旁落。',
      techBadge: '危险：跨域 Cookie 泄露 · 集中式云托管'
    },
    goodSide: {
      tag: '工程红线 · 纯端侧闭环',
      title: '文章摆渡 (Article Ferry)',
      desc: '基于 Chrome MV3 沙箱规范构建，manifest 坚决不声明 cookies 敏感权限。直接复用浏览器当前已有登录会话，数据 100% 封闭在本地。',
      techBadge: '安全：0 Cookie 权限申请 · 100% 本地运算'
    }
  },
  {
    id: 'images',
    icon: '🖼️',
    title: '无损原图与去水印',
    link: '/features/image-pipeline',
    linkText: '深入了解高清原图处理管线',
    badSide: {
      tag: '画质压缩 · 水印污染',
      title: '手动复制 & 粗糙爬虫',
      desc: '直接复制的文章图片携带源站裁剪水印或防盗链参数；经第三方平台二次有损压缩后，架构流程图、代码截图细节模糊难辨，转存常大面积裂图。',
      techBadge: '劣势：OSS 水印残留 · 二次压缩模糊'
    },
    goodSide: {
      tag: '原始直链 · 3路退避并发',
      title: '文章摆渡 (Article Ferry)',
      desc: '智能剔除 CDN 裁剪模板与 OSS 水印参数，毫秒级提取最高清原始无损图。配备 3 路有限并发队列与指数退避重试，数十张大图亦能稳健入库。',
      techBadge: '优势：智能剔除水印 · 3 路退避流式转存'
    }
  },
  {
    id: 'idempotence',
    icon: '⚡',
    title: '修改同步与草稿自愈',
    link: '/features/idempotence',
    linkText: '探秘双身份幂等与自愈机制',
    badSide: {
      tag: '废稿泛滥 · 覆盖错乱',
      title: '简易脚本 & 手工迁移',
      desc: '博文修改错字重新同步时，每点击一次便生成一份全新草稿碎片，草稿箱堆满垃圾；甚至因 ID 映射错乱而误覆盖线上正在展示的热门博文。',
      techBadge: '痛点：草稿箱碎片泛滥 · 线上博文误覆盖'
    },
    goodSide: {
      tag: '双身份映射 · 400 删稿自愈',
      title: '文章摆渡 (Article Ferry)',
      desc: '基于 article_id 与 draft_id 物理映射，二次修改原地覆盖；已删草稿遇 400 自动降级新建自愈；且预置线上已发布状态硬阻断，绝不破坏历史数据。',
      techBadge: '保障：双身份物理映射 · 删稿自愈降级'
    }
  },
  {
    id: 'syntax',
    icon: '📝',
    title: 'Markdown 语法兼容',
    link: '/features/sync-engine',
    linkText: '阅读通用 Markdown 转译说明',
    badSide: {
      tag: '语法裸露 · 格式崩塌',
      title: '原生粘贴 & 机械搬运',
      desc: '掘金特有的 :::tips、:::note 等内置容器语法在目标平台直接裸露为文本或代码错位乱卷，创作者不得不花费十几分钟手动修补排版。',
      techBadge: '代价：:::tips 语法乱码 · 手动重排耗时'
    },
    goodSide: {
      tag: 'AST 级转译 · 保护围栏',
      title: '文章摆渡 (Article Ferry)',
      desc: '内置 AST 级语法清洗转换器，将特有容器平滑转译为通用标准 Markdown 引用块；特有保护机制确保代码围栏内的字面量绝对不动。',
      techBadge: '体验：标准 Markdown 引用 · 代码块 0 误伤'
    }
  },
  {
    id: 'boundary',
    icon: '⛵',
    title: '人机协作与确认边界',
    link: '/guide/',
    linkText: '了解人机协作设计边界',
    badSide: {
      tag: '越权代发 · 封号连带',
      title: '全自动无脑托管平台',
      desc: '盲目追求“全自动”，替用户直接点击公开发布。未核对分类或未审阅的文章一旦触发目标平台敏感词风控，创作者主账号将直接面临封禁连带。',
      techBadge: '高危：自动化暴力代发 · 违规封号连带'
    },
    goodSide: {
      tag: '敬畏红线 · 主权在人',
      title: '文章摆渡 (Article Ferry)',
      desc: '恪守 Human-in-the-loop 人机协作原则：工具专注扫清 90% 机械转存脏活，文章稳稳落入草稿箱，最终公开发布确认权 100% 永远交还给创作者。',
      techBadge: '红线：止步草稿箱 · 最终确认权在人'
    }
  }
]

const currentDimension = computed(() => comparisonDimensions[activeDimensionIndex.value])

const copyCommand = async () => {
  try {
    await navigator.clipboard.writeText('chrome://extensions')
    alert('已复制扩展管理地址：chrome://extensions')
  } catch (e) {
    // fallback
  }
}
</script>

<template>
  <div class="home-page-root">
    <!-- Ambient Background Lighting -->
    <div class="ambient-glow glow-top"></div>
    <div class="ambient-glow glow-middle"></div>

    <!-- 1. HERO SECTION -->
    <section class="hero-section">
      <!-- Announcement Pill -->
      <a :href="withBase('/changelog/')" class="hero-badge-pill" title="点击查看 v0.6.0 版本发布日志与新特性说明">
        <span class="pill-pulse"></span>
        <span class="pill-tag">v0.6.0 发布</span>
        <span class="pill-text">无水印图床清洗与 Dry-run 排版预演已上线</span>
        <svg class="pill-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </a>

      <!-- Main Titles -->
      <h1 class="hero-main-title">
        让技术创作更从容<br />
        <span class="title-gradient">一处专注写作，优雅摆渡全网阵地</span>
      </h1>

      <p class="hero-lead">
        面向技术创作者的端侧安全内容摆渡中枢。首发全面支持掘金至 CSDN 极速同步，消灭 90% 的机械搬运与格式清洗。坚守<strong>人机协作边界</strong>，坚决不替用户公开发布，守住创作者版权与资产底线。
      </p>

      <!-- Action Buttons -->
      <div class="hero-actions">
        <a :href="withBase('/downloads/article-ferry-latest.zip')" download class="action-btn-primary">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>直接下载离线安装包</span>
          <span class="btn-micro-badge">v0.6.0 · ~64KB</span>
        </a>

        <a href="#quick-steps" class="action-btn-secondary">
          <span>三步安装教程</span>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </a>

        <a href="https://github.com/Xxcool/juejin-csdn-extension" target="_blank" rel="noopener" class="action-btn-ghost">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
          </svg>
          <span>GitHub 开源</span>
        </a>
      </div>

      <!-- Live Mockup Window (UI 2.0 实际界面立体仿真) -->
      <div class="hero-mockup-wrapper">
        <div class="mockup-window">
          <!-- Window Titlebar -->
          <div class="mockup-header">
            <div class="window-dots">
              <span class="dot dot-red"></span>
              <span class="dot dot-yellow"></span>
              <span class="dot dot-green"></span>
            </div>
            <div class="window-title">
              <img :src="withBase('/logo.svg')" width="16" height="16" alt="logo" />
              <span>文章摆渡 · 真实运行界面 (Raycast 旗舰工艺)</span>
            </div>
            <div class="window-badges">
              <span class="cs-status-capsule">
                <span class="cs-status-glow"></span>
                <span>CSDN 在线</span>
              </span>
            </div>
          </div>

          <!-- Extension Popup Simulation Inner -->
          <div class="mockup-body">
            <!-- Navigation Tabs -->
            <div class="popup-tab-bar">
              <div class="tab-item active">
                <span>同步记录</span>
                <span class="tab-badge">2/8 篇</span>
              </div>
              <div class="tab-item">
                <span>偏好设置</span>
              </div>
            </div>

            <!-- Task List Filter -->
            <div class="popup-filter-track">
              <span class="pill-chip active">全部 (8)</span>
              <span class="pill-chip">已保存 (6)</span>
              <span class="pill-chip">运行中 (1)</span>
              <span class="pill-chip">待处理 (1)</span>
            </div>

            <!-- Task Card 1 (Saved with High Glory Button) -->
            <div class="mockup-task-card">
              <div class="task-card-head">
                <span class="task-time">刚刚 · 掘金发文联动</span>
                <span class="task-badge-saved">✓ 已抵达草稿箱</span>
              </div>
              <h4 class="task-card-title">深入剖析 Chrome Extension Manifest V3 架构实战与端侧安全</h4>
              <div class="task-metrics">
                <span class="metric-tag">📝 4,820 字</span>
                <span class="metric-tag">🖼️ 8 张原图已转存 (去水印)</span>
                <span class="metric-tag">🏷️ 专栏：前端架构</span>
                <span class="metric-tag">🛡️ 0 废稿</span>
              </div>
              <div class="task-card-footer">
                <a :href="withBase('/guide/dry-run')" class="btn-dry-run" title="查看同步预演完整功能指南">预演报告 👁️</a>
                <div class="footer-right">
                  <span class="footnote-text">双身份幂等映射中</span>
                  <a :href="withBase('/guide/quick-start')" class="btn-goto-draft" title="查看极速上手发文流程">草稿 ↗</a>
                </div>
              </div>
            </div>

            <!-- Task Card 2 (Running with Shimmer Wave) -->
            <div class="mockup-task-card card-running">
              <div class="task-card-head">
                <span class="task-time">1 分钟前 · 历史文章迁移</span>
                <span class="task-badge-running">⚡ 正在转存图片 3/6...</span>
              </div>
              <h4 class="task-card-title">Vue 3 响应式系统深度剖析与性能优化实战</h4>
              <div class="task-progress-bar">
                <div class="progress-fill" style="width: 50%;">
                  <span class="shimmer-wave"></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 2. QUICK SPEC / STATS BAR -->
    <section class="quick-stats-bar">
      <div class="stat-box">
        <div class="stat-num">0 <span class="stat-unit">Cookie</span></div>
        <div class="stat-label">坚决不索要敏感 Cookie 权限</div>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-box">
        <div class="stat-num">100%</div>
        <div class="stat-label">本地端侧闭环，数据不上第三方云端</div>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-box">
        <div class="stat-num">3 路</div>
        <div class="stat-label">高清图床并发限制与指数退避重试</div>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-box">
        <div class="stat-num">0 废稿</div>
        <div class="stat-label">双身份草稿幂等与 400 删稿自愈降级</div>
      </div>
    </section>

    <!-- 3. INSTALLATION GUIDE (三步开始使用) -->
    <section id="quick-steps" class="section-container">
      <div class="section-title-wrap">
        <div class="section-kicker kicker-blue">
          <span class="kicker-dot"></span>
          <span class="kicker-label">极速起步</span>
          <span class="kicker-sep">/</span>
          <span class="kicker-sub">01 · WORKFLOW</span>
        </div>
        <h2 class="section-h2">简单三步，开启端侧无感摆渡</h2>
        <p class="section-p">无需复杂配置，本地解压即载入。全面兼容 Chrome、Edge、Brave、Arc 等所有主流 Chromium 浏览器。</p>
      </div>

      <div class="three-steps-grid">
        <!-- Step 1 -->
        <div class="step-modern-card step-card-1">
          <div class="step-num-glow glow-coral">01</div>
          <div class="step-card-content">
            <div class="step-icon-circle icon-coral">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </div>
            <h3 class="step-h3">下载与解压安装</h3>
            <p class="step-p">
              下载最新 ZIP 安装包并解压；在浏览器地址栏打开
              <code class="code-pill" @click="copyCommand">chrome://extensions</code>
              开启右上角<strong>「开发者模式」</strong>，点击<strong>「加载已解压的扩展程序」</strong>选中解压目录。
            </p>
            <div class="step-footer-action">
              <a :href="withBase('/downloads/article-ferry-latest.zip')" download class="link-download">
                ⬇️ 立即下载 ZIP 离线包 (~64KB)
              </a>
            </div>
          </div>
        </div>

        <!-- Step 2 -->
        <div class="step-modern-card step-card-2">
          <div class="step-num-glow glow-blue">02</div>
          <div class="step-card-content">
            <div class="step-icon-circle icon-blue">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
            </div>
            <h3 class="step-h3">登录掘金与 CSDN</h3>
            <p class="step-p">
              在浏览器标签页分别正常打开并登录掘金与 CSDN。插件秉持<strong>纯端侧零信任</strong>，直接复用当前浏览器已有会话通道，不索要账号密码，数据绝不出你的电脑。
            </p>
            <div class="step-footer-action">
              <span class="status-indicator-tag">🟢 插件顶栏呼吸绿灯亮起即就绪</span>
            </div>
          </div>
        </div>

        <!-- Step 3 -->
        <div class="step-modern-card step-card-3">
          <div class="step-num-glow glow-green">03</div>
          <div class="step-card-content">
            <div class="step-icon-circle icon-green">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            </div>
            <h3 class="step-h3">一键同步摆渡</h3>
            <p class="step-p">
              在掘金发布文章时，发文面板中已默认勾选<strong>「同步到 CSDN 草稿」</strong>，点击发文即秒级后台摆渡；博文安全保存至 CSDN 草稿箱，最终发布确认权永远由创作者自主掌控。
            </p>
            <div class="step-footer-action">
              <span class="status-indicator-tag">⛵ 人机协作边界 · 绝不替用户公开发布</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 4. CORE FEATURES (六大核心特性 BENTO 矩阵) -->
    <section class="section-container">
      <div class="section-title-wrap">
        <div class="section-kicker kicker-emerald">
          <span class="kicker-dot"></span>
          <span class="kicker-label">核心护城河</span>
          <span class="kicker-sep">/</span>
          <span class="kicker-sub">02 · CAPABILITIES</span>
        </div>
        <h2 class="section-h2">专为高频技术写作精雕细琢</h2>
        <p class="section-p">深度整合掘金发文抽屉与内容管理中心，从排版预演到无损原图转存，全链路消灭格式崩塌与机械重复。</p>
      </div>

      <div class="bento-grid">
        <!-- Feature 1: Large -->
        <div class="bento-card bento-col-2">
          <div class="bento-header">
            <div class="bento-icon-box bg-blue">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
              </svg>
            </div>
            <span class="bento-badge badge-blue">核心驱动</span>
          </div>
          <h3 class="bento-h3">发文无感秒级摆渡</h3>
          <p class="bento-p">
            在掘金发文抽屉中点击“确定并发布”时后台秒级触发，完全不阻塞掘金正常发文与审核。通过双路径按需拉取，新发博文与历史旧文均可保留纯正原始 Markdown，消灭 90% 的繁琐复制耗时。
          </p>
        </div>

        <!-- Feature 2 -->
        <div class="bento-card">
          <div class="bento-header">
            <div class="bento-icon-box bg-emerald">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              </svg>
            </div>
            <span class="bento-badge badge-emerald">双重映射</span>
          </div>
          <h3 class="bento-h3">双身份草稿幂等与自愈</h3>
          <p class="bento-p">
            基于 article_id 与 draft_id 双重映射，二次修改原地覆盖草稿；遇 400 删稿自动降级新建自愈，更设线上已发布博文强制阻断红线。
          </p>
        </div>

        <!-- Feature 3 -->
        <div class="bento-card">
          <div class="bento-header">
            <div class="bento-icon-box bg-amber">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
            </div>
            <span class="bento-badge badge-amber">无损画质</span>
          </div>
          <h3 class="bento-h3">高清原图去水印直链</h3>
          <p class="bento-p">
            智能剔除 CDN 裁剪缩放与 OSS 水印参数，获取无损原始原图；支持 3 路并发转存与指数退避，特有容器语法转译为标准 Markdown。
          </p>
        </div>

        <!-- Feature 4 -->
        <div class="bento-card">
          <div class="bento-header">
            <div class="bento-icon-box bg-purple">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </div>
            <span class="bento-badge badge-purple">v0.6.0 创新</span>
          </div>
          <h3 class="bento-h3">排版预演 (Dry-run)</h3>
          <p class="bento-p">
            零副作用纯内存静态排版体检。字数统计、分类命中、待转存图片与容器风险一览无余，全程不写草稿、不传图片，从源头杜绝测试废稿。
          </p>
        </div>

        <!-- Feature 5: Large -->
        <div class="bento-card bento-col-2">
          <div class="bento-header">
            <div class="bento-icon-box bg-rose">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            </div>
            <span class="bento-badge badge-rose">零信任原则</span>
          </div>
          <h3 class="bento-h3">零 Cookie 纯端侧安全</h3>
          <p class="bento-p">
            绝不申请 cookies 权限，零第三方云端服务器中转。存储数据按需瘦身剥离正文，根除 10MB 配额爆仓风险，配备 8 类结构化脱敏诊断日志，开源透明。
          </p>
        </div>
      </div>
    </section>

    <!-- 5. TWO SCENARIOS (两大核心场景) -->
    <section class="section-container">
      <div class="section-title-wrap">
        <div class="section-kicker kicker-coral">
          <span class="kicker-dot"></span>
          <span class="kicker-label">全场景覆盖</span>
          <span class="kicker-sep">/</span>
          <span class="kicker-sub">03 · DUAL WORKFLOWS</span>
        </div>
        <h2 class="section-h2">发文与迁移，两大创作链路</h2>
        <p class="section-p">日常发文后台即时同步，存量历史博文一键批量迁移。全流程数据留存在端侧，安全从容。</p>
      </div>

      <div class="scenarios-dual-grid">
        <!-- Scenario A -->
        <div class="scenario-box scenario-border-coral">
          <div class="scenario-top">
            <span class="scenario-pill pill-coral">日常高频 · 场景一</span>
            <h3 class="scenario-h3">新文章发文即时同步</h3>
            <p class="scenario-sub">在掘金常规技术写作流程中自然顺滑触发，秒级完成后台转存</p>
          </div>

          <div class="flow-steps">
            <div class="flow-step">
              <div class="flow-num num-coral">1</div>
              <div class="flow-info">
                <strong>编辑撰写完成</strong>
                <p>在掘金 Markdown 编辑器完成博文，点击右上角「发布」唤起抽屉面板</p>
              </div>
            </div>
            <div class="flow-step">
              <div class="flow-num num-coral">2</div>
              <div class="flow-info">
                <strong>确认同步选项</strong>
                <p>抽屉中默认勾选「同步到 CSDN 草稿」，自动智能补齐专栏分类建议与摘要</p>
              </div>
            </div>
            <div class="flow-step">
              <div class="flow-num num-coral">3</div>
              <div class="flow-info">
                <strong>发布秒级落盘</strong>
                <p>点击「确定并发布」，后台静默搬运原图，Chrome 原生系统通知提示落地</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Scenario B -->
        <div class="scenario-box scenario-border-blue">
          <div class="scenario-top">
            <span class="scenario-pill pill-blue">存量沉淀 · 场景二</span>
            <h3 class="scenario-h3">历史旧文一键批量迁移</h3>
            <p class="scenario-sub">盘活存量优质技术资产，轻松实现多平台多渠道矩阵覆盖</p>
          </div>

          <div class="flow-steps">
            <div class="flow-step">
              <div class="flow-num num-blue">1</div>
              <div class="flow-info">
                <strong>进入创作者中心</strong>
                <p>访问掘金「创作者中心 ➔ 内容管理 ➔ 文章管理」博文列表界面</p>
              </div>
            </div>
            <div class="flow-step">
              <div class="flow-num num-blue">2</div>
              <div class="flow-info">
                <strong>点击专属摆渡按钮</strong>
                <p>在任意博文右侧点击新增的「摆渡到 CSDN」快捷操作按钮</p>
              </div>
            </div>
            <div class="flow-step">
              <div class="flow-num num-blue">3</div>
              <div class="flow-info">
                <strong>串行限流安全搬运</strong>
                <p>后台自动排队执行，弹窗中点击「草稿 ↗」按钮直接打开 CSDN 检阅发文</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 6. THE CREATIVE DUEL & INTERACTIVE DIMENSION COMPASS (两条路线的直观对决与五大维度透视台) -->
    <section class="section-container section-why-ferry">
      <div class="section-title-wrap">
        <div class="section-kicker kicker-purple">
          <span class="kicker-dot"></span>
          <span class="kicker-label">创作者主权对决</span>
          <span class="kicker-sep">/</span>
          <span class="kicker-sub">04 · ARCHITECTURAL DUEL</span>
        </div>
        <h2 class="section-h2">为什么技术创作者信赖「文章摆渡」？</h2>
        <p class="section-p">拒绝将就与妥协。坚守纯端侧零信任架构与人机协作底线，把数据安全与创作主权真正交还给博主。</p>
      </div>

      <!-- 6.1 THE DUEL CARDS (对立双阵营对决卡片) -->
      <div class="duel-arena">
        <!-- Card Left: 妥协之路 -->
        <div class="duel-card card-vulnerable">
          <div class="duel-card-header">
            <div class="duel-badge badge-warning">
              <span class="badge-dot dot-red"></span>
              <span>妥协之路 · 传统手工与云端方案</span>
            </div>
            <h3 class="duel-title">为图省事而让渡核心主权</h3>
            <p class="duel-desc">第三方托管平台、暴力脚本或手动复制，往往隐藏着无法逆转的工程妥协与封号风险。</p>
          </div>

          <div class="duel-items-list">
            <div class="duel-item item-bad">
              <div class="item-icon-box icon-bad">🔓</div>
              <div class="item-content">
                <strong class="item-title">凭证出海 · 隐私裸奔</strong>
                <p class="item-text">要求将包含全权限的 Cookie 或登录账号上传至第三方服务器托管，随时面临黑客拖库与越权外泄隐患。</p>
              </div>
            </div>

            <div class="duel-item item-bad">
              <div class="item-icon-box icon-bad">🌫️</div>
              <div class="item-content">
                <strong class="item-title">画质损耗 · 水印污染</strong>
                <p class="item-text">复制的图片携带源站裁剪水印参数，经云端二次转存压缩后架构图严重模糊失真，甚至直接大面积裂图。</p>
              </div>
            </div>

            <div class="duel-item item-bad">
              <div class="item-icon-box icon-bad">🗂️</div>
              <div class="item-content">
                <strong class="item-title">草稿裂变 · 覆盖灾难</strong>
                <p class="item-text">微调文章时每点一次产生一份新草稿垃圾；缺少线上状态阻断，极易因 ID 错乱而误覆盖线上爆款文章。</p>
              </div>
            </div>

            <div class="duel-item item-bad">
              <div class="item-icon-box icon-bad">🚨</div>
              <div class="item-content">
                <strong class="item-title">暴力代发 · 封号连带</strong>
                <p class="item-text">以全自动为噱头替用户直接公开发布，一旦触碰目标社区敏感词审核风控，创作者账号将直接面临禁言封禁。</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Center VS Badge -->
        <div class="duel-center-divider">
          <div class="vs-circle">
            <span class="vs-text">VS</span>
          </div>
        </div>

        <!-- Card Right: 摆渡之道 (HIGHLIGHTED) -->
        <div class="duel-card card-champion">
          <div class="champion-glow"></div>
          <div class="duel-card-header">
            <div class="duel-badge badge-champion">
              <span class="badge-dot dot-green"></span>
              <span>摆渡之道 · 端侧安全准则</span>
            </div>
            <h3 class="duel-title">工程恪守与创作者第一</h3>
            <p class="duel-desc">100% 运行于本地浏览器，消灭 90% 机械排版与转存脏活，最终确认决策权永远由创作者自主掌控。</p>
          </div>

          <div class="duel-items-list">
            <div class="duel-item item-good">
              <div class="item-icon-box icon-good">🛡️</div>
              <div class="item-content">
                <strong class="item-title">纯端侧零信任 (Zero-Cookie)</strong>
                <p class="item-text">完全运行在 Chrome MV3 本地沙箱，manifest 绝不申请 cookies 敏感权限，数据绝不出你的电脑。</p>
              </div>
            </div>

            <div class="duel-item item-good">
              <div class="item-icon-box icon-good">💎</div>
              <div class="item-content">
                <strong class="item-title">无损原图直链 · 3 路退避并发</strong>
                <p class="item-text">智能剥离 CDN 裁剪与 OSS 水印参数获取原始最高画质，3 路受控并发队列，平滑转存保留代码图细节。</p>
              </div>
            </div>

            <div class="duel-item item-good">
              <div class="item-icon-box icon-good">⚡</div>
              <div class="item-content">
                <strong class="item-title">双身份幂等 · 400 删稿自愈</strong>
                <p class="item-text">article_id 与 draft_id 双重映射，二次修改原地覆盖；已删草稿 400 自动降级新建，已发布博文强制阻断。</p>
              </div>
            </div>

            <div class="duel-item item-good">
              <div class="item-icon-box icon-good">⛵</div>
              <div class="item-content">
                <strong class="item-title">人机协作红线 · 止步草稿箱</strong>
                <p class="item-text">恪守 Human-in-the-loop 哲学：专注搞定繁琐转存，最终“公开发布”按钮永远由创作者在草稿箱确认点击。</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 6.2 INTERACTIVE DIMENSION COMPASS (交互式 5 大维度深度透视台) -->
      <div class="dimension-interactive-box">
        <div class="interactive-box-head">
          <div class="interactive-title-group">
            <span class="interactive-pill">交互式技术透视</span>
            <h3 class="interactive-h3">点击切换 5 大维度底层工程差异</h3>
          </div>
          <!-- 5 interactive switch buttons -->
          <div class="dimension-nav-track">
            <button
              v-for="(dim, index) in comparisonDimensions"
              :key="dim.id"
              class="dimension-nav-btn"
              :class="{ active: activeDimensionIndex === index }"
              @click="activeDimensionIndex = index"
            >
              <span class="btn-icon">{{ dim.icon }}</span>
              <span class="btn-name">{{ dim.title }}</span>
            </button>
          </div>
        </div>

        <!-- Dimension Deep-Dive Display Card -->
        <div class="dimension-detail-card">
          <div class="detail-split-row">
            <!-- Bad side detail -->
            <div class="detail-col col-bad">
              <div class="col-head">
                <span class="chip-bad">{{ currentDimension.badSide.tag }}</span>
                <h4 class="col-title">{{ currentDimension.badSide.title }}</h4>
              </div>
              <p class="col-desc">{{ currentDimension.badSide.desc }}</p>
              <div class="col-footer-tag tag-risk">
                {{ currentDimension.badSide.techBadge }}
              </div>
            </div>

            <!-- VS arrow separator -->
            <div class="detail-col-arrow">
              <div class="arrow-pill">➔</div>
            </div>

            <!-- Good side detail -->
            <div class="detail-col col-good">
              <div class="col-head">
                <span class="chip-good">{{ currentDimension.goodSide.tag }}</span>
                <h4 class="col-title">{{ currentDimension.goodSide.title }}</h4>
              </div>
              <p class="col-desc">{{ currentDimension.goodSide.desc }}</p>
              <div class="col-footer-flex">
                <span class="col-footer-tag tag-safe">{{ currentDimension.goodSide.techBadge }}</span>
                <a :href="withBase(currentDimension.link)" class="col-deep-link">
                  <span>{{ currentDimension.linkText }}</span>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 7. BOTTOM CALL TO ACTION -->
    <section class="cta-banner-section">
      <div class="cta-banner-card">
        <div class="cta-content">
          <h2 class="cta-title">告别繁复搬运，让每次技术创作都从容留存</h2>
          <p class="cta-desc">
            离线安装包开箱即用，无需科学上网，支持 Chrome / Edge 等所有主流 Chromium 浏览器。
          </p>
          <div class="cta-actions">
            <a :href="withBase('/downloads/article-ferry-latest.zip')" download class="cta-primary-btn">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>立即下载离线包 (.zip)</span>
            </a>
            <a href="https://github.com/Xxcool/juejin-csdn-extension" target="_blank" rel="noopener" class="cta-secondary-btn">
              <span>在 GitHub 上 Star 本项目 ⭐️</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home-page-root {
  position: relative;
  overflow: hidden;
  padding: 0 24px 80px 24px;
  max-width: 1200px;
  margin: 0 auto;
}

/* Ambient Background Glows */
.ambient-glow {
  position: absolute;
  pointer-events: none;
  border-radius: 50%;
  filter: blur(100px);
  z-index: 0;
}

.glow-top {
  top: -120px;
  left: 50%;
  transform: translateX(-50%);
  width: 680px;
  height: 420px;
  background: radial-gradient(circle, rgba(29, 125, 250, 0.22) 0%, rgba(0, 210, 255, 0.08) 60%, transparent 80%);
}

.glow-middle {
  top: 900px;
  right: -100px;
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, rgba(16, 185, 129, 0.12) 0%, transparent 70%);
}

/* 1. HERO SECTION */
.hero-section {
  position: relative;
  z-index: 1;
  text-align: center;
  padding: 56px 0 40px 0;
}

.hero-badge-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px 5px 8px;
  border-radius: 9999px;
  background: rgba(29, 125, 250, 0.08);
  border: 1px solid rgba(29, 125, 250, 0.24);
  font-size: 0.85rem;
  color: var(--vp-c-text-1) !important;
  text-decoration: none !important;
  margin-bottom: 24px;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  cursor: pointer;
}

.hero-badge-pill:hover {
  background: rgba(29, 125, 250, 0.14);
  border-color: var(--vp-c-brand-1);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(29, 125, 250, 0.18);
}

.hero-badge-pill:hover .pill-arrow {
  transform: translateX(3px);
}

.pill-arrow {
  transition: transform 0.2s ease;
  color: var(--vp-c-brand-1);
}

.pill-pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1D7DFA;
  box-shadow: 0 0 0 0 rgba(29, 125, 250, 0.7);
  animation: pulseDot 2s infinite;
}

@keyframes pulseDot {
  0% { box-shadow: 0 0 0 0 rgba(29, 125, 250, 0.7); }
  70% { box-shadow: 0 0 0 8px rgba(29, 125, 250, 0); }
  100% { box-shadow: 0 0 0 0 rgba(29, 125, 250, 0); }
}

.pill-tag {
  font-weight: 700;
  color: var(--vp-c-brand-1);
  font-size: 0.8rem;
}

.pill-text {
  color: var(--vp-c-text-2);
}

.hero-main-title {
  font-size: 3.2rem;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: -0.02em;
  margin: 0 0 20px 0;
  color: var(--vp-c-text-1);
}

.title-gradient {
  background: linear-gradient(135deg, #1D7DFA 0%, #00b4d8 50%, #06d6a0 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.hero-lead {
  max-width: 740px;
  margin: 0 auto 32px auto;
  font-size: 1.15rem;
  line-height: 1.75;
  color: var(--vp-c-text-2);
  text-wrap: balance;
}

.hero-actions {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 48px;
}

.action-btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 13px 28px;
  border-radius: 12px;
  background: linear-gradient(135deg, #1D7DFA 0%, #0056cc 100%);
  color: #fff !important;
  font-weight: 600;
  font-size: 1rem;
  box-shadow: 0 8px 24px rgba(29, 125, 250, 0.35);
  text-decoration: none !important;
  transition: all 0.25s ease;
}

.action-btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 30px rgba(29, 125, 250, 0.48);
  background: linear-gradient(135deg, #308cfc 0%, #0066ff 100%);
}

.btn-micro-badge {
  font-size: 0.72rem;
  background: rgba(255, 255, 255, 0.2);
  padding: 2px 7px;
  border-radius: 999px;
  font-weight: 500;
}

.action-btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 13px 22px;
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  color: var(--vp-c-text-1) !important;
  font-weight: 500;
  font-size: 1rem;
  text-decoration: none !important;
  transition: all 0.2s ease;
}

.action-btn-secondary:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1) !important;
  transform: translateY(-1px);
}

.action-btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 13px 20px;
  border-radius: 12px;
  color: var(--vp-c-text-2) !important;
  font-size: 0.95rem;
  font-weight: 500;
  text-decoration: none !important;
  transition: all 0.2s ease;
}

.action-btn-ghost:hover {
  color: var(--vp-c-brand-1) !important;
}

/* HERO MOCKUP WINDOW */
.hero-mockup-wrapper {
  max-width: 680px;
  margin: 0 auto;
  perspective: 1000px;
}

.mockup-window {
  background: var(--vp-c-bg);
  border: 1px solid rgba(29, 125, 250, 0.25);
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.12), 0 0 0 1px var(--vp-c-border);
  overflow: hidden;
  text-align: left;
  transition: transform 0.4s ease, box-shadow 0.4s ease;
}

.mockup-window:hover {
  transform: translateY(-4px);
  box-shadow: 0 26px 80px rgba(29, 125, 250, 0.2), 0 0 0 1px var(--vp-c-brand-1);
}

.mockup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-border);
}

.window-dots {
  display: flex;
  gap: 6px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.dot-red { background: #ff5f56; }
.dot-yellow { background: #ffbd2e; }
.dot-green { background: #27c93f; }

.window-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.cs-status-capsule {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  font-size: 0.75rem;
  font-weight: 600;
  border: 1px solid rgba(16, 185, 129, 0.25);
}

.cs-status-glow {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
}

.mockup-body {
  padding: 20px 22px;
}

.popup-tab-bar {
  display: flex;
  background: var(--vp-c-bg-soft);
  padding: 3px;
  border-radius: 10px;
  margin-bottom: 14px;
}

.tab-item {
  flex: 1;
  text-align: center;
  padding: 6px 12px;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--vp-c-text-2);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.tab-item.active {
  background: var(--vp-c-bg);
  color: var(--vp-c-brand-1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.tab-badge {
  font-size: 0.72rem;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  padding: 1px 6px;
  border-radius: 999px;
}

.popup-filter-track {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.pill-chip {
  font-size: 0.75rem;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-border);
}

.pill-chip.active {
  background: var(--vp-c-brand-1);
  color: #fff;
  border-color: var(--vp-c-brand-1);
}

.mockup-task-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  padding: 16px 16px;
  margin-bottom: 12px;
}

.task-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.task-time {
  font-size: 0.78rem;
  color: var(--vp-c-text-3);
}

.task-badge-saved {
  font-size: 0.75rem;
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.25);
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 600;
}

.task-badge-running {
  font-size: 0.75rem;
  color: #1D7DFA;
  background: rgba(29, 125, 250, 0.1);
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 600;
}

.task-card-title {
  font-size: 0.96rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin: 0 0 10px 0;
  line-height: 1.4;
}

.task-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
}

.metric-tag {
  font-size: 0.72rem;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  color: var(--vp-c-text-2);
}

.task-card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px dashed var(--vp-c-border);
  padding-top: 10px;
}

.btn-dry-run {
  font-size: 0.78rem;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--vp-c-border);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2) !important;
  text-decoration: none !important;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  transition: all 0.2s ease;
}

.btn-dry-run:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1) !important;
  background: var(--vp-c-brand-soft);
}

.footer-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.footnote-text {
  font-size: 0.72rem;
  color: var(--vp-c-text-3);
}

.btn-goto-draft {
  font-size: 0.8rem;
  font-weight: 600;
  padding: 5px 14px;
  border-radius: 8px;
  background: linear-gradient(135deg, #1D7DFA 0%, #0056cc 100%);
  color: #fff !important;
  text-decoration: none !important;
  box-shadow: 0 3px 10px rgba(29, 125, 250, 0.3);
}

.task-progress-bar {
  height: 6px;
  background: var(--vp-c-bg);
  border-radius: 999px;
  overflow: hidden;
  margin-top: 10px;
}

.progress-fill {
  height: 100%;
  background: #1D7DFA;
  position: relative;
  overflow: hidden;
}

.shimmer-wave {
  position: absolute;
  top: 0; left: -100%; right: 0; bottom: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent);
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  100% { left: 100%; }
}

/* 2. STATS BAR */
.quick-stats-bar {
  display: flex;
  justify-content: space-around;
  align-items: center;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 16px;
  padding: 24px 20px;
  margin: 40px 0 60px 0;
}

.stat-box {
  text-align: center;
}

.stat-num {
  font-size: 1.8rem;
  font-weight: 800;
  color: var(--vp-c-brand-1);
  line-height: 1.2;
}

.stat-unit {
  font-size: 1rem;
  font-weight: 600;
}

.stat-label {
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  margin-top: 4px;
}

.stat-divider {
  width: 1px;
  height: 36px;
  background: var(--vp-c-border);
}

/* COMMON SECTION STYLES (Linear / Raycast Craftsmanship) */
.section-container {
  margin: 92px 0;
  position: relative;
}

.section-title-wrap {
  text-align: center;
  margin-bottom: 48px;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.section-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px 5px 10px;
  border-radius: 9999px;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  margin-bottom: 16px;
  border: 1px solid transparent;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
}

.section-kicker:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
}

.kicker-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 8px currentColor;
  opacity: 0.9;
}

.kicker-label {
  font-weight: 700;
  letter-spacing: 0.02em;
  font-size: 0.8rem;
}

.kicker-sep {
  opacity: 0.3;
  font-weight: 300;
  font-size: 0.72rem;
  margin: 0 1px;
}

.kicker-sub {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  opacity: 0.82;
  text-transform: uppercase;
  font-family: var(--vp-font-family-mono, ui-monospace, SFMono-Regular, monospace);
}

/* Kicker color themes with high-contrast, tuned light & dark modes */
.kicker-blue {
  background: rgba(29, 125, 250, 0.08);
  border-color: rgba(29, 125, 250, 0.24);
  color: #1a6edb;
}
.dark .kicker-blue {
  background: rgba(29, 125, 250, 0.14);
  border-color: rgba(29, 125, 250, 0.38);
  color: #60a5fa;
}

.kicker-emerald {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.24);
  color: #0d9468;
}
.dark .kicker-emerald {
  background: rgba(16, 185, 129, 0.14);
  border-color: rgba(16, 185, 129, 0.38);
  color: #34d399;
}

.kicker-coral {
  background: rgba(244, 63, 94, 0.08);
  border-color: rgba(244, 63, 94, 0.24);
  color: #e11d48;
}
.dark .kicker-coral {
  background: rgba(244, 63, 94, 0.14);
  border-color: rgba(244, 63, 94, 0.38);
  color: #fb7185;
}

.kicker-purple {
  background: rgba(139, 92, 246, 0.08);
  border-color: rgba(139, 92, 246, 0.24);
  color: #7c3aed;
}
.dark .kicker-purple {
  background: rgba(139, 92, 246, 0.14);
  border-color: rgba(139, 92, 246, 0.38);
  color: #a78bfa;
}

/* Headings with deliberate scale & letter spacing */
.section-h2 {
  font-size: clamp(1.85rem, 3.2vw, 2.35rem);
  font-weight: 800;
  color: var(--vp-c-text-1);
  margin: 0 0 14px 0;
  border: none;
  letter-spacing: -0.025em;
  line-height: 1.25;
}

/* Section descriptions: Balanced text wrapping, perfect line breaks without orphans */
.section-p {
  font-size: 1.05rem;
  color: var(--vp-c-text-2);
  max-width: 680px;
  margin: 0 auto;
  line-height: 1.7;
  text-wrap: balance;
  word-break: break-word;
}

/* 3. THREE STEPS GRID */
.three-steps-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}

.step-modern-card {
  position: relative;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  border-radius: 20px;
  padding: 32px 26px;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  flex-direction: column;
}

.step-modern-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.08);
}

.step-card-1:hover { border-color: #ff6b6b; }
.step-card-2:hover { border-color: #1D7DFA; }
.step-card-3:hover { border-color: #10b981; }

.step-num-glow {
  position: absolute;
  top: 20px;
  right: 24px;
  font-size: 2.8rem;
  font-weight: 900;
  line-height: 1;
  opacity: 0.15;
  user-select: none;
}

.glow-coral { color: #ff6b6b; }
.glow-blue { color: #1D7DFA; }
.glow-green { color: #10b981; }

.step-icon-circle {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
}

.icon-coral {
  background: rgba(255, 107, 107, 0.12);
  color: #ff6b6b;
}

.icon-blue {
  background: rgba(29, 125, 250, 0.12);
  color: #1D7DFA;
}

.icon-green {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
}

.step-h3 {
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin: 0 0 12px 0;
  border: none;
}

.step-p {
  font-size: 0.94rem;
  color: var(--vp-c-text-2);
  line-height: 1.7;
  margin: 0 0 20px 0;
  flex: 1;
}

.code-pill {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-brand-1);
  font-size: 0.88em;
  cursor: pointer;
  border: 1px solid var(--vp-c-border);
}

.code-pill:hover {
  border-color: var(--vp-c-brand-1);
}

.step-footer-action {
  border-top: 1px dashed var(--vp-c-border);
  padding-top: 14px;
}

.link-download {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--vp-c-brand-1) !important;
  text-decoration: none !important;
}

.link-download:hover {
  text-decoration: underline !important;
}

.status-indicator-tag {
  font-size: 0.82rem;
  color: var(--vp-c-text-3);
}

/* 4. BENTO GRID FEATURES */
.bento-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.bento-card {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  border-radius: 20px;
  padding: 30px 26px;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  flex-direction: column;
}

.bento-card:hover {
  transform: translateY(-3px);
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 14px 36px rgba(29, 125, 250, 0.1);
}

.bento-col-2 {
  grid-column: span 2;
}

.bento-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.bento-icon-box {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bg-blue { background: rgba(29, 125, 250, 0.12); color: #1D7DFA; }
.bg-emerald { background: rgba(16, 185, 129, 0.12); color: #10b981; }
.bg-amber { background: rgba(245, 158, 11, 0.12); color: #f59e0b; }
.bg-purple { background: rgba(139, 92, 246, 0.12); color: #8b5cf6; }
.bg-rose { background: rgba(244, 63, 94, 0.12); color: #f43f5e; }

.bento-badge {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 9999px;
  letter-spacing: 0.02em;
  border: 1px solid transparent;
}

.badge-blue {
  background: rgba(29, 125, 250, 0.1);
  color: #1D7DFA;
  border-color: rgba(29, 125, 250, 0.25);
}
.badge-emerald {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.25);
}
.badge-amber {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
  border-color: rgba(245, 158, 11, 0.25);
}
.badge-purple {
  background: rgba(139, 92, 246, 0.1);
  color: #8b5cf6;
  border-color: rgba(139, 92, 246, 0.25);
}
.badge-rose {
  background: rgba(244, 63, 94, 0.1);
  color: #f43f5e;
  border-color: rgba(244, 63, 94, 0.25);
}

.bento-h3 {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin: 0 0 10px 0;
  border: none;
}

.bento-p {
  font-size: 0.92rem;
  color: var(--vp-c-text-2);
  line-height: 1.65;
  margin: 0;
}

/* 5. DUAL SCENARIOS */
.scenarios-dual-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.scenario-box {
  background: var(--vp-c-bg);
  border-radius: 20px;
  padding: 34px 30px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.04);
}

.scenario-border-coral {
  border: 1.5px solid rgba(255, 107, 107, 0.35);
}

.scenario-border-blue {
  border: 1.5px solid rgba(29, 125, 250, 0.35);
}

.scenario-top {
  margin-bottom: 28px;
}

.scenario-pill {
  font-size: 0.74rem;
  font-weight: 700;
  padding: 4px 12px;
  border-radius: 9999px;
  display: inline-block;
  margin-bottom: 12px;
  letter-spacing: 0.03em;
  border: 1px solid transparent;
}

.pill-coral {
  background: rgba(255, 107, 107, 0.1);
  color: #ff6b6b;
  border-color: rgba(255, 107, 107, 0.28);
}

.pill-blue {
  background: rgba(29, 125, 250, 0.1);
  color: #1D7DFA;
  border-color: rgba(29, 125, 250, 0.28);
}

.scenario-h3 {
  font-size: 1.4rem;
  font-weight: 800;
  margin: 0 0 6px 0;
  border: none;
  color: var(--vp-c-text-1);
}

.scenario-sub {
  font-size: 0.92rem;
  color: var(--vp-c-text-2);
  margin: 0;
}

.flow-steps {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.flow-step {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.flow-num {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 800;
  color: #fff;
  flex-shrink: 0;
  margin-top: 2px;
}

.num-coral { background: #ff6b6b; }
.num-blue { background: #1D7DFA; }

.flow-info strong {
  display: block;
  font-size: 0.98rem;
  color: var(--vp-c-text-1);
  margin-bottom: 4px;
}

.flow-info p {
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
  line-height: 1.55;
  margin: 0;
}

/* =============================================================
   6. THE CREATIVE DUEL ARENA & INTERACTIVE DIMENSION COMPASS
   ============================================================= */
.section-why-ferry {
  margin: 100px 0;
}

.duel-arena {
  display: grid;
  grid-template-columns: 1fr 48px 1fr;
  align-items: stretch;
  gap: 16px;
  margin-bottom: 40px;
  position: relative;
}

.duel-card {
  border-radius: 24px;
  padding: 34px 28px;
  display: flex;
  flex-direction: column;
  position: relative;
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.card-vulnerable {
  background: var(--vp-c-bg);
  border: 1.5px solid rgba(244, 63, 94, 0.22);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.03);
}

.card-vulnerable:hover {
  border-color: rgba(244, 63, 94, 0.45);
  box-shadow: 0 16px 40px rgba(244, 63, 94, 0.08);
}

.card-champion {
  background: linear-gradient(180deg, rgba(29, 125, 250, 0.07) 0%, rgba(16, 185, 129, 0.03) 100%, var(--vp-c-bg) 100%);
  border: 1.5px solid rgba(29, 125, 250, 0.38);
  box-shadow: 0 16px 48px rgba(29, 125, 250, 0.1);
  overflow: hidden;
}

.card-champion:hover {
  transform: translateY(-2px);
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 20px 60px rgba(29, 125, 250, 0.18);
}

.champion-glow {
  position: absolute;
  top: -80px;
  right: -80px;
  width: 220px;
  height: 220px;
  background: radial-gradient(circle, rgba(29, 125, 250, 0.25) 0%, transparent 70%);
  pointer-events: none;
  filter: blur(40px);
}

.duel-card-header {
  margin-bottom: 24px;
}

.duel-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 0.76rem;
  font-weight: 700;
  padding: 4px 12px;
  border-radius: 9999px;
  margin-bottom: 12px;
}

.badge-warning {
  background: rgba(244, 63, 94, 0.08);
  color: #f43f5e;
  border: 1px solid rgba(244, 63, 94, 0.25);
}

.badge-champion {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.28);
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.dot-red { background: #f43f5e; box-shadow: 0 0 6px #f43f5e; }
.dot-green { background: #10b981; box-shadow: 0 0 6px #10b981; }

.duel-title {
  font-size: 1.35rem;
  font-weight: 800;
  color: var(--vp-c-text-1);
  margin: 0 0 8px 0;
  border: none;
  letter-spacing: -0.02em;
}

.duel-desc {
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
  line-height: 1.6;
  margin: 0;
}

.duel-items-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.duel-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  transition: all 0.2s ease;
}

.item-bad:hover {
  border-color: rgba(244, 63, 94, 0.3);
}

.item-good:hover {
  border-color: var(--vp-c-brand-1);
  background: rgba(29, 125, 250, 0.05);
}

.item-icon-box {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.05rem;
  flex-shrink: 0;
  margin-top: 1px;
}

.icon-bad {
  background: rgba(244, 63, 94, 0.1);
}

.icon-good {
  background: rgba(16, 185, 129, 0.12);
}

.item-content {
  flex: 1;
}

.item-title {
  display: block;
  font-size: 0.94rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin-bottom: 3px;
}

.item-text {
  font-size: 0.86rem;
  color: var(--vp-c-text-2);
  line-height: 1.55;
  margin: 0;
}

/* Duel Center VS Divider */
.duel-center-divider {
  display: flex;
  align-items: center;
  justify-content: center;
}

.vs-circle {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: var(--vp-c-bg-soft);
  border: 1.5px solid var(--vp-c-border);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
}

.vs-text {
  font-size: 0.8rem;
  font-weight: 900;
  color: var(--vp-c-text-2);
  letter-spacing: 0.05em;
  font-family: var(--vp-font-family-mono, monospace);
}

/* 6.2 INTERACTIVE DIMENSION COMPASS */
.dimension-interactive-box {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  border-radius: 24px;
  padding: 30px 28px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.04);
}

.interactive-box-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--vp-c-border);
  padding-bottom: 18px;
}

.interactive-pill {
  font-size: 0.74rem;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 9999px;
  background: rgba(139, 92, 246, 0.1);
  color: #8b5cf6;
  border: 1px solid rgba(139, 92, 246, 0.25);
  display: inline-block;
  margin-bottom: 6px;
}

.interactive-h3 {
  font-size: 1.18rem;
  font-weight: 800;
  color: var(--vp-c-text-1);
  margin: 0;
  border: none;
}

.dimension-nav-track {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.dimension-nav-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 13px;
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  color: var(--vp-c-text-2);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.dimension-nav-btn:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-brand-1);
  transform: translateY(-1px);
}

.dimension-nav-btn.active {
  background: var(--vp-c-brand-1);
  color: #fff;
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 4px 14px rgba(29, 125, 250, 0.35);
}

.dimension-detail-card {
  background: var(--vp-c-bg-soft);
  border-radius: 18px;
  border: 1px solid var(--vp-c-border);
  padding: 24px 26px;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.detail-split-row {
  display: grid;
  grid-template-columns: 1fr auto 1.1fr;
  align-items: stretch;
  gap: 24px;
}

.detail-col {
  display: flex;
  flex-direction: column;
}

.col-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.chip-bad {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(244, 63, 94, 0.1);
  color: #f43f5e;
  border: 1px solid rgba(244, 63, 94, 0.25);
}

.chip-good {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.25);
}

.col-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin: 0;
  border: none;
}

.col-desc {
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
  line-height: 1.65;
  margin: 0 0 16px 0;
  flex: 1;
}

.col-footer-tag {
  font-size: 0.74rem;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: 8px;
  align-self: flex-start;
  font-family: var(--vp-font-family-mono, monospace);
}

.tag-risk {
  background: rgba(244, 63, 94, 0.08);
  color: #f43f5e;
  border: 1px solid rgba(244, 63, 94, 0.2);
}

.tag-safe {
  background: rgba(16, 185, 129, 0.08);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.col-footer-flex {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.col-deep-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--vp-c-brand-1) !important;
  text-decoration: none !important;
  transition: all 0.2s ease;
}

.col-deep-link:hover {
  text-decoration: underline !important;
  transform: translateX(2px);
}

.detail-col-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
}

.arrow-pill {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--vp-c-brand-1);
  font-size: 0.95rem;
  font-weight: bold;
}

/* 7. CTA BANNER */
.cta-banner-section {
  margin-top: 90px;
}

.cta-banner-card {
  background: linear-gradient(135deg, rgba(29, 125, 250, 0.12) 0%, rgba(6, 182, 212, 0.08) 100%);
  border: 1px solid rgba(29, 125, 250, 0.25);
  border-radius: 24px;
  padding: 56px 36px;
  text-align: center;
  position: relative;
  overflow: hidden;
}

.cta-banner-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; height: 3px;
  background: linear-gradient(90deg, #1D7DFA, #00d2ff, #10b981);
}

.cta-title {
  font-size: 2.1rem;
  font-weight: 800;
  color: var(--vp-c-text-1);
  margin: 0 0 14px 0;
  border: none;
}

.cta-desc {
  font-size: 1.05rem;
  color: var(--vp-c-text-2);
  max-width: 580px;
  margin: 0 auto 32px auto;
  line-height: 1.6;
}

.cta-actions {
  display: flex;
  justify-content: center;
  gap: 16px;
  flex-wrap: wrap;
}

.cta-primary-btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 14px 30px;
  border-radius: 12px;
  background: linear-gradient(135deg, #1D7DFA 0%, #0056cc 100%);
  color: #fff !important;
  font-weight: 700;
  font-size: 1.02rem;
  box-shadow: 0 8px 24px rgba(29, 125, 250, 0.35);
  text-decoration: none !important;
  transition: all 0.25s ease;
}

.cta-primary-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(29, 125, 250, 0.48);
}

.cta-secondary-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 14px 24px;
  border-radius: 12px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  color: var(--vp-c-text-1) !important;
  font-weight: 600;
  font-size: 1rem;
  text-decoration: none !important;
  transition: all 0.2s ease;
}

.cta-secondary-btn:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1) !important;
}

/* RESPONSIVE DESIGN */
@media (max-width: 960px) {
  .hero-main-title {
    font-size: 2.5rem;
  }
  .three-steps-grid {
    grid-template-columns: 1fr;
  }
  .bento-grid {
    grid-template-columns: 1fr;
  }
  .bento-col-2 {
    grid-column: span 1;
  }
  .scenarios-dual-grid {
    grid-template-columns: 1fr;
  }
  .duel-arena {
    grid-template-columns: 1fr;
  }
  .duel-center-divider {
    display: none;
  }
  .detail-split-row {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .detail-col-arrow {
    transform: rotate(90deg);
    padding: 6px 0;
  }
  .quick-stats-bar {
    flex-direction: column;
    gap: 16px;
  }
  .stat-divider {
    display: none;
  }
}

@media (max-width: 640px) {
  .hero-main-title {
    font-size: 2rem;
  }
  .hero-actions {
    flex-direction: column;
    align-items: stretch;
  }
  .action-btn-primary, .action-btn-secondary, .action-btn-ghost {
    justify-content: center;
  }
  .cta-banner-card {
    padding: 36px 20px;
  }
}
</style>
