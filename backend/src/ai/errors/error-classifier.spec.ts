import {
  BudgetExceededError,
  classifyError,
  extractStatus,
  shouldRetry,
} from './error-classifier.js';

describe('extractStatus', () => {
  it('从 status 字段提取', () => {
    expect(extractStatus(Object.assign(new Error('x'), { status: 401 }))).toBe(401);
  });

  it('从 response.status 提取', () => {
    expect(extractStatus({ response: { status: 429 } })).toBe(429);
  });

  it('从 cause 提取', () => {
    expect(extractStatus({ cause: { status: 500 } })).toBe(500);
  });

  it('无法识别时返回 undefined', () => {
    expect(extractStatus(new Error('boom'))).toBeUndefined();
    expect(extractStatus(undefined)).toBeUndefined();
  });
});

describe('classifyError', () => {
  it('429 归为限流', () => {
    expect(classifyError(Object.assign(new Error('x'), { status: 429 }))).toBe('rate_limit');
  });

  it('5xx 归为服务端错误', () => {
    expect(classifyError(Object.assign(new Error('x'), { status: 503 }))).toBe('server');
  });

  it('4xx（非 429）归为请求类错误', () => {
    expect(classifyError(Object.assign(new Error('x'), { status: 401 }))).toBe('request');
  });

  it('超时按服务端错误处理', () => {
    expect(classifyError(new Error('request timeout'))).toBe('server');
    expect(classifyError(new Error('Request timed out.'))).toBe('server');
  });
});

describe('shouldRetry', () => {
  it('主动取消不重试', () => {
    expect(shouldRetry(new DOMException('取消', 'AbortError'))).toBe(false);
    expect(shouldRetry(Object.assign(new Error('取消'), { name: 'APIUserAbortError' }))).toBe(
      false,
    );
  });
  it('限流与服务端错误重试', () => {
    expect(shouldRetry(Object.assign(new Error('x'), { status: 429 }))).toBe(true);
    expect(shouldRetry(Object.assign(new Error('x'), { status: 500 }))).toBe(true);
  });

  it('请求类错误不重试', () => {
    expect(shouldRetry(Object.assign(new Error('x'), { status: 401 }))).toBe(false);
    expect(shouldRetry(Object.assign(new Error('x'), { status: 400 }))).toBe(false);
  });

  it('预算耗尽不重试', () => {
    expect(shouldRetry(new BudgetExceededError(2))).toBe(false);
  });
});
