// 后台消息契约：集中声明扩展页面可调用的消息类型，并拒绝无法识别的请求。
export const messageTypes=[
  'SYNC_NEW_ARTICLE','CHECK_CSDN_STATUS','OPEN_CSDN_LOGIN',
  'SYNC_HISTORY_ARTICLE','RESUME_PENDING_HISTORY','GET_TASKS','GET_SETTINGS','SAVE_SETTINGS','RETRY_TASK','CONFIRM_TASK_UPDATE',
  'RETRY_FAILED_TASKS','DELETE_TASK','CLEAR_TASKS'
] as const;

export function isSupportedMessage(value:unknown):value is Record<string,unknown>&{type:typeof messageTypes[number]}{
  return!!value&&typeof value==='object'&&messageTypes.includes((value as {type:typeof messageTypes[number]}).type);
}
