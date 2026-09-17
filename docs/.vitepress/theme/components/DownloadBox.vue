<script setup>
import { withBase } from 'vitepress'
</script>

<template>
  <div class="ferry-download-wrapper">
    <div class="ferry-download-card">
      <div class="download-content">
        <div class="download-tag-row">
          <span class="ferry-pill">免翻直链</span>
          <span class="ferry-pill ferry-pill-sub">官方原版 ZIP 安装包</span>
        </div>
        <h3 class="download-headline">直接下载离线安装包</h3>
        <p class="download-subtext">
          国内网络无需翻墙或访问 Chrome Web Store 商店，直接下载 ZIP 压缩包，解压后拖入浏览器开发者模式即可秒级启用。
        </p>

        <div class="download-btn-group">
          <a :href="withBase('/downloads/article-ferry-latest.zip')" download class="ferry-primary-btn">
            <svg class="btn-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <div class="btn-text-wrap">
              <span class="btn-main-text">一键下载 ZIP 离线安装包</span>
              <span class="btn-sub-tag">v0.6.0 · 约 64 KB</span>
            </div>
          </a>

          <a href="https://github.com/Xxcool/juejin-csdn-extension/releases" target="_blank" rel="noopener" class="ferry-outline-btn">
            <svg class="btn-svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            <span>GitHub Releases 发行页</span>
          </a>
        </div>

        <div class="download-specs">
          <div class="spec-item">
            <span class="spec-dot"></span>
            <span>适配 Chrome / Edge / Brave / 360 等所有 Chromium 浏览器</span>
          </div>
          <div class="spec-item">
            <span class="spec-dot"></span>
            <span>Manifest V3 官方现代架构</span>
          </div>
          <div class="spec-item">
            <span class="spec-dot"></span>
            <span>100% 端侧安全 · 零 Cookie 收集</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ferry-download-wrapper {
  margin: 36px 0;
}

.ferry-download-card {
  background: linear-gradient(135deg, rgba(29, 125, 250, 0.07) 0%, rgba(29, 125, 250, 0.02) 100%);
  border: 1px solid rgba(29, 125, 250, 0.22);
  border-radius: 16px;
  padding: 32px 28px;
  position: relative;
  overflow: hidden;
  transition: all 0.3s ease;
}

.ferry-download-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, #1D7DFA, #00d2ff, #1D7DFA);
}

.download-tag-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.ferry-pill {
  font-size: 0.78rem;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 9999px;
  background: #1D7DFA;
  color: #fff;
  letter-spacing: 0.5px;
}

.ferry-pill-sub {
  background: rgba(29, 125, 250, 0.12);
  color: var(--vp-c-brand-1);
  border: 1px solid rgba(29, 125, 250, 0.2);
}

.download-headline {
  font-size: 1.55rem;
  font-weight: 700;
  margin: 0 0 8px 0;
  color: var(--vp-c-text-1);
}

.download-subtext {
  font-size: 0.95rem;
  color: var(--vp-c-text-2);
  line-height: 1.6;
  margin: 0 0 24px 0;
  max-width: 680px;
}

.download-btn-group {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  margin-bottom: 24px;
}

.ferry-primary-btn {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 12px 26px;
  background: linear-gradient(135deg, #1D7DFA 0%, #005ce6 100%);
  color: #ffffff !important;
  border-radius: 12px;
  text-decoration: none !important;
  font-weight: 600;
  box-shadow: 0 6px 20px rgba(29, 125, 250, 0.32);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.ferry-primary-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 26px rgba(29, 125, 250, 0.45);
  background: linear-gradient(135deg, #308cfc 0%, #0066ff 100%);
}

.btn-text-wrap {
  display: flex;
  flex-direction: column;
  text-align: left;
  line-height: 1.25;
}

.btn-main-text {
  font-size: 1rem;
}

.btn-sub-tag {
  font-size: 0.72rem;
  opacity: 0.88;
  font-weight: 400;
}

.ferry-outline-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-radius: 12px;
  border: 1px solid var(--vp-c-border);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1) !important;
  font-size: 0.95rem;
  font-weight: 500;
  text-decoration: none !important;
  transition: all 0.2s ease;
}

.ferry-outline-btn:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1) !important;
  transform: translateY(-1px);
}

.download-specs {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  font-size: 0.84rem;
  color: var(--vp-c-text-2);
  border-top: 1px dashed rgba(29, 125, 250, 0.18);
  padding-top: 16px;
}

.spec-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.spec-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
}

@media (max-width: 640px) {
  .ferry-download-card {
    padding: 24px 18px;
  }
  .download-btn-group {
    flex-direction: column;
    align-items: stretch;
  }
  .ferry-primary-btn, .ferry-outline-btn {
    justify-content: center;
  }
}
</style>
