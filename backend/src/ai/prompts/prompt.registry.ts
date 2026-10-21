import { Injectable } from '@nestjs/common';

export interface PromptTemplate {
  name: string;
  version: string;
  requiredVariables: string[];
  render(variables: Record<string, string>): string;
}

export class PromptNotFoundError extends Error {}
export class PromptVariableMissingError extends Error {}

@Injectable()
export class PromptRegistry {
  private readonly templates = new Map<string, PromptTemplate>();

  register(template: PromptTemplate): void {
    this.templates.set(`${template.name}@${template.version}`, template);
  }

  render(name: string, version: string, variables: Record<string, string>): string {
    const key = `${name}@${version}`;
    const template = this.templates.get(key);
    if (!template) {
      throw new PromptNotFoundError(`提示词模板不存在: ${key}`);
    }

    const missing = template.requiredVariables.filter(
      (variable) => variables[variable] === undefined || variables[variable] === '',
    );
    if (missing.length > 0) {
      throw new PromptVariableMissingError(`提示词模板 ${key} 缺少必填变量: ${missing.join(', ')}`);
    }

    return template.render(variables);
  }
}
