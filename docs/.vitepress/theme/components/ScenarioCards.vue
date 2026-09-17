<script setup>
</script>

<template>
  <section class="scenario-section">
    <div class="section-header">
      <div class="section-tag">使用方式</div>
      <h2 class="section-title">两种核心触发场景</h2>
      <p class="section-subtitle">无论是刚发布的新博文，还是想补发迁移历史技术积累，都有丝滑顺畅的对应路径</p>
    </div>

    <div class="scenario-grid">
      <!-- Scenario 1 -->
      <div class="scenario-card scenario-card-orange">
        <div class="scenario-header">
          <div class="scenario-icon scenario-icon-orange">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </div>
          <div class="scenario-header-text">
            <h3 class="scenario-name">场景一：发文时即时同步</h3>
            <span class="scenario-badge">掘金发文流程中无感触发</span>
          </div>
        </div>

        <div class="scenario-step-list">
          <div class="scenario-step-item">
            <span class="num-circle num-circle-orange">1</span>
            <div class="step-desc">
              在掘金 Markdown 编辑器写完博文，点击右上角<strong>「发布」</strong>
            </div>
          </div>
          <div class="scenario-step-item">
            <span class="num-circle num-circle-orange">2</span>
            <div class="step-desc">
              发文抽屉中默认勾选<strong>「同步到 CSDN 草稿」</strong>，专栏智能匹配
            </div>
          </div>
          <div class="scenario-step-item">
            <span class="num-circle num-circle-orange">3</span>
            <div class="step-desc">
              点击<strong>「确定并发布」</strong>，后台秒级完成原图转存与草稿幂等落盘
            </div>
          </div>
        </div>
      </div>

      <!-- Scenario 2 -->
      <div class="scenario-card scenario-card-blue">
        <div class="scenario-header">
          <div class="scenario-icon scenario-icon-blue">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
          </div>
          <div class="scenario-header-text">
            <h3 class="scenario-name">场景二：历史博文批量迁移</h3>
            <span class="scenario-badge">掘金创作者中心文章列表触发</span>
          </div>
        </div>

        <div class="scenario-step-list">
          <div class="scenario-step-item">
            <span class="num-circle num-circle-blue">1</span>
            <div class="step-desc">
              打开掘金<strong>「创作者中心 ➔ 内容管理 ➔ 文章管理」</strong>列表
            </div>
          </div>
          <div class="scenario-step-item">
            <span class="num-circle num-circle-blue">2</span>
            <div class="step-desc">
              找到需要迁移的文章，点击右侧专属的<strong>「摆渡到 CSDN」</strong>按钮
            </div>
          </div>
          <div class="scenario-step-item">
            <span class="num-circle num-circle-blue">3</span>
            <div class="step-desc">
              后台串行限速反查原始 Markdown 转存，在弹窗中点击<strong>「草稿 ↗」</strong>检阅发布
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.scenario-section {
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
  max-width: 600px;
  line-height: 1.5;
}

.scenario-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.scenario-card {
  background: var(--vp-c-bg);
  border-radius: 16px;
  padding: 32px 28px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.scenario-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08);
}

.scenario-card-orange {
  border: 1.5px solid rgba(255, 107, 107, 0.35);
}
.scenario-card-orange:hover {
  border-color: #ff6b6b;
}

.scenario-card-blue {
  border: 1.5px solid rgba(29, 125, 250, 0.35);
}
.scenario-card-blue:hover {
  border-color: #1D7DFA;
}

.scenario-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}

.scenario-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.scenario-icon-orange {
  background: rgba(255, 107, 107, 0.12);
  color: #ff6b6b;
}

.scenario-icon-blue {
  background: rgba(29, 125, 250, 0.12);
  color: #1D7DFA;
}

.scenario-header-text {
  display: flex;
  flex-direction: column;
}

.scenario-name {
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0 0 4px 0;
  border: none;
  color: var(--vp-c-text-1);
}

.scenario-badge {
  font-size: 0.82rem;
  color: var(--vp-c-text-2);
}

.scenario-step-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.scenario-step-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.num-circle {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
  margin-top: 2px;
}

.num-circle-orange {
  background: #ff6b6b;
}

.num-circle-blue {
  background: #1D7DFA;
}

.step-desc {
  font-size: 0.95rem;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}

@media (max-width: 800px) {
  .scenario-grid {
    grid-template-columns: 1fr;
  }
}
</style>
