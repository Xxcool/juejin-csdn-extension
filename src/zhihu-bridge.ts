// 知乎专栏同源 API Bridge：运行于 zhuanlan.zhihu.com 上下文，执行固定白名单接口动作并脱敏返回结果。
type ZhihuBridgeAction =
  | 'PING'
  | 'GET_SESSION'
  | 'GET_DRAFT'
  | 'CREATE_DRAFT'
  | 'UPDATE_DRAFT'
  | 'UPLOAD_IMAGE_URL'
  | 'CREATE_IMAGE_UPLOAD'
  | 'POLL_IMAGE';

interface BridgeMessage {
  target: 'zhihu-bridge';
  action: ZhihuBridgeAction;
  payload?: any;
}

function getXsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)_xsrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function xsrfHeaders(): HeadersInit {
  const token = getXsrfToken();
  if (!token) {
    throw new Error('未在知乎页面中找到 _xsrf 安全令牌，请刷新知乎页面后重试');
  }
  return {
    'x-xsrftoken': token
  };
}

async function handleGetSession() {
  try {
    const res = await fetch('https://www.zhihu.com/api/v4/me', {
      method: 'GET',
      credentials: 'include',
      signal: AbortSignal.timeout(10000)
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: true, loggedIn: false };
    }
    if (!res.ok) {
      return { ok: false, loggedIn: false, message: `知乎账号状态检测失败 (${res.status})` };
    }
    const data = await res.json();
    const accountId = String(data.url_token || data.id || '');
    return {
      ok: true,
      loggedIn: Boolean(accountId),
      account: data.name || data.url_token || '知乎用户',
      accountId
    };
  } catch (error) {
    return { ok: false, loggedIn: false, message: (error as Error).message || '知乎登录检测异常' };
  }
}

async function handleGetDraft(articleId: string) {
  if (!articleId || !/^\d+$/.test(String(articleId))) {
    return { ok: false, message: '无效的知乎草稿标识' };
  }
  try {
    const res = await fetch(`https://zhuanlan.zhihu.com/api/articles/${articleId}/draft`, {
      method: 'GET',
      credentials: 'include',
      signal: AbortSignal.timeout(15000)
    });
    if (res.status === 404) {
      return { ok: true, exists: false, status: 'missing' };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: 'unauthorized', message: '请先登录知乎' };
    }
    if (!res.ok) {
      return { ok: false, message: `知乎草稿读取失败 (${res.status})` };
    }
    const data = await res.json();
    const isDraft = data.state === 'draft';
    const authorId = String(data.author?.url_token || data.author?.id || '');
    return {
      ok: true,
      exists: true,
      status: isDraft ? 'draft' : 'published',
      draft: {
        id: String(data.id || articleId),
        title: data.title || '',
        state: data.state,
        authorId,
        content: typeof data.content === 'string' ? data.content : ''
      }
    };
  } catch (error) {
    return { ok: false, message: (error as Error).message || '读取知乎草稿异常' };
  }
}

export function parseZhihuDraftResponse(
  status: number,
  text: string,
  fallbackId?: string,
  actionName = '操作'
): { ok: boolean; status?: number; articleId?: string; draftUrl?: string; message?: string } {
  if (status < 200 || status >= 300) {
    const snippet = text ? `: ${text.slice(0, 160)}` : '';
    return { ok: false, status, message: `知乎草稿${actionName}失败 (${status})${snippet}` };
  }
  const trimmed = text.trim();
  if (!trimmed) {
    if (fallbackId) {
      return {
        ok: true,
        articleId: String(fallbackId),
        draftUrl: `https://zhuanlan.zhihu.com/p/${fallbackId}/edit`
      };
    }
    return { ok: false, message: `知乎草稿${actionName}响应为空且缺少文章标识` };
  }
  let data: any = {};
  try {
    data = JSON.parse(trimmed);
  } catch {
    if (fallbackId) {
      return {
        ok: true,
        articleId: String(fallbackId),
        draftUrl: `https://zhuanlan.zhihu.com/p/${fallbackId}/edit`
      };
    }
    return { ok: false, message: `知乎草稿${actionName}响应格式错误` };
  }
  const articleId = String(data.id || fallbackId || '');
  if (!articleId) {
    return { ok: false, message: `知乎草稿${actionName}响应中缺少文章 ID` };
  }
  return {
    ok: true,
    articleId,
    draftUrl: `https://zhuanlan.zhihu.com/p/${articleId}/edit`
  };
}

async function handleCreateDraft(payload: { title: string; content?: string; titleImage?: string }) {
  const { title, content, titleImage } = payload || {};
  if (!title) {
    return { ok: false, message: '草稿标题不能为空' };
  }
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...xsrfHeaders()
    };
    const body: Record<string, any> = { title: title.trim() };
    if (content !== undefined) body.content = content;
    if (titleImage !== undefined) body.titleImage = titleImage;
    const res = await fetch('https://zhuanlan.zhihu.com/api/articles/drafts', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });
    const text = await res.text();
    return parseZhihuDraftResponse(res.status, text, undefined, '创建');
  } catch (error) {
    return { ok: false, message: (error as Error).message || '创建知乎草稿网络异常' };
  }
}

async function handleUpdateDraft(payload: { articleId: string; title: string; content: string; titleImage?: string }) {
  const { articleId, title, content, titleImage } = payload || {};
  if (!articleId || !title || !content) {
    return { ok: false, message: '更新参数不完整' };
  }
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...xsrfHeaders()
    };
    const body: Record<string, any> = { title, content };
    if (titleImage !== undefined) {
      body.titleImage = titleImage;
    }
    const res = await fetch(`https://zhuanlan.zhihu.com/api/articles/${articleId}/draft`, {
      method: 'PATCH',
      credentials: 'include',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });
    const text = await res.text();
    return parseZhihuDraftResponse(res.status, text, articleId, '更新');
  } catch (error) {
    return { ok: false, message: (error as Error).message || '更新知乎草稿网络异常' };
  }
}

async function handleUploadImageUrl(url: string) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, message: '无效的图片 URL' };
  }
  try {
    const headers = {
      'x-requested-with': 'fetch',
      'Content-Type': 'application/x-www-form-urlencoded',
      ...xsrfHeaders()
    };
    const body = new URLSearchParams({ url, source: 'article' }).toString();
    const res = await fetch('https://zhuanlan.zhihu.com/api/uploaded_images', {
      method: 'POST',
      credentials: 'include',
      headers,
      body,
      signal: AbortSignal.timeout(30000)
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, message: `知乎转存图片失败 (${res.status}): ${text.slice(0, 160)}` };
    }
    const data = JSON.parse(text);
    const uploadedUrl = data.url || data.src || data.image_url || (data.hash ? `https://pic4.zhimg.com/${data.hash}` : undefined);
    if (!uploadedUrl) {
      return { ok: false, message: '知乎图片转存响应未包含图片链接' };
    }
    return { ok: true, url: uploadedUrl };
  } catch (error) {
    return { ok: false, message: (error as Error).message || '知乎图片转存网络异常' };
  }
}

async function handleCreateImageUpload(payload: { md5: string; size: number; type: string }) {
  const { md5, size, type } = payload || {};
  if (!md5) {
    return { ok: false, message: '缺少图片哈希值' };
  }
  try {
    const headers = {
      'x-requested-with': 'fetch',
      'Content-Type': 'application/json',
      ...xsrfHeaders()
    };
    const res = await fetch('https://api.zhihu.com/images', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({
        image_hash: md5,
        source: 'article',
        size,
        type
      }),
      signal: AbortSignal.timeout(30000)
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, message: `请求知乎图片上传凭据失败 (${res.status}): ${text.slice(0, 160)}` };
    }
    const data = JSON.parse(text);
    // 若图片在服务器已存在，知乎会直接返回已存在的图片 url/src
    if (data.src || data.url) {
      return {
        ok: true,
        exists: true,
        url: data.src || data.url
      };
    }
    const uploadFile = data.upload_file || {};
    const uploadToken = data.upload_token;
    const imageId = String(uploadFile.image_id || data.image_id || data.id || '');
    const objectKey = String(uploadFile.object_key || '');
    const state = typeof uploadFile.state === 'number' ? uploadFile.state : undefined;

    return {
      ok: true,
      exists: state === 1,
      state,
      uploadFile,
      uploadToken,
      objectKey,
      imageId
    };
  } catch (error) {
    return { ok: false, message: (error as Error).message || '请求知乎图片上传票据异常' };
  }
}

async function handlePollImage(imageId: string) {
  if (!imageId) {
    return { ok: false, message: '缺少 imageId' };
  }
  try {
    const res = await fetch(`https://api.zhihu.com/images/${imageId}`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'x-requested-with': 'fetch',
        ...xsrfHeaders()
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
      return { ok: false, message: `轮询知乎图片状态失败 (${res.status})` };
    }
    const data = await res.json();
    const url = data.src || data.url || (data.original_hash ? `https://pic4.zhimg.com/${data.original_hash}` : undefined);
    return {
      ok: true,
      status: data.status,
      original_hash: data.original_hash,
      url
    };
  } catch (error) {
    return { ok: false, message: (error as Error).message || '轮询知乎图片异常' };
  }
}

// 监听扩展后台发送的消息
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message: BridgeMessage, _sender, sendResponse) => {
    if (!message || message.target !== 'zhihu-bridge') return;

    (async () => {
      switch (message.action) {
        case 'PING':
          return { ok: true };
        case 'GET_SESSION':
          return await handleGetSession();
        case 'GET_DRAFT':
          return await handleGetDraft(message.payload?.articleId);
        case 'CREATE_DRAFT':
          return await handleCreateDraft(message.payload);
        case 'UPDATE_DRAFT':
          return await handleUpdateDraft(message.payload);
        case 'UPLOAD_IMAGE_URL':
          return await handleUploadImageUrl(message.payload?.url);
        case 'CREATE_IMAGE_UPLOAD':
          return await handleCreateImageUpload(message.payload);
        case 'POLL_IMAGE':
          return await handlePollImage(message.payload?.imageId);
        default:
          return { ok: false, message: `不支持的动作: ${message.action}` };
      }
    })()
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ ok: false, message: err?.message || 'Bridge 执行异常' }));

    return true; // 异步响应
  });
}

