import {
  Injectable,
  BadRequestException,
  ConflictException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { constants, existsSync, realpathSync } from 'node:fs';
import { mkdir, lstat, open, link, unlink, rename, rm, access } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export function proseHash(content: string): string {
  return createHash('sha256').update(content.replace(/\r\n?/g, '\n')).digest('hex');
}
export type FileSnapshot = {
  content: string | null;
  hash: string | null;
  status: 'valid' | 'missing' | 'empty' | 'invalid_encoding' | 'unreadable';
};

/** 正文创建、带基线校验的替换与只读投影。 */
@Injectable()
export class ProseFilesService implements OnModuleInit {
  readonly root: string;
  constructor(config: ConfigService) {
    let directory = dirname(fileURLToPath(import.meta.url));
    while (
      !existsSync(resolve(directory, 'prisma/schema.prisma')) &&
      dirname(directory) !== directory
    )
      directory = dirname(directory);
    const configuredRoot = resolve(
      config.get<string>('PROSE_OUTPUT_DIR') ?? resolve(directory, '../output'),
    );
    let existing = configuredRoot;
    while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
    this.root = resolve(realpathSync(existing), relative(existing, configuredRoot));
  }
  async onModuleInit() {
    await mkdir(this.root, { recursive: true });
    await access(this.root, constants.W_OK);
  }
  chapterPath(number: number): string {
    if (!Number.isInteger(number) || number < 1) throw new BadRequestException('非法章号');
    return `chapters/${String(number).padStart(3, '0')}.md`;
  }
  async path(id: string, name = ''): Promise<string> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new BadRequestException('非法项目路径');
    const target = resolve(this.root, id, name);
    if (relative(resolve(this.root, id), target).split(sep).includes('..') || name.startsWith('/'))
      throw new BadRequestException('路径越界');
    // 检查从文件系统根到目标的每个现有组件，禁止链接，包括输出根自身。
    let current = target;
    while (true) {
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw new BadRequestException('正文路径禁止符号链接');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return target;
  }
  async read(id: string, number: number): Promise<FileSnapshot> {
    return this.readStored(id, this.chapterPath(number));
  }
  async readStored(id: string, name: string): Promise<FileSnapshot> {
    const path = await this.path(id, name);
    try {
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const before = await handle.stat();
        const bytes = await handle.readFile();
        const after = await handle.stat();
        if (before.mtimeMs !== after.mtimeMs || before.size !== after.size)
          return { content: null, hash: null, status: 'unreadable' };
        let content: string;
        try {
          content = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n');
        } catch {
          return { content: null, hash: null, status: 'invalid_encoding' };
        }
        return { content, hash: proseHash(content), status: content.trim() ? 'valid' : 'empty' };
      } finally {
        await handle.close();
      }
    } catch (error) {
      return {
        content: null,
        hash: null,
        status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable',
      };
    }
  }
  async create(id: string, name: string, content: string): Promise<boolean> {
    const target = await this.path(id, name);
    await mkdir(dirname(target), { recursive: true });
    await this.path(id, name);
    const temp = `${target}.${randomUUID()}.tmp`;
    const handle = await open(temp, 'wx');
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temp, target);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    } finally {
      await unlink(temp);
    }
  }
  /** 运行锁由调用方持有；仅在基础哈希仍匹配时发布修改。 */
  async replace(
    id: string,
    number: number,
    expectedHash: string | null,
    content: string,
    signal?: AbortSignal,
  ) {
    const name = this.chapterPath(number);
    const target = await this.path(id, name);
    const tempName = `${name}.${randomUUID()}.tmp`;
    const temp = await this.path(id, tempName);
    await this.create(id, tempName, content);
    try {
      if ((await this.read(id, number)).hash !== expectedHash)
        throw new ConflictException('正文文件已变化，未覆盖现有正文');
      await this.path(id, name);
      signal?.throwIfAborted();
      await rename(temp, target);
    } finally {
      await rm(temp, { force: true });
    }
  }
  async projection(id: string, name: string, content: string): Promise<void> {
    // 只允许应用管理的投影，禁止调用方把正文当作投影覆盖。
    if (!(name === 'book.md' || /^(summaries|reviews)\/[A-Za-z0-9_-]+\.json$/.test(name)))
      throw new BadRequestException('不是可重建投影');
    const target = await this.path(id, name);
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    await this.create(id, relative(resolve(this.root, id), temp), content);
    await this.path(id, name);
    await rename(temp, target);
  }
  async purge(id: string): Promise<void> {
    await rm(await this.path(id), { recursive: true, force: true });
  }
}
