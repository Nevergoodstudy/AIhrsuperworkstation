export class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
export async function api(path, options = {}) {
  const { body, ...rest } = options;
  let response;
  try { response = await fetch(path, { credentials: 'same-origin', ...rest, headers: { 'X-Requested-With': 'TalentDesk', ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...rest.headers }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new ApiError('网络连接失败，请保留当前内容并重试', 0); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/auth') && !path.startsWith('/api/portal')) window.dispatchEvent(new Event('staff-session-expired'));
    throw new ApiError(result.error || '服务暂时不可用，请稍后重试', response.status);
  }
  return result;
}
export const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
export const roles = { admin: '管理员', hr: 'HR', department: '部门复核人' };
export const examStates = { invited: '待开始', in_progress: '进行中', submitted: '已提交', expired: '已过期', revoked: '已撤销' };
export const stages = ['待筛选','待测评','测评中','待复核','面试中','录用','不合适'];
