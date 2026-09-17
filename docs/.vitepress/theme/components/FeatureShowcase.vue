<script setup>
const features = [
  {
    iconBg: 'rgba(29, 125, 250, 0.12)',
    iconColor: '#1D7DFA',
    title: '发文无感秒级摆渡',
    desc: '在掘金发文抽屉中勾选触发，后台秒级完成原图转存与草稿落盘，完全不阻塞掘金正常发文与审核，消灭 90% 搬运耗时。',
    svgPath: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z'
  },
  {
    iconBg: 'rgba(16, 185, 129, 0.12)',
    iconColor: '#10b981',
    title: '双身份草稿幂等自愈',
    desc: '基于 article_id 与 draft_id 双重映射，二次修改发文原地覆盖草稿；遇删稿 400 自动降级新建自愈，严格保护已发布博文。',
    svgPath: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'
  },
  {
    iconBg: 'rgba(245, 158, 11, 0.12)',
    iconColor: '#f59e0b',
    title: '高清图床去水印',
    desc: '智能剔除掘金 CDN 的 ~tplv- 模板缩放与 OSS 裁剪水印参数，三路并发转存无损原图，特有容器转译为通用 Markdown。',
    svgPath: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z'
  },
  {
    iconBg: 'rgba(139, 92, 246, 0.12)',
    iconColor: '#8b5cf6',
    title: '排版预演 (Dry-run)',
    desc: '零副作用纯内存静态排版体检，字数、分类、外链图与语法风险一览无余，全程不写草稿、不传图片，从源头杜绝测试废稿。',
    svgPath: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z'
  },
  {
    iconBg: 'rgba(239, 68, 68, 0.12)',
    iconColor: '#ef4444',
    title: '零 Cookie 纯端侧安全',
    desc: '不申请 cookies 权限，零第三方中转服务器，所有清洗与网络请求均在本地浏览器闭环执行，创作者资产 100% 由自己掌控。',
    svgPath: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z'
  },
  {
    iconBg: 'rgba(6, 182, 212, 0.12)',
    iconColor: '#06b6d4',
    title: '旗舰工艺 UI 2.0',
    desc: 'Raycast 质感设计、物理弹簧滑块、呼吸光晕、微胶囊筛选轨与自适应深色模式，多图长耗时任务支持 Chrome 原生系统桌面通知。',
    svgPath: 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01'
  }
]
</script>

<template>
  <section class="feature-showcase-section">
    <div class="section-header">
      <div class="section-tag">功能特性</div>
      <h2 class="section-title">为技术创作者量身打造</h2>
      <p class="section-subtitle">深度集成掘金创作生态，与生产 ➔ 预演 ➔ 转存 ➔ 幂等 ➔ 审核的全链路体验深度对齐</p>
    </div>

    <div class="feature-grid">
      <div v-for="(item, idx) in features" :key="idx" class="feature-card">
        <div class="feature-icon-wrapper" :style="{ background: item.iconBg, color: item.iconColor }">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path :d="item.svgPath"></path>
          </svg>
        </div>
        <h3 class="feature-card-title">{{ item.title }}</h3>
        <p class="feature-card-desc">{{ item.desc }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.feature-showcase-section {
  margin: 56px 0;
}

.section-header {
  text-align: center;
  margin-bottom: 36px;
}

.section-tag {
  display: inline-block;
  font-size: 0.8rem;
  font-weight: 600;
  padding: 4px 14px;
  border-radius: 9999px;
  background: rgba(29, 125, 250, 0.12);
  color: var(--vp-c-brand-1);
  margin-bottom: 12px;
  letter-spacing: 0.5px;
}

.section-title {
  font-size: 2rem;
  font-weight: 700;
  margin: 0 0 10px 0;
  border: none;
  color: var(--vp-c-text-1);
}

.section-subtitle {
  font-size: 1rem;
  color: var(--vp-c-text-2);
  margin: 0 auto;
  max-width: 620px;
  line-height: 1.5;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.feature-card {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  border-radius: 16px;
  padding: 26px 22px;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  flex-direction: column;
}

.feature-card:hover {
  transform: translateY(-3px);
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 8px 30px rgba(29, 125, 250, 0.12);
}

.feature-icon-wrapper {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 18px;
}

.feature-card-title {
  font-size: 1.15rem;
  font-weight: 700;
  margin: 0 0 10px 0;
  border: none;
  color: var(--vp-c-text-1);
}

.feature-card-desc {
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
  line-height: 1.6;
  margin: 0;
}

@media (max-width: 960px) {
  .feature-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .feature-grid {
    grid-template-columns: 1fr;
  }
}
</style>
