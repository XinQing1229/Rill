export type ErrorKind = 'rate_limit' | 'server' | 'request' | 'unknown';

/** 达到总调用预算后抛出，不可重试 */
export class BudgetExceededError extends Error {
  constructor(limit: number) {
    super(`单次生成调用次数已达预算上限 ${limit}，停止重试`);
    this.name = 'BudgetExceededError';
  }
}

export function isBudgetExceeded(error: unknown): boolean {
  return error instanceof BudgetExceededError;
}

/**
 * 从错误对象中提取 HTTP 状态码。
 * LangChain 与底层 SDK 可能把状态码放在不同字段，这里做多路径兜底。
 */
export function extractStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as Record<string, unknown>;

  const direct = candidate.status ?? candidate.statusCode;
  if (typeof direct === 'number') return direct;

  const response = candidate.response as Record<string, unknown> | undefined;
  if (response) {
    const fromResponse = response.status ?? response.statusCode;
    if (typeof fromResponse === 'number') return fromResponse;
  }

  const cause = candidate.cause as Record<string, unknown> | undefined;
  if (cause) {
    const fromCause = cause.status ?? cause.statusCode;
    if (typeof fromCause === 'number') return fromCause;
  }

  return undefined;
}

/**
 * 错误分类：限流退避重试、服务端错误重试、请求类错误不重试。
 */
export function classifyError(error: unknown): ErrorKind {
  const status = extractStatus(error);
  if (status === 429) return 'rate_limit';
  if (typeof status === 'number' && status >= 500) return 'server';
  if (typeof status === 'number' && status >= 400 && status < 500) return 'request';

  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('rate limit') || message.includes('429')) return 'rate_limit';
  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('econnreset')
  )
    return 'server';

  return 'unknown';
}

/**
 * 结构化输出的解析类错误。交给内层的「回喂修复重试」处理，
 * 外层节点重试不再重复介入（避免两层重试叠加）。
 */
export function isOutputParseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: string }).name ?? '';
  const ctorName = (error as { constructor?: { name?: string } }).constructor?.name ?? '';
  return `${name} ${ctorName}`.includes('OutputParser');
}

/** 是否值得重试：限流与服务端错误重试，请求类错误、解析错误与预算耗尽不重试 */
export function shouldRetry(error: unknown): boolean {
  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    ['AbortError', 'APIUserAbortError'].includes(String(error.name))
  )
    return false;
  if (isBudgetExceeded(error)) return false;
  if (isOutputParseError(error)) return false;
  const kind = classifyError(error);
  return kind === 'rate_limit' || kind === 'server' || kind === 'unknown';
}
