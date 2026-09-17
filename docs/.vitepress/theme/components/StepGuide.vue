<script setup>
</script>

<template>
  <section class="step-guide-section">
    <div class="section-header">
      <div class="section-tag">安装教程</div>
      <h2 class="section-title">三步开始使用</h2>
      <p class="section-subtitle">无需注册第三方账号，安装即用，支持 Chrome / Edge / Brave / 360 等所有 Chromium 浏览器</p>
    </div>

    <div class="steps-container">
      <!-- Step 1 -->
      <div class="step-card step-card-orange">
        <div class="step-badge step-badge-orange">1</div>
        <h3 class="step-title">安装插件</h3>
        <p class="step-text">
          在上方下载 ZIP 压缩包并解压至本地目录；打开浏览器访问
          <code class="step-code">chrome://extensions</code>
          并开启右上角<strong>「开发者模式」</strong>，点击左上角<strong>「加载已解压的扩展程序」</strong>选择解压文件夹即可完成安装。
        </p>
        <div class="step-tip">
          <span>💡 提示：将图标固定在工具栏，使用更便捷</span>
        </div>
      </div>

      <div class="step-arrow">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </div>

      <!-- Step 2 -->
      <div class="step-card step-card-blue">
        <div class="step-badge step-badge-blue">2</div>
        <h3 class="step-title">登录掘金与 CSDN</h3>
        <p class="step-text">
          在同一浏览器中正常登录掘金与 CSDN 网页端。插件遵循<strong>零 Cookie 权限与端侧闭环</strong>原则，直接复用当前标签页的安全会话，绝不索取任何账号密码，数据绝不上传第三方服务器。
        </p>
        <div class="step-tip">
          <span>🟢 插件顶栏绿灯亮起即代表就绪</span>
        </div>
      </div>

      <div class="step-arrow">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </div>

      <!-- Step 3 -->
      <div class="step-card step-card-green">
        <div class="step-badge step-badge-green">3</div>
        <h3 class="step-title">一键同步摆渡</h3>
        <p class="step-text">
          在掘金写完文章后，发文抽屉中已默认勾选<strong>「同步到 CSDN 草稿」</strong>，点击发文即可后台秒级摆渡；也可在历史文章列表中一键批量摆渡。文章以草稿安全落地，确认无误后手动发布。
        </p>
        <div class="step-tip">
          <span>⛵ 尊重原创，坚决不替创作者直接公开发布</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.step-guide-section {
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
  background: rgba(255, 107, 107, 0.12);
  color: #ff6b6b;
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
  max-width: 600px;
  line-height: 1.5;
}

.steps-container {
  display: flex;
  align-items: stretch;
  gap: 16px;
  position: relative;
}

.step-card {
  flex: 1;
  background: var(--vp-c-bg);
  border-radius: 16px;
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
}

.step-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08);
}

.step-card-orange {
  border: 1.5px solid rgba(255, 107, 107, 0.35);
}
.step-card-orange:hover {
  border-color: #ff6b6b;
}

.step-card-blue {
  border: 1.5px solid rgba(29, 125, 250, 0.35);
}
.step-card-blue:hover {
  border-color: #1D7DFA;
}

.step-card-green {
  border: 1.5px solid rgba(16, 185, 129, 0.35);
}
.step-card-green:hover {
  border-color: #10b981;
}

.step-badge {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.15rem;
  font-weight: 700;
  color: #fff;
  margin-bottom: 18px;
}

.step-badge-orange {
  background: linear-gradient(135deg, #ff8e53 0%, #ff6b6b 100%);
  box-shadow: 0 4px 12px rgba(255, 107, 107, 0.3);
}

.step-badge-blue {
  background: linear-gradient(135deg, #3a8dfc 0%, #1D7DFA 100%);
  box-shadow: 0 4px 12px rgba(29, 125, 250, 0.3);
}

.step-badge-green {
  background: linear-gradient(135deg, #34d399 0%, #10b981 100%);
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}

.step-title {
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0 0 12px 0;
  border: none;
  color: var(--vp-c-text-1);
}

.step-text {
  font-size: 0.92rem;
  color: var(--vp-c-text-2);
  line-height: 1.65;
  margin: 0 0 18px 0;
  flex: 1;
}

.step-code {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--vp-c-bg-soft);
  font-size: 0.85em;
  color: var(--vp-c-brand-1);
}

.step-tip {
  font-size: 0.82rem;
  color: var(--vp-c-text-3);
  padding-top: 12px;
  border-top: 1px dashed var(--vp-c-border);
}

.step-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--vp-c-text-3);
  opacity: 0.6;
}

@media (max-width: 900px) {
  .steps-container {
    flex-direction: column;
    gap: 20px;
  }
  .step-arrow {
    transform: rotate(90deg);
    margin: -8px 0;
  }
}
</style>
