import { Injectable, ConflictException } from '@nestjs/common';
import { constants } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  BookDocumentSchema,
  BookManifestSchema,
  type BookDocument,
  type BookManifest,
} from '@rill/shared';
import { ProseFilesService } from '../prose/prose-files.service.js';
export const bytesHash = (data: Uint8Array | string) =>
  createHash('sha256').update(data).digest('hex');
@Injectable()
export class BookExportFilesService {
  constructor(private readonly files: ProseFilesService) {}
  async path(projectId: string, jobId: string, name = '') {
    if (!/^[A-Za-z0-9_-]+$/.test(jobId)) throw new ConflictException('非法任务标识');
    return this.files.path(projectId, `exports/${jobId}${name ? '/' + name : ''}`);
  }
  async write(
    projectId: string,
    jobId: string,
    name: string,
    data: Uint8Array | string,
    guard: () => Promise<void>,
  ) {
    await guard();
    const path = await this.path(projectId, jobId, name);
    await mkdir(dirname(path), { recursive: true });
    await this.path(projectId, jobId, name);
    const temp = path + '.' + randomUUID() + '.tmp';
    const handle = await open(temp, 'wx', 0o600);
    try {
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await guard();
      await this.path(projectId, jobId, name);
      await rename(temp, path);
    } finally {
      await rm(temp, { force: true });
    }
    return {
      path: `exports/${jobId}/${name}`,
      hash: bytesHash(data),
      size: Buffer.byteLength(data),
    };
  }
  async read(projectId: string, jobId: string, name: string) {
    const path = await this.path(projectId, jobId, name);
    const h = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await h.stat();
      const data = await h.readFile();
      const after = await h.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || !before.isFile())
        throw new ConflictException('导出文件读取期间发生变化');
      return data;
    } finally {
      await h.close();
    }
  }
  async snapshot(
    projectId: string,
    jobId: string,
    manifest: Omit<BookManifest, 'chapters'>,
    docs: BookDocument[],
    guard: () => Promise<void>,
    cover?: Buffer,
  ) {
    if (manifest.cover) {
      if (!cover || bytesHash(cover) !== manifest.cover.sha256)
        throw new ConflictException('封面快照不匹配');
      await this.write(projectId, jobId, manifest.cover.path, cover, guard);
    }
    const chapters = [];
    for (const doc of docs) {
      await this.write(
        projectId,
        jobId,
        `snapshot/chapters/${doc.chapterNumber}.md`,
        doc.source,
        guard,
      );
      const path = `snapshot/documents/${doc.chapterNumber}.json`;
      const result = await this.write(projectId, jobId, path, JSON.stringify(doc), guard);
      chapters.push({ chapterNumber: doc.chapterNumber, path, hash: result.hash });
    }
    const data = BookManifestSchema.parse({ ...manifest, chapters });
    const result = await this.write(
      projectId,
      jobId,
      'snapshot/manifest.json',
      JSON.stringify(data),
      guard,
    );
    return result;
  }
  async load(projectId: string, jobId: string, expectedHash: string) {
    const raw = await this.read(projectId, jobId, 'snapshot/manifest.json');
    if (bytesHash(raw) !== expectedHash) throw new ConflictException('快照清单损坏');
    const manifest = BookManifestSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)),
    );
    const docs: BookDocument[] = [];
    for (const [index, c] of manifest.chapters.entries()) {
      if (c.chapterNumber !== index + 1 || c.path !== `snapshot/documents/${c.chapterNumber}.json`)
        throw new ConflictException('快照章目无效');
      const rawDoc = await this.read(projectId, jobId, c.path);
      if (bytesHash(rawDoc) !== c.hash) throw new ConflictException('快照章节损坏');
      const doc = BookDocumentSchema.parse(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawDoc)),
      );
      const source = await this.read(projectId, jobId, `snapshot/chapters/${c.chapterNumber}.md`);
      if (
        doc.chapterNumber !== c.chapterNumber ||
        bytesHash(source) !== doc.sourceHash ||
        source.toString('utf8') !== doc.source
      )
        throw new ConflictException('快照正文损坏');
      docs.push(doc);
    }
    const cover = manifest.cover ? await this.read(projectId, jobId, manifest.cover.path) : null;
    if (manifest.cover && (!cover || bytesHash(cover) !== manifest.cover.sha256))
      throw new ConflictException('快照封面损坏');
    return { manifest, docs, cover };
  }
  async remove(projectId: string, jobId: string) {
    await rm(await this.path(projectId, jobId), { recursive: true, force: true });
  }
}
