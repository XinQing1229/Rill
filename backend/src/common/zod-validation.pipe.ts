import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * 基于 zod 的请求体验证管道。
 * 校验失败返回 400 与字段级原因，避免脏数据进入业务层后以 500 形式爆出。
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const details = result.error.issues
        .map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`)
        .join('; ');
      throw new BadRequestException(`请求体校验失败: ${details}`);
    }
    // 返回解析后的数据：剥离未声明字段，并应用默认值
    return result.data;
  }
}
