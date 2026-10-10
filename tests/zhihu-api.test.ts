import {describe,it,expect,vi,beforeEach} from 'vitest';
import {checkZhihuAuth,fetchZhihuDraftState,saveZhihuDraft} from '../src/targets/zhihu-api';
import {parseZhihuDraftResponse} from '../src/zhihu-bridge';
import {SyncError} from '../src/core/diagnostic';
import type {Article} from '../src/types';

describe('知乎 API 适配器与 Bridge 契约', () => {
  const dummyArticle: Article = {
    id: 'juejin-123',
    title: '知乎同步测试文章',
    markdown: '## 测试标题\n\n这是一篇用于验证同步契约的知乎正文。',
    tags: ['前端'],
    sourceUrl: 'https://juejin.cn/post/123'
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    // 默认 mock 全局 fetch 为 404（迫使降级或模拟 Bridge）
    global.fetch = vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
      json: async () => ({})
    } as any);

    // Mock chrome tabs API
    (global as any).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 101, url: 'https://zhuanlan.zhihu.com/write' }]),
        create: vi.fn().mockResolvedValue({ id: 102 }),
        remove: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockImplementation((tabId, msg) => {
          if (msg.target === 'zhihu-bridge') {
            if (msg.action === 'PING') return Promise.resolve({ ok: true });
            if (msg.action === 'GET_SESSION') {
              return Promise.resolve({
                ok: true,
                loggedIn: true,
                account: '测试知友',
                accountId: 'user-xyz'
              });
            }
          }
          return Promise.resolve({ ok: true });
        })
      }
    };
  });

  it('checkZhihuAuth: 成功获取登录账号与稳定标识', async () => {
    // 模拟直接 API 探针成功
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        id: 9999,
        url_token: 'zhihu_tester',
        name: '知乎体验官'
      })
    } as any);

    const auth = await checkZhihuAuth();
    expect(auth.ok).toBe(true);
    expect(auth.loggedIn).toBe(true);
    expect(auth.account).toBe('知乎体验官');
    expect(auth.accountId).toBe('zhihu_tester');
  });

  it('checkZhihuAuth: 未登录时返回 loggedIn=false', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 401,
      ok: false
    } as any);

    const auth = await checkZhihuAuth();
    expect(auth.ok).toBe(true);
    expect(auth.loggedIn).toBe(false);
  });

  it('fetchZhihuDraftState: 识别 draft, published, missing 与 unauthorized', async () => {
    // 1. draft
    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, msg: any) => {
      if (msg.action === 'PING') return Promise.resolve({ ok: true });
      if (msg.action === 'GET_DRAFT') {
        return Promise.resolve({
          ok: true,
          exists: true,
          status: 'draft',
          draft: { state: 'draft', authorId: 'user-xyz' }
        });
      }
      return Promise.resolve({ ok: true });
    });
    expect(await fetchZhihuDraftState('12345', 'user-xyz')).toBe('draft');

    // 2. published
    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, msg: any) => {
      if (msg.action === 'PING') return Promise.resolve({ ok: true });
      if (msg.action === 'GET_DRAFT') {
        return Promise.resolve({
          ok: true,
          exists: true,
          status: 'published',
          draft: { state: 'published', authorId: 'user-xyz' }
        });
      }
      return Promise.resolve({ ok: true });
    });
    expect(await fetchZhihuDraftState('12345', 'user-xyz')).toBe('published');

    // 3. missing
    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, msg: any) => {
      if (msg.action === 'PING') return Promise.resolve({ ok: true });
      if (msg.action === 'GET_DRAFT') {
        return Promise.resolve({
          ok: true,
          exists: false,
          status: 'missing'
        });
      }
      return Promise.resolve({ ok: true });
    });
    expect(await fetchZhihuDraftState('12345', 'user-xyz')).toBe('missing');

    // 4. unauthorized (切号后作者不一致)
    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, msg: any) => {
      if (msg.action === 'PING') return Promise.resolve({ ok: true });
      if (msg.action === 'GET_DRAFT') {
        return Promise.resolve({
          ok: true,
          exists: true,
          status: 'draft',
          draft: { state: 'draft', authorId: 'another-user' }
        });
      }
      return Promise.resolve({ ok: true });
    });
    expect(await fetchZhihuDraftState('12345', 'user-xyz')).toBe('unauthorized');
  });

  it('saveZhihuDraft: 新建草稿走创建占位加更新正文两阶段流程，回读校验后返回草稿链接', async () => {
    let createdCall = false;
    let updatedPayload: any = null;
    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, msg: any) => {
      if (msg.action === 'PING') return Promise.resolve({ ok: true });
      if (msg.action === 'GET_SESSION') {
        return Promise.resolve({
          ok: true,
          loggedIn: true,
          accountId: 'user-xyz',
          account: '测试知友'
        });
      }
      if (msg.action === 'CREATE_DRAFT') {
        createdCall = true;
        return Promise.resolve({
          ok: true,
          articleId: '88889999',
          draftUrl: 'https://zhuanlan.zhihu.com/p/88889999/edit'
        });
      }
      if (msg.action === 'UPDATE_DRAFT') {
        updatedPayload = msg.payload;
        return Promise.resolve({
          ok: true,
          articleId: '88889999',
          draftUrl: 'https://zhuanlan.zhihu.com/p/88889999/edit'
        });
      }
      if (msg.action === 'GET_DRAFT') {
        return Promise.resolve({
          ok: true,
          exists: true,
          status: 'draft',
          draft: { state: 'draft', authorId: 'user-xyz', content: '<p>正文内容</p>' }
        });
      }
      return Promise.resolve({ ok: true });
    });

    const result = await saveZhihuDraft(dummyArticle);
    expect(result.articleId).toBe('88889999');
    expect(result.draftUrl).toBe('https://zhuanlan.zhihu.com/p/88889999/edit');
    expect(createdCall).toBe(true);
    expect(updatedPayload.articleId).toBe('88889999');
    expect(updatedPayload.content).toContain('这是一篇用于验证同步契约的知乎正文');
    expect(result.stats.imageFailed).toBe(0);
  });

  it('saveZhihuDraft: 更新草稿前校验已发布，阻断覆盖并抛错', async () => {
    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, msg: any) => {
      if (msg.action === 'PING') return Promise.resolve({ ok: true });
      if (msg.action === 'GET_SESSION') {
        return Promise.resolve({
          ok: true,
          loggedIn: true,
          accountId: 'user-xyz'
        });
      }
      if (msg.action === 'GET_DRAFT') {
        return Promise.resolve({
          ok: true,
          exists: true,
          status: 'published',
          draft: { state: 'published', authorId: 'user-xyz' }
        });
      }
      return Promise.resolve({ ok: true });
    });

    await expect(saveZhihuDraft(dummyArticle, { articleId: '88889999' })).rejects.toThrow(
      '该知乎文章已公开发布，为避免覆盖线上内容已阻断同步'
    );
  });

  it('saveZhihuDraft: 图片上传失败遵循 abort 策略，不写入草稿正文', async () => {
    const articleWithImage: Article = {
      ...dummyArticle,
      markdown: '![测试图片](https://example.com/fail.png)'
    };

    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, msg: any) => {
      if (msg.action === 'PING') return Promise.resolve({ ok: true });
      if (msg.action === 'GET_SESSION') {
        return Promise.resolve({
          ok: true,
          loggedIn: true,
          accountId: 'user-xyz'
        });
      }
      if (msg.action === 'UPLOAD_IMAGE_URL') {
        return Promise.resolve({
          ok: false,
          message: '图片下载失败'
        });
      }
      if (msg.action === 'CREATE_IMAGE_UPLOAD') {
        return Promise.resolve({
          ok: false,
          message: 'OSS 上传服务不可用'
        });
      }
      return Promise.resolve({ ok: true });
    });

    await expect(saveZhihuDraft(articleWithImage)).rejects.toThrow(SyncError);
  });

  it('saveZhihuDraft: 远程 URL 转存失败时降级二进制上传，正确解析 uploadFile.image_id 并完成 OSS 写入', async () => {
    const articleWithImage: Article = {
      ...dummyArticle,
      markdown: '![测试图片](https://example.com/photo.png)'
    };

    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      if (url.includes('example.com')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
        } as any);
      }
      if (url.includes('zhihu-pics-upload')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => ''
        } as any);
      }
      return Promise.resolve({ ok: false, status: 404 } as any);
    });

    let draftContent = '';
    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, msg: any) => {
      if (msg.action === 'PING') return Promise.resolve({ ok: true });
      if (msg.action === 'GET_SESSION') {
        return Promise.resolve({
          ok: true,
          loggedIn: true,
          accountId: 'user-xyz'
        });
      }
      if (msg.action === 'UPLOAD_IMAGE_URL') {
        // 模拟远程转存 403 失败（触发本地二进制上传）
        return Promise.resolve({
          ok: false,
          status: 403,
          message: '远程转存失败'
        });
      }
      if (msg.action === 'CREATE_IMAGE_UPLOAD') {
        return Promise.resolve({
          ok: true,
          exists: false,
          uploadFile: {
            image_id: 'img-7890',
            object_key: 'v2-osskey123',
            state: 0
          },
          uploadToken: {
            access_id: 'sts-id',
            access_key: 'sts-secret',
            access_token: 'sts-token'
          },
          imageId: 'img-7890',
          objectKey: 'v2-osskey123'
        });
      }
      if (msg.action === 'POLL_IMAGE') {
        expect(msg.payload.imageId).toBe('img-7890');
        return Promise.resolve({
          ok: true,
          status: 'completed',
          original_hash: 'v2-finalhash123'
        });
      }
      if (msg.action === 'CREATE_DRAFT') {
        return Promise.resolve({
          ok: true,
          articleId: 'draft-999',
          draftUrl: 'https://zhuanlan.zhihu.com/p/draft-999/edit'
        });
      }
      if (msg.action === 'UPDATE_DRAFT') {
        draftContent = msg.payload.content;
        return Promise.resolve({
          ok: true,
          articleId: 'draft-999',
          draftUrl: 'https://zhuanlan.zhihu.com/p/draft-999/edit'
        });
      }
      if (msg.action === 'GET_DRAFT') {
        return Promise.resolve({
          ok: true,
          exists: true,
          status: 'draft',
          draft: { state: 'draft', authorId: 'user-xyz', content: draftContent || '<p>正文</p>' }
        });
      }
      return Promise.resolve({ ok: true });
    });

    const result = await saveZhihuDraft(articleWithImage);
    expect(result.articleId).toBe('draft-999');
    expect(draftContent).toContain('https://pic4.zhimg.com/v2-finalhash123');
  });

  it('saveZhihuDraft: 同步封面并正确传递 titleImage 给知乎草稿', async () => {
    const articleWithCover: Article = {
      ...dummyArticle,
      cover: 'https://example.com/cover.png'
    };

    let updatedPayload: any = null;
    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, msg: any) => {
      if (msg.action === 'PING') return Promise.resolve({ ok: true });
      if (msg.action === 'GET_SESSION') {
        return Promise.resolve({
          ok: true,
          loggedIn: true,
          accountId: 'user-xyz'
        });
      }
      if (msg.action === 'UPLOAD_IMAGE_URL') {
        if (msg.payload.url === 'https://example.com/cover.png') {
          return Promise.resolve({
            ok: true,
            url: 'https://pic4.zhimg.com/v2-cover123.png'
          });
        }
      }
      if (msg.action === 'CREATE_DRAFT') {
        return Promise.resolve({
          ok: true,
          articleId: 'draft-cover-1',
          draftUrl: 'https://zhuanlan.zhihu.com/p/draft-cover-1/edit'
        });
      }
      if (msg.action === 'UPDATE_DRAFT') {
        updatedPayload = msg.payload;
        return Promise.resolve({
          ok: true,
          articleId: 'draft-cover-1',
          draftUrl: 'https://zhuanlan.zhihu.com/p/draft-cover-1/edit'
        });
      }
      if (msg.action === 'GET_DRAFT') {
        return Promise.resolve({
          ok: true,
          exists: true,
          status: 'draft',
          draft: { state: 'draft', authorId: 'user-xyz', content: '<p>正文内容</p>' }
        });
      }
      return Promise.resolve({ ok: true });
    });

    const result = await saveZhihuDraft(articleWithCover, { syncCover: true });
    expect(result.articleId).toBe('draft-cover-1');
    expect(updatedPayload.titleImage).toBe('https://pic4.zhimg.com/v2-cover123.png');
    expect(result.stats.imageTotal).toBe(1);
    expect(result.stats.imageSucceeded).toBe(1);
  });

  it('saveZhihuDraft: 当封面与正文图片相同时，直接复用正文转存结果不重复上传', async () => {
    const sharedImg = 'https://example.com/shared.png';
    const articleShared: Article = {
      ...dummyArticle,
      cover: sharedImg,
      markdown: `![正文配图](${sharedImg})`
    };

    let uploadCount = 0;
    let updatedPayload: any = null;
    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, msg: any) => {
      if (msg.action === 'PING') return Promise.resolve({ ok: true });
      if (msg.action === 'GET_SESSION') {
        return Promise.resolve({
          ok: true,
          loggedIn: true,
          accountId: 'user-xyz'
        });
      }
      if (msg.action === 'UPLOAD_IMAGE_URL') {
        uploadCount++;
        return Promise.resolve({
          ok: true,
          url: 'https://pic4.zhimg.com/v2-shared999.png'
        });
      }
      if (msg.action === 'CREATE_DRAFT') {
        return Promise.resolve({
          ok: true,
          articleId: 'draft-shared-1',
          draftUrl: 'https://zhuanlan.zhihu.com/p/draft-shared-1/edit'
        });
      }
      if (msg.action === 'UPDATE_DRAFT') {
        updatedPayload = msg.payload;
        return Promise.resolve({
          ok: true,
          articleId: 'draft-shared-1',
          draftUrl: 'https://zhuanlan.zhihu.com/p/draft-shared-1/edit'
        });
      }
      if (msg.action === 'GET_DRAFT') {
        return Promise.resolve({
          ok: true,
          exists: true,
          status: 'draft',
          draft: { state: 'draft', authorId: 'user-xyz', content: '<p>配图正文</p>' }
        });
      }
      return Promise.resolve({ ok: true });
    });

    const result = await saveZhihuDraft(articleShared, { syncCover: true });
    expect(result.articleId).toBe('draft-shared-1');
    expect(uploadCount).toBe(1); // 仅上传一次，封面复用
    expect(updatedPayload.titleImage).toBe('https://pic4.zhimg.com/v2-shared999.png');
    expect(updatedPayload.content).toContain('https://pic4.zhimg.com/v2-shared999.png');
  });

  it('saveZhihuDraft: 封面转存失败时容错降级，记录 warning 并正常保存正文草稿', async () => {
    const articleFailCover: Article = {
      ...dummyArticle,
      cover: 'https://example.com/bad-cover.png'
    };

    let updatedPayload: any = null;
    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, msg: any) => {
      if (msg.action === 'PING') return Promise.resolve({ ok: true });
      if (msg.action === 'GET_SESSION') {
        return Promise.resolve({
          ok: true,
          loggedIn: true,
          accountId: 'user-xyz'
        });
      }
      if (msg.action === 'UPLOAD_IMAGE_URL') {
        return Promise.resolve({
          ok: false,
          message: '封面非法格式'
        });
      }
      if (msg.action === 'CREATE_IMAGE_UPLOAD') {
        return Promise.resolve({
          ok: false,
          message: 'OSS 上传服务不可用'
        });
      }
      if (msg.action === 'CREATE_DRAFT') {
        return Promise.resolve({
          ok: true,
          articleId: 'draft-fallback-1',
          draftUrl: 'https://zhuanlan.zhihu.com/p/draft-fallback-1/edit'
        });
      }
      if (msg.action === 'UPDATE_DRAFT') {
        updatedPayload = msg.payload;
        return Promise.resolve({
          ok: true,
          articleId: 'draft-fallback-1',
          draftUrl: 'https://zhuanlan.zhihu.com/p/draft-fallback-1/edit'
        });
      }
      if (msg.action === 'GET_DRAFT') {
        return Promise.resolve({
          ok: true,
          exists: true,
          status: 'draft',
          draft: { state: 'draft', authorId: 'user-xyz', content: '<p>正文内容</p>' }
        });
      }
      return Promise.resolve({ ok: true });
    });

    const result = await saveZhihuDraft(articleFailCover, { syncCover: true });
    expect(result.articleId).toBe('draft-fallback-1');
    expect(updatedPayload.titleImage).toBeUndefined();
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('文章封面转存失败');
    expect(result.stats.imageFailed).toBe(1);
  });

  it('saveZhihuDraft: syncCover=false 时不传递 titleImage', async () => {
    const articleWithCover: Article = {
      ...dummyArticle,
      cover: 'https://example.com/cover.png'
    };

    let updatedPayload: any = null;
    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, msg: any) => {
      if (msg.action === 'PING') return Promise.resolve({ ok: true });
      if (msg.action === 'GET_SESSION') {
        return Promise.resolve({
          ok: true,
          loggedIn: true,
          accountId: 'user-xyz'
        });
      }
      if (msg.action === 'CREATE_DRAFT') {
        return Promise.resolve({
          ok: true,
          articleId: 'draft-nocover-1',
          draftUrl: 'https://zhuanlan.zhihu.com/p/draft-nocover-1/edit'
        });
      }
      if (msg.action === 'UPDATE_DRAFT') {
        updatedPayload = msg.payload;
        return Promise.resolve({
          ok: true,
          articleId: 'draft-nocover-1',
          draftUrl: 'https://zhuanlan.zhihu.com/p/draft-nocover-1/edit'
        });
      }
      if (msg.action === 'GET_DRAFT') {
        return Promise.resolve({
          ok: true,
          exists: true,
          status: 'draft',
          draft: { state: 'draft', authorId: 'user-xyz', content: '<p>正文内容</p>' }
        });
      }
      return Promise.resolve({ ok: true });
    });

    const result = await saveZhihuDraft(articleWithCover, { syncCover: false });
    expect(result.articleId).toBe('draft-nocover-1');
    expect(updatedPayload.titleImage).toBeUndefined();
  });

  it('saveZhihuDraft: 写后回读发现远端正文为空时抛出阻断异常，防止空草稿误判成功', async () => {
    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, msg: any) => {
      if (msg.action === 'PING') return Promise.resolve({ ok: true });
      if (msg.action === 'GET_SESSION') {
        return Promise.resolve({
          ok: true,
          loggedIn: true,
          accountId: 'user-xyz'
        });
      }
      if (msg.action === 'UPDATE_DRAFT') {
        return Promise.resolve({
          ok: true,
          articleId: '12345',
          draftUrl: 'https://zhuanlan.zhihu.com/p/12345/edit'
        });
      }
      if (msg.action === 'GET_DRAFT') {
        return Promise.resolve({
          ok: true,
          exists: true,
          status: 'draft',
          // 模拟远端草稿为空
          draft: { state: 'draft', authorId: 'user-xyz', content: '' }
        });
      }
      return Promise.resolve({ ok: true });
    });

    await expect(saveZhihuDraft(dummyArticle, { articleId: '12345' })).rejects.toThrow(
      '知乎草稿已创建但远端正文为空，请前往知乎草稿箱核验'
    );
  });

  it('saveZhihuDraft: 更新草稿时兼容空响应或 204 No Content，正常完成保存', async () => {
    let updateCalled = false;
    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, msg: any) => {
      if (msg.action === 'PING') return Promise.resolve({ ok: true });
      if (msg.action === 'GET_SESSION') {
        return Promise.resolve({
          ok: true,
          loggedIn: true,
          accountId: 'user-xyz'
        });
      }
      if (msg.action === 'UPDATE_DRAFT') {
        updateCalled = true;
        // 模拟 bridge 收到 204 成功空响应并解析返回
        return Promise.resolve({
          ok: true,
          articleId: '12345',
          draftUrl: 'https://zhuanlan.zhihu.com/p/12345/edit'
        });
      }
      if (msg.action === 'GET_DRAFT') {
        return Promise.resolve({
          ok: true,
          exists: true,
          status: 'draft',
          draft: { state: 'draft', authorId: 'user-xyz', content: '<p>正文</p>' }
        });
      }
      return Promise.resolve({ ok: true });
    });

    const result = await saveZhihuDraft(dummyArticle, { articleId: '12345' });
    expect(updateCalled).toBe(true);
    expect(result.articleId).toBe('12345');
    expect(result.draftUrl).toBe('https://zhuanlan.zhihu.com/p/12345/edit');
  });

  it('saveZhihuDraft: 新建草稿两阶段写入时，POST 成功后立即触发 onDraftCreated；PATCH 失败时抛错携带已分配的 articleId 与 draftUrl', async () => {
    let capturedDraftId = '';
    let capturedDraftUrl = '';
    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, msg: any) => {
      if (msg.action === 'PING') return Promise.resolve({ ok: true });
      if (msg.action === 'GET_SESSION') {
        return Promise.resolve({
          ok: true,
          loggedIn: true,
          accountId: 'user-xyz'
        });
      }
      if (msg.action === 'CREATE_DRAFT') {
        return Promise.resolve({
          ok: true,
          articleId: '77889900',
          draftUrl: 'https://zhuanlan.zhihu.com/p/77889900/edit'
        });
      }
      if (msg.action === 'UPDATE_DRAFT') {
        // 第二阶段 PATCH 写入失败
        return Promise.resolve({
          ok: false,
          message: '知乎服务器正文保存失败'
        });
      }
      return Promise.resolve({ ok: true });
    });

    let thrownError: any;
    try {
      await saveZhihuDraft(dummyArticle, {
        onDraftCreated: (id, url) => {
          capturedDraftId = id;
          capturedDraftUrl = url;
        }
      });
    } catch (err) {
      thrownError = err;
    }

    expect(capturedDraftId).toBe('77889900');
    expect(capturedDraftUrl).toBe('https://zhuanlan.zhihu.com/p/77889900/edit');
    expect(thrownError).toBeInstanceOf(SyncError);
    expect(thrownError.articleId).toBe('77889900');
    expect(thrownError.draftUrl).toBe('https://zhuanlan.zhihu.com/p/77889900/edit');
  });

  it('saveZhihuDraft: 新建草稿在写后回读校验失败时，抛错依然保留已分配的 articleId 与 draftUrl', async () => {
    (chrome.tabs.sendMessage as any).mockImplementation((_tabId: number, msg: any) => {
      if (msg.action === 'PING') return Promise.resolve({ ok: true });
      if (msg.action === 'GET_SESSION') {
        return Promise.resolve({
          ok: true,
          loggedIn: true,
          accountId: 'user-xyz'
        });
      }
      if (msg.action === 'CREATE_DRAFT') {
        return Promise.resolve({
          ok: true,
          articleId: '66554433',
          draftUrl: 'https://zhuanlan.zhihu.com/p/66554433/edit'
        });
      }
      if (msg.action === 'UPDATE_DRAFT') {
        return Promise.resolve({
          ok: true,
          articleId: '66554433',
          draftUrl: 'https://zhuanlan.zhihu.com/p/66554433/edit'
        });
      }
      if (msg.action === 'GET_DRAFT') {
        return Promise.resolve({
          ok: false,
          message: '校验网络超时'
        });
      }
      return Promise.resolve({ ok: true });
    });

    let thrownError: any;
    try {
      await saveZhihuDraft(dummyArticle);
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(SyncError);
    expect(thrownError.articleId).toBe('66554433');
    expect(thrownError.draftUrl).toBe('https://zhuanlan.zhihu.com/p/66554433/edit');
  });
});

describe('知乎 Bridge 响应解析器 (parseZhihuDraftResponse)', () => {
  it('更新草稿时 204 No Content 空响应正确回退 fallbackId', () => {
    const res = parseZhihuDraftResponse(204, '', '12345', '更新');
    expect(res).toEqual({
      ok: true,
      articleId: '12345',
      draftUrl: 'https://zhuanlan.zhihu.com/p/12345/edit'
    });
  });

  it('更新草稿时 200 OK 空文本响应正确回退 fallbackId', () => {
    const res = parseZhihuDraftResponse(200, '   \n  ', '12345', '更新');
    expect(res).toEqual({
      ok: true,
      articleId: '12345',
      draftUrl: 'https://zhuanlan.zhihu.com/p/12345/edit'
    });
  });

  it('正常 JSON 响应正确解析包含的 articleId', () => {
    const res = parseZhihuDraftResponse(200, JSON.stringify({ id: 998877 }), '12345', '更新');
    expect(res).toEqual({
      ok: true,
      articleId: '998877',
      draftUrl: 'https://zhuanlan.zhihu.com/p/998877/edit'
    });
  });

  it('创建草稿时（无 fallbackId）空响应报错缺少文章标识', () => {
    const res = parseZhihuDraftResponse(204, '', undefined, '创建');
    expect(res.ok).toBe(false);
    expect(res.message).toContain('缺少文章标识');
  });

  it('创建草稿时（无 fallbackId）JSON 缺少 ID 报错', () => {
    const res = parseZhihuDraftResponse(200, JSON.stringify({ status: 'ok' }), undefined, '创建');
    expect(res.ok).toBe(false);
    expect(res.message).toContain('缺少文章 ID');
  });

  it('403 Forbidden 错误响应解析失败状态与提示', () => {
    const res = parseZhihuDraftResponse(403, '{"error":"Forbidden"}', '12345', '更新');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    expect(res.message).toContain('知乎草稿更新失败 (403)');
  });

  it('500 Internal Error 错误响应解析失败状态', () => {
    const res = parseZhihuDraftResponse(500, 'Internal Server Error', '12345', '更新');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
    expect(res.message).toContain('(500)');
  });

  it('非 JSON 异常文本在无 fallbackId 时报错格式错误，有 fallbackId 时容错回退', () => {
    const noFallback = parseZhihuDraftResponse(200, '<html>error</html>', undefined, '创建');
    expect(noFallback.ok).toBe(false);
    expect(noFallback.message).toContain('响应格式错误');

    const withFallback = parseZhihuDraftResponse(200, '<html>error</html>', '12345', '更新');
    expect(withFallback).toEqual({
      ok: true,
      articleId: '12345',
      draftUrl: 'https://zhuanlan.zhihu.com/p/12345/edit'
    });
  });
});

