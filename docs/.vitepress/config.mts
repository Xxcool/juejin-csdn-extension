import { defineConfig } from 'vitepress'

const base = process.env.VITEPRESS_BASE || (process.env.GITHUB_ACTIONS ? '/juejin-csdn-extension/' : '/')

export default defineConfig({
  title: '文章摆渡 | 掘金同步助手',
  titleTemplate: ':title · 文章摆渡',
  description: '面向技术创作者的端侧安全内容摆渡中枢 · 一处专注写作，优雅摆渡全网阵地',
  base,
  cleanUrls: true,
  ignoreDeadLinks: true,
  lastUpdated: true,
  vite: {
    css: {
      postcss: {}
    }
  },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: `${base}favicon.png` }],
    ['link', { rel: 'shortcut icon', href: `${base}favicon.ico` }],
    ['meta', { name: 'theme-color', content: '#1D7DFA' }],
    ['meta', { name: 'keywords', content: '掘金, CSDN, 文章同步, 掘金同步助手, 文章摆渡, Chrome扩展, Markdown, 图床转存, 草稿幂等, Manifest V3' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: '文章摆渡 · 掘金同步助手' }],
    ['meta', { property: 'og:description', content: '面向技术创作者的端侧安全内容摆渡中枢。一处专注写作，优雅摆渡全网阵地，消灭机械搬运与格式清洗。' }],
    ['meta', { property: 'og:image', content: `${base}logo-128.png` }]
  ],
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: '文章摆渡',
    nav: [
      { text: '首页', link: '/' },
      { text: '使用指南', link: '/guide/' },
      { text: '核心特性', link: '/features/sync-engine' },
      { text: '架构与安全', link: '/deep-dive/pipeline' },
      { text: '产品规划', link: '/roadmap/' },
      { text: '更新日志', link: '/changelog/' },
      { text: '部署方案', link: '/deployment/' },
      {
        text: 'v0.6.0',
        items: [
          { text: 'GitHub Releases', link: 'https://github.com/Xxcool/juejin-csdn-extension/releases' },
          { text: '接口兼容状态', link: 'https://xxcool.github.io/juejin-csdn-extension/status.html' }
        ]
      }
    ],
    sidebar: {
      '/guide/': [
        {
          text: '使用指南',
          items: [
            { text: '项目介绍与原则', link: '/guide/' },
            { text: '安装与加载', link: '/guide/installation' },
            { text: '3 分钟快速上手', link: '/guide/quick-start' },
            { text: '排版预演 (Dry-run)', link: '/guide/dry-run' },
            { text: '常见问题与排错', link: '/guide/faq' }
          ]
        },
        {
          text: '更多了解',
          items: [
            { text: '核心特性深剖', link: '/features/sync-engine' },
            { text: '底层架构与安全', link: '/deep-dive/pipeline' }
          ]
        }
      ],
      '/features/': [
        {
          text: '核心特性',
          items: [
            { text: '智能同步引擎', link: '/features/sync-engine' },
            { text: '原图转存与清洗', link: '/features/image-pipeline' },
            { text: '草稿幂等与自愈', link: '/features/idempotence' },
            { text: '旗舰工艺 UI 2.0', link: '/features/ui-craftsmanship' }
          ]
        },
        {
          text: '相关文档',
          items: [
            { text: '使用指南', link: '/guide/' },
            { text: '架构与安全', link: '/deep-dive/pipeline' }
          ]
        }
      ],
      '/deep-dive/': [
        {
          text: '架构与安全',
          items: [
            { text: '摆渡链路与状态机', link: '/deep-dive/pipeline' },
            { text: '零信任隐私底座', link: '/deep-dive/security-privacy' }
          ]
        },
        {
          text: '产品演进',
          items: [
            { text: '全景路线图', link: '/roadmap/' },
            { text: '版本更新日志', link: '/changelog/' }
          ]
        }
      ],
      '/roadmap/': [
        {
          text: '规划与演进',
          items: [
            { text: '产品全景路线图', link: '/roadmap/' }
          ]
        }
      ],
      '/changelog/': [
        {
          text: '版本履历',
          items: [
            { text: '更新日志', link: '/changelog/' }
          ]
        }
      ],
      '/deployment/': [
        {
          text: '部署方案',
          items: [
            { text: '部署方案完全指南', link: '/deployment/' }
          ]
        }
      ]
    },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '搜索文档',
            buttonAriaLabel: '搜索文档'
          },
          modal: {
            noResultsText: '未找到相关结果',
            resetButtonTitle: '清除查询条件',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭'
            }
          }
        }
      }
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Xxcool/juejin-csdn-extension' }
    ],
    footer: {
      message: '基于 MIT 协议开源 · 面向技术创作者的轻量、端侧安全内容中枢',
      copyright: 'Copyright © 2026-present 文章摆渡 (Article Ferry) 团队'
    },
    outline: {
      level: [2, 3],
      label: '本页目录'
    },
    docFooter: {
      prev: '上一篇',
      next: '下一篇'
    },
    lastUpdated: {
      text: '最后更新于'
    }
  }
})
