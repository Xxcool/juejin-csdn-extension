// 知乎专栏适配器：管理知乎同源 Bridge 通信、登录检查、图片转存与私有草稿保存。
import {md5} from 'js-md5';
import type {Article,TaskProgress} from '../types';
import type {AdapterResult} from './adapter';
import {SyncError} from '../core/diagnostic';
import {downloadImageBlob,normalizeMarkdown} from './csdn-api';
import {collectZhihuImages,compileZhihuHtml,replaceZhihuImages,validateZhihuArticle} from './zhihu-content';
import {renderAllMermaidBlocks} from '../core/mermaid-render';

export type ZhihuAuth = {
  ok: boolean;
  loggedIn: boolean;
  account?: string;
  accountId?: string;
  message?: string;
};

export type ZhihuDraftState = 'draft' | 'published' | 'missing' | 'unauthorized' | 'unknown';

interface ZhihuSession {
  tabId: number;
  createdByUs: boolean;
  accountId: string;
  account: string;
}

export interface SaveOptions {
  articleId?: string;
  expectedAccountId?: string;
  appendSourceLink?: boolean;
  syncCover?: boolean;
  onPreparing?: () => void | Promise<void>;
  onProgress?: (progress: TaskProgress) => void | Promise<void>;
  onSaving?: () => void | Promise<void>;
  onDraftCreated?: (articleId: string, draftUrl: string) => void | Promise<void>;
}

/** 发送消息给知乎页面的 Bridge Content Script */
async function sendBridgeMessage<T = any>(tabId: number, action: string, payload?: any): Promise<T> {
  try {
    const res = await chrome.tabs.sendMessage(tabId, {
      target: 'zhihu-bridge',
      action,
      payload
    });
    return res as T;
  } catch (error) {
    throw new SyncError(`与知乎页面通信失败: ${(error as Error).message}`, 'interrupted', 'draft');
  }
}

/** 测试指定的 tab 是否已就绪 Bridge */
async function pingTab(tabId: number): Promise<boolean> {
  try {
    const res = await chrome.tabs.sendMessage(tabId, {
      target: 'zhihu-bridge',
      action: 'PING'
    });
    return res?.ok === true;
  } catch {
    return false;
  }
}

/** 查询或创建可用知乎专栏标签页 */
export async function acquireZhihuTab(): Promise<{ tabId: number; createdByUs: boolean }> {
  // 1. 查询是否已有打开的专栏页面
  const existingTabs = await chrome.tabs.query({ url: '*://zhuanlan.zhihu.com/*' });
  for (const tab of existingTabs) {
    if (tab.id && (await pingTab(tab.id))) {
      return { tabId: tab.id, createdByUs: false };
    }
  }

  // 2. 没有可用标签页，新建非激活的专栏编辑页
  const newTab = await chrome.tabs.create({
    url: 'https://zhuanlan.zhihu.com/write',
    active: false
  });
  if (!newTab.id) {
    throw new SyncError('无法创建知乎专栏标签页', 'platform-change', 'authentication');
  }

  const tabId = newTab.id;
  // 轮询等待 Bridge 加载就绪（最多等待 12 秒）
  const maxRetries = 24;
  for (let i = 0; i < maxRetries; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await pingTab(tabId)) {
      return { tabId, createdByUs: true };
    }
  }

  // 超时清理临时创建的 tab
  await chrome.tabs.remove(tabId).catch(() => {});
  throw new SyncError('知乎专栏页面加载超时，请检查网络或重新登录知乎', 'network', 'authentication');
}

/** 安全释放标签页：仅关闭扩展创建的临时页，绝不关闭用户自己的标签页 */
export async function releaseZhihuTab(session: { tabId: number; createdByUs: boolean }) {
  if (session.createdByUs && session.tabId) {
    await chrome.tabs.remove(session.tabId).catch(() => {});
  }
}

/** 检测知乎登录状态（优先通过 background fetch 探针，若已有标签页则通过 Bridge） */
export async function checkZhihuAuth(): Promise<ZhihuAuth> {
  // 先尝试直接请求 /api/v4/me（轻量快速，不打扰用户）
  try {
    const res = await fetch('https://www.zhihu.com/api/v4/me', {
      method: 'GET',
      credentials: 'include',
      signal: AbortSignal.timeout(7000)
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: true, loggedIn: false };
    }
    if (res.ok) {
      const data = await res.json();
      const accountId = String(data.url_token || data.id || '');
      return {
        ok: true,
        loggedIn: Boolean(accountId),
        account: data.name || data.url_token || '知乎用户',
        accountId
      };
    }
  } catch {
    // 忽略直接请求错误，降级到已有 tab Bridge 探测
  }

  // 检查是否有打开的知乎标签页并借助 Bridge 探测
  try {
    const tabs = await chrome.tabs.query({ url: '*://zhuanlan.zhihu.com/*' });
    for (const tab of tabs) {
      if (tab.id && (await pingTab(tab.id))) {
        const bridgeAuth = await sendBridgeMessage<ZhihuAuth>(tab.id, 'GET_SESSION');
        if (bridgeAuth.ok) return bridgeAuth;
      }
    }
  } catch {}

  return { ok: true, loggedIn: false };
}

/** 读取知乎草稿远端状态 */
export async function fetchZhihuDraftState(articleId: string, expectedAccountId?: string): Promise<ZhihuDraftState> {
  let tabSession: { tabId: number; createdByUs: boolean } | undefined;
  try {
    tabSession = await acquireZhihuTab();
    const res = await sendBridgeMessage<{
      ok: boolean;
      exists?: boolean;
      status?: string;
      draft?: { authorId?: string; state?: string };
    }>(tabSession.tabId, 'GET_DRAFT', { articleId });

    if (!res.ok) {
      if (res.status === 'unauthorized') return 'unauthorized';
      return 'unknown';
    }
    if (res.exists === false || res.status === 'missing') {
      return 'missing';
    }
    if (res.status === 'published' || res.draft?.state !== 'draft') {
      return 'published';
    }
    if (expectedAccountId && res.draft?.authorId && res.draft.authorId !== expectedAccountId) {
      return 'unauthorized';
    }
    return 'draft';
  } catch {
    return 'unknown';
  } finally {
    if (tabSession) await releaseZhihuTab(tabSession);
  }
}

/** 计算阿里云 OSS HMAC-SHA1 签名 */
async function hmacSha1Base64(keyStr: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const keyData = enc.encode(keyStr);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** 上传单张图片（优先 URL 服务端转存，失败时二进制上传） */
async function uploadZhihuImage(src: string, tabId: number): Promise<string> {
  // 1. 如果是普通 http/https URL，优先尝试知乎服务端转存
  if (/^https?:\/\//i.test(src)) {
    try {
      const res = await sendBridgeMessage<{ ok: boolean; url?: string }>(tabId, 'UPLOAD_IMAGE_URL', { url: src });
      if (res?.ok && res.url) {
        return res.url;
      }
    } catch {
      // 服务端转存失败降级为客户端下载并二进制上传
    }
  }

  // 2. 二进制上传链路（适用于 Data URL、Mermaid 图片以及转存失败的外链）
  let blob: Blob;
  if (src.startsWith('data:')) {
    const [header, base64] = src.split(',');
    const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
    const binary = atob(base64);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
    blob = new Blob([array], { type: mime });
  } else {
    blob = await downloadImageBlob(src);
  }

  const arrayBuffer = await blob.arrayBuffer();
  const hash = md5(arrayBuffer);

  const initRes = await sendBridgeMessage<{
    ok: boolean;
    exists?: boolean;
    url?: string;
    state?: number;
    uploadFile?: { upload_url?: string; image_id?: string; object_key?: string; header?: Record<string, string> };
    uploadToken?: { access_id: string; access_key: string; access_token: string };
    objectKey?: string;
    imageId?: string;
  }>(tabId, 'CREATE_IMAGE_UPLOAD', {
    md5: hash,
    size: blob.size,
    type: blob.type || 'image/png'
  });

  if (!initRes?.ok) {
    throw new Error('获取图片上传凭据失败');
  }

  // 图片若已存在直接复用
  if (initRes.url) {
    return initRes.url;
  }

  const imageId = initRes.imageId || initRes.uploadFile?.image_id;
  let objectKey = initRes.objectKey || initRes.uploadFile?.object_key;

  // 如果已存在状态（state === 1），优先等待就绪或构造 URL
  if (initRes.state === 1 && imageId) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const pollRes = await sendBridgeMessage<{ ok: boolean; status?: string; url?: string; original_hash?: string }>(tabId, 'POLL_IMAGE', { imageId });
      if (pollRes?.ok) {
        if (pollRes.url) return pollRes.url;
        if (pollRes.original_hash) return `https://pic4.zhimg.com/${pollRes.original_hash}`;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    if (objectKey) {
      return `https://pic4.zhimg.com/${objectKey}`;
    }
  }

  // 上传至 OSS（使用知乎临时 STS Token 凭据进行 HMAC-SHA1 签名）
  if (initRes.uploadToken && objectKey) {
    const token = initRes.uploadToken;
    const contentType = blob.type || 'application/octet-stream';
    const ossDate = new Date().toUTCString();
    const ossUserAgent = 'aliyun-sdk-js/6.8.0';

    const ossHeaders: Record<string, string> = {
      'x-oss-date': ossDate,
      'x-oss-security-token': token.access_token,
      'x-oss-user-agent': ossUserAgent
    };
    const canonicalizedOSSHeaders = Object.keys(ossHeaders)
      .sort()
      .map(k => `${k}:${ossHeaders[k]}`)
      .join('\n');

    const bucket = 'zhihu-pics';
    const canonicalizedResource = `/${bucket}/${objectKey}`;

    const stringToSign =
      'PUT\n' +
      '\n' +
      contentType + '\n' +
      ossDate + '\n' +
      canonicalizedOSSHeaders + '\n' +
      canonicalizedResource;

    const signature = await hmacSha1Base64(token.access_key, stringToSign);
    const authorization = `OSS ${token.access_id}:${signature}`;

    const ossUrl = `https://zhihu-pics-upload.zhimg.com/${objectKey}`;
    const putRes = await fetch(ossUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Authorization': authorization,
        'x-oss-date': ossDate,
        'x-oss-security-token': token.access_token,
        'x-oss-user-agent': ossUserAgent
      },
      body: blob,
      signal: AbortSignal.timeout(30000)
    });

    if (!putRes.ok) {
      throw new Error(`知乎图片上传至 OSS 失败 (${putRes.status})`);
    }

    if (blob.type === 'image/gif' && !objectKey.endsWith('.gif')) {
      objectKey = objectKey + '.gif';
    }
  } else if (initRes.uploadFile?.upload_url) {
    const uploadUrl = initRes.uploadFile.upload_url;
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': blob.type || 'image/png',
        ...(initRes.uploadFile.header || {})
      },
      body: blob,
      signal: AbortSignal.timeout(30000)
    });
    if (!putRes.ok) {
      throw new Error(`图片上传至存储服务失败 (${putRes.status})`);
    }
  }

  // 轮询直到图片就绪
  if (imageId) {
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(r => setTimeout(r, 600));
      const pollRes = await sendBridgeMessage<{ ok: boolean; status?: string; url?: string; original_hash?: string }>(tabId, 'POLL_IMAGE', {
        imageId
      });
      if (pollRes?.ok) {
        if (pollRes.url) return pollRes.url;
        if (pollRes.original_hash) return `https://pic4.zhimg.com/${pollRes.original_hash}`;
      }
    }
  }

  if (objectKey) {
    return `https://pic4.zhimg.com/${objectKey}`;
  }

  throw new Error('知乎图片处理超时，无法获取图片链接');
}

/** 执行知乎私有文章草稿的新建或更新 */
export async function saveZhihuDraft(article: Article, options: SaveOptions = {}): Promise<AdapterResult> {
  validateZhihuArticle(article);

  // 获取知乎标签页与 Bridge
  const tabSession = await acquireZhihuTab();

  try {
    // 校验登录状态与账号绑定
    const auth = await sendBridgeMessage<ZhihuAuth>(tabSession.tabId, 'GET_SESSION');
    if (!auth.ok || !auth.loggedIn || !auth.accountId) {
      throw new SyncError('请先登录知乎专栏', 'login', 'authentication');
    }
    if (options.expectedAccountId && auth.accountId !== options.expectedAccountId) {
      throw new SyncError('当前知乎账号与任务创建时不一致，已阻止覆盖草稿', 'blocked', 'authentication');
    }

    // 若指定了目标文章 ID，执行更新前回读校验
    if (options.articleId) {
      const draftInfo = await sendBridgeMessage<{
        ok: boolean;
        exists?: boolean;
        status?: string;
        draft?: { authorId?: string; state?: string };
      }>(tabSession.tabId, 'GET_DRAFT', { articleId: options.articleId });

      if (!draftInfo.ok) {
        throw new SyncError('无法读取知乎原有草稿，已暂停更新', 'blocked', 'draft');
      }
      if (draftInfo.status === 'published' || draftInfo.draft?.state !== 'draft') {
        throw new SyncError('该知乎文章已公开发布，为避免覆盖线上内容已阻断同步', 'blocked', 'draft');
      }
      if (draftInfo.draft?.authorId && draftInfo.draft.authorId !== auth.accountId) {
        throw new SyncError('当前知乎账号无权修改此草稿，请切换回原账号', 'blocked', 'authentication');
      }
    }

    await options.onPreparing?.();

    // Markdown 预处理与离屏 Mermaid 渲染
    let markdown = normalizeMarkdown(article.markdown);
    if (options.appendSourceLink !== false && article.sourceUrl) {
      markdown += `\n\n---\n\n本文首发于掘金：[查看原文](${article.sourceUrl})`;
    }

    const mermaidImages = await renderAllMermaidBlocks(markdown);
    let html = compileZhihuHtml(markdown, { mermaidImages });

    // 收集所有需要转存的图片
    const rawImages = collectZhihuImages(html);
    const total = rawImages.length;
    const replacements = new Map<string, string>();
    const transfers: { src: string; target?: string; error?: string }[] = [];

    for (let index = 0; index < total; index++) {
      const src = rawImages[index];
      await options.onProgress?.({
        current: index + 1,
        total,
        message: `正在转存知乎图片 ${index + 1}/${total}`
      });

      try {
        const target = await uploadZhihuImage(src, tabSession.tabId);
        replacements.set(src, target);
        transfers.push({ src, target });
      } catch (error) {
        const errMessage = (error as Error).message || '未知错误';
        transfers.push({ src, error: errMessage });
        // 遵循 abort 策略：图片失败立即停止写入草稿正文
        throw new SyncError(`图片转存失败，已停止保存知乎草稿：${errMessage}`, 'content', 'images');
      }
    }

    // 替换所有转存后的图片链接
    html = replaceZhihuImages(html, replacements);

    // 封面处理：转存知乎题图并绑定 titleImage
    let titleImage: string | undefined;
    const warnings: string[] = [];
    let coverUploaded = false;
    let coverFailed = false;

    if (options.syncCover !== false && article.cover !== undefined) {
      const trimmedCover = article.cover.trim();
      if (!trimmedCover) {
        titleImage = '';
      } else {
        const reused = replacements.get(trimmedCover);
        if (reused) {
          titleImage = reused;
        } else {
          try {
            await options.onProgress?.({
              current: total + 1,
              total: total + 1,
              message: '正在转存知乎文章封面'
            });
            titleImage = await uploadZhihuImage(trimmedCover, tabSession.tabId);
            coverUploaded = true;
          } catch (coverErr) {
            coverFailed = true;
            warnings.push(`文章封面转存失败: ${(coverErr as Error).message || '未知错误'}，已保留正文保存草稿`);
          }
        }
      }
    }

    // 写入前再次校验账号没有在上传期间被切换
    const reAuth = await sendBridgeMessage<ZhihuAuth>(tabSession.tabId, 'GET_SESSION');
    if (!reAuth.ok || reAuth.accountId !== auth.accountId) {
      throw new SyncError('知乎登录账号在同步过程中发生变更，已阻断写入', 'blocked', 'authentication');
    }

    await options.onSaving?.();

    const draftPayload: { title: string; content: string; titleImage?: string } = {
      title: article.title,
      content: html,
      ...(titleImage !== undefined ? { titleImage } : {})
    };

    let finalArticleId = options.articleId;
    let draftUrl = '';

    if (finalArticleId) {
      // 场景 1：更新已有草稿，直接 PATCH 写入
      const updateRes = await sendBridgeMessage<{ ok: boolean; articleId?: string; draftUrl?: string; message?: string }>(
        tabSession.tabId,
        'UPDATE_DRAFT',
        {
          articleId: finalArticleId,
          ...draftPayload
        }
      );
      if (!updateRes.ok || !updateRes.articleId) {
        throw new SyncError(updateRes.message || '知乎草稿保存失败，请检查草稿箱确认结果', 'interrupted', 'draft');
      }
      finalArticleId = String(updateRes.articleId);
      draftUrl = updateRes.draftUrl || `https://zhuanlan.zhihu.com/p/${finalArticleId}/edit`;
    } else {
      // 场景 2：新建草稿，按知乎标准两阶段契约进行：
      // 第一阶段：POST /api/articles/drafts 创建初始草稿占位，获得文章 ID
      const createRes = await sendBridgeMessage<{ ok: boolean; articleId?: string; draftUrl?: string; message?: string }>(
        tabSession.tabId,
        'CREATE_DRAFT',
        {
          title: article.title
        }
      );
      if (!createRes.ok || !createRes.articleId) {
        throw new SyncError(createRes.message || '创建知乎草稿失败，请检查知乎账号状态', 'interrupted', 'draft');
      }
      finalArticleId = String(createRes.articleId);
      draftUrl = createRes.draftUrl || `https://zhuanlan.zhihu.com/p/${finalArticleId}/edit`;

      // 阶段 1 成功：第一时间回调持久化已分配的 draft ID 与编辑链接，防止后续网络中断丢失草稿记录
      if (options.onDraftCreated) {
        await options.onDraftCreated(finalArticleId, draftUrl);
      }

      // 第二阶段：PATCH /api/articles/{articleId}/draft 保存完整标题、正文与封面
      try {
        const patchRes = await sendBridgeMessage<{ ok: boolean; articleId?: string; draftUrl?: string; message?: string }>(
          tabSession.tabId,
          'UPDATE_DRAFT',
          {
            articleId: finalArticleId,
            ...draftPayload
          }
        );
        if (!patchRes.ok) {
          const err = new SyncError(patchRes.message || '知乎草稿正文写入失败，请检查草稿箱确认结果', 'interrupted', 'draft');
          (err as any).articleId = finalArticleId;
          (err as any).draftUrl = draftUrl;
          throw err;
        }
        draftUrl = patchRes.draftUrl || draftUrl;
      } catch (patchErr: any) {
        if (!patchErr.articleId) patchErr.articleId = finalArticleId;
        if (!patchErr.draftUrl) patchErr.draftUrl = draftUrl;
        throw patchErr;
      }
    }

    try {
      // 写后深度回读校验：确保草稿确实保存成功且状态为 draft，正文不为空
      const verifyRes = await sendBridgeMessage<{
        ok: boolean;
        exists?: boolean;
        status?: string;
        draft?: { authorId?: string; state?: string; content?: string; title?: string };
      }>(tabSession.tabId, 'GET_DRAFT', { articleId: finalArticleId });

      if (!verifyRes.ok || !verifyRes.exists) {
        throw new SyncError('知乎草稿已写入但回读校验未通过，请前往知乎草稿箱核验', 'interrupted', 'draft');
      }

      if (html.trim() && verifyRes.draft?.content !== undefined) {
        const remoteContent = verifyRes.draft.content.trim();
        if (!remoteContent) {
          throw new SyncError('知乎草稿已创建但远端正文为空，请前往知乎草稿箱核验', 'interrupted', 'draft');
        }
      }
    } catch (verifyErr: any) {
      if (finalArticleId) {
        if (!verifyErr.articleId) verifyErr.articleId = finalArticleId;
        if (!verifyErr.draftUrl) verifyErr.draftUrl = draftUrl;
      }
      throw verifyErr;
    }

    const extraTotal = (coverUploaded || coverFailed) ? 1 : 0;
    const extraSucceeded = coverUploaded ? 1 : 0;
    const extraFailed = coverFailed ? 1 : 0;

    return {
      articleId: finalArticleId,
      draftUrl,
      warnings,
      stats: {
        imageTotal: total + extraTotal,
        imageSucceeded: replacements.size + extraSucceeded,
        imageFailed: extraFailed
      }
    };
  } finally {
    await releaseZhihuTab(tabSession);
  }
}
