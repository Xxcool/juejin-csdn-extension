// 同步失败诊断：把平台原始错误归类为可展示、可操作且不包含账号凭据的信息。
import type {TaskDiagnostic,TaskErrorCategory,TaskStage} from '../types';

const suggestions:Record<TaskErrorCategory,string>={
  login:'请登录对应目标平台后重新同步。',
  network:'请检查网络连接，稍后重新同步。',
  'rate-limit':'平台请求过于频繁，请稍后再试。',
  'platform-change':'平台接口或页面可能已更新，请升级插件或反馈此问题。',
  content:'请检查文章标题、正文和图片后重新同步。',
  blocked:'请核对目标账号与草稿归属，并按错误提示处理；不要直接重复写入。',
  interrupted:'请先检查目标平台草稿箱，确认保存结果后再决定是否重试。',
  unknown:'请稍后重试；若持续失败，请复制此诊断信息进行反馈。'
};

/** 结构化同步异常：抛出时即携带错误类别与发生阶段，诊断不再依赖正则猜消息。 */
export class SyncError extends Error{
  readonly category:TaskErrorCategory;
  readonly stage:TaskStage;
  constructor(message:string,category:TaskErrorCategory='unknown',stage:TaskStage='validation'){
    super(message);
    this.name='SyncError';
    this.category=category;
    this.stage=stage;
  }
}

function cleanMessage(message:string){
  return message
    .replace(/([?&](?:token|sign|signature|key|authorization)=)[^&\s]+/gi,'$1***')
    .replace(/(authorization|cookie|token|signature)\s*[:=]\s*[^\s,;]+/gi,'$1=***')
    .slice(0,500);
}

/** 兜底分类：仅用于未携带结构化信息的旧错误（如浏览器原生网络错误）。 */
function classifyMessage(message:string):TaskErrorCategory{
  let category:TaskErrorCategory='unknown';
  if(/登录|未登录|401|unauthor/i.test(message))category='login';
  else if(/429|限流|频繁|too many/i.test(message))category='rate-limit';
  else if(/标题|正文不完整|非图片内容|图片地址|图片.*失败/i.test(message))category='content';
  else if(/签名|鉴权异常|invalid signature|返回错误码|没有返回草稿标识|接口.*(?:变化|异常)|\((?:400|403|404)\)/i.test(message))category='platform-change';
  else if(/timeout|超时|failed to fetch|network|网络|连接/i.test(message))category='network';
  else if(/中断|无法确认是否已保存/i.test(message))category='interrupted';
  return category;
}

export function classifySyncError(error:unknown,stage:TaskStage):TaskDiagnostic{
  const raw=error instanceof Error?error.message:String(error||'未知错误');
  const message=cleanMessage(raw||'未知错误');
  const syncError=error instanceof SyncError?error:undefined;
  const category=syncError?.category??classifyMessage(message);
  return{stage:syncError?.stage??stage,category,message,suggestion:suggestions[category],occurredAt:new Date().toISOString()};
}

export const stageLabels:Record<TaskStage,string>={validation:'内容校验',authentication:'登录检查',content:'内容处理',images:'图片转存',draft:'草稿保存',recovery:'任务恢复'};
export const categoryLabels:Record<TaskErrorCategory,string>={login:'登录失效',network:'网络异常','rate-limit':'平台限流','platform-change':'平台接口异常',content:'内容异常',blocked:'覆盖阻断',interrupted:'任务中断',unknown:'未知异常'};
