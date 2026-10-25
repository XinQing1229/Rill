import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProseFilesService } from '../prose/prose-files.service.js';
import { BookExportFilesService } from './book-export-files.service.js';
describe('导出文件范围和发布', () => {
  let dir: string;
  let service: BookExportFilesService;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rill-export-files-'));
    const prose = new ProseFilesService(new ConfigService({ PROSE_OUTPUT_DIR: dir }));
    await prose.onModuleInit();
    service = new BookExportFilesService(prose);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  it('拒绝越界、符号链接与非法任务名', async () => {
    await expect(service.path('project', '../other', 'file')).rejects.toThrow();
    await expect(service.path('project', 'job', '../../../other')).rejects.toThrow();
    await symlink(tmpdir(), join(dir, 'project'));
    await expect(service.path('project', 'job', 'file')).rejects.toThrow('符号链接');
  });
  it('中断后不发布半成品，不改其他任务', async () => {
    await service.write('project', 'other', 'files/book.txt', '旧文', async () => {});
    let calls = 0;
    await expect(
      service.write('project', 'job', 'files/book.txt', '新文', async () => {
        if (++calls > 1) throw new Error('执行权已变化');
      }),
    ).rejects.toThrow('执行权');
    await expect(
      readFile(await service.path('project', 'job', 'files/book.txt')),
    ).rejects.toThrow();
    expect((await service.read('project', 'other', 'files/book.txt')).toString()).toBe('旧文');
  });
});
