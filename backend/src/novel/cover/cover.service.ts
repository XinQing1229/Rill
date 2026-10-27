import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  UnprocessableEntityException,
  PayloadTooLargeException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rm, rename, readdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp, { type OutputInfo } from 'sharp';
import {
  COVER_HISTORY_PAGE_SIZE,
  COVER_MAX_BYTES,
  COVER_MAX_EDGE_PX,
  COVER_MAX_TOTAL_PIXELS,
  COVER_SOURCE_FORMATS,
  COVER_TOO_LARGE_MESSAGE,
  CoverAssetSchema,
  CoverHistoryPageSchema,
  ProjectCoverStateSchema,
} from '@rill/shared';
import type { CoverAsset as AssetRow, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';
import { ProseFilesService } from '../prose/prose-files.service.js';

const THUMBNAIL_WIDTH = 480;
const safeName = (name: string) =>
  Array.from(name)
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    .join('')
    .replace(/[\\/]/g, '_')
    .slice(0, 255);
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
/** 文件名后缀只由 MIME 推导，避免存储路径、下载名各处重复判断。 */
export const coverExtension = (mimeType: string) => (mimeType === 'image/jpeg' ? 'jpg' : 'png');
/** multer 按 latin1 解析 multipart 文件名，纯单字节名称需还原为 UTF-8。 */
const decodeUploadName = (name: string) => {
  if (!Array.from(name).every((c) => c.charCodeAt(0) <= 255)) return name;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(name, 'latin1'));
  } catch {
    return name;
  }
};

@Injectable()
export class CoverService implements OnModuleInit {
  private locks = new Map<string, Promise<unknown>>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: ProseFilesService,
  ) {}

  /** 所有当前资源修改与导出读取在单实例内串行，数据库版本仍是最终校验。 */
  async locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const work = previous.catch(() => {}).then(action);
    this.locks.set(id, work);
    try {
      return await work;
    } finally {
      if (this.locks.get(id) === work) this.locks.delete(id);
    }
  }
  async project(id: string, db: Prisma.TransactionClient = this.prisma) {
    const project = await db.project.findFirst({ where: { id, deletedAt: null } });
    if (!project) throw new NotFoundException('项目不存在');
    return project;
  }
  private async read(id: string, path: string) {
    const handle = await open(
      await this.files.path(id, path),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > 100_000_000)
        throw new ConflictException('封面文件异常');
      const data = await handle.readFile();
      const after = await handle.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
        throw new ConflictException('封面读取期间发生变化');
      return data;
    } finally {
      await handle.close();
    }
  }
  private async fileStatus(row: AssetRow): Promise<'available' | 'missing' | 'corrupt'> {
    try {
      return hash(await this.read(row.projectId, row.path)) === row.sha256
        ? 'available'
        : 'corrupt';
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'corrupt';
    }
  }
  private async view(row: AssetRow) {
    // SQLite 无枚举，单列取值可能漂移；对外输出统一由 shared 契约收口。
    return CoverAssetSchema.parse({
      ...row,
      createdAt: row.createdAt.toISOString(),
      fileStatus: await this.fileStatus(row),
    });
  }
  async state(id: string) {
    await this.project(id);
    const state = await this.prisma.projectCoverState.findUnique({ where: { projectId: id } });
    const row = state?.currentAssetId
      ? await this.prisma.coverAsset.findFirst({
          where: { id: state.currentAssetId, projectId: id, deletedAt: null },
        })
      : null;
    return ProjectCoverStateSchema.parse({
      revision: state?.revision ?? 0,
      currentCover: row ? await this.view(row) : null,
    });
  }
  async history(id: string, page: number) {
    await this.project(id);
    // 当前置顶只改变展示，不修改原上传时间；分页顺序稳定。
    const state = await this.prisma.projectCoverState.findUnique({ where: { projectId: id } });
    const where: Prisma.CoverAssetWhereInput = { projectId: id, deletedAt: null };
    const current = state?.currentAssetId
      ? await this.prisma.coverAsset.findFirst({ where: { ...where, id: state.currentAssetId } })
      : null;
    // 当前封面在首页占首位，其余条目整体后移一位，后续页不再重复出现。
    const others: Prisma.CoverAssetWhereInput = current
      ? { ...where, id: { not: current.id } }
      : where;
    const order: Prisma.CoverAssetOrderByWithRelationInput[] = [
      { createdAt: 'desc' },
      { id: 'desc' },
    ];
    const rows =
      current && page === 1
        ? [
            current,
            ...(await this.prisma.coverAsset.findMany({
              where: others,
              orderBy: order,
              take: COVER_HISTORY_PAGE_SIZE - 1,
            })),
          ]
        : await this.prisma.coverAsset.findMany({
            where: others,
            orderBy: order,
            skip: (page - 1) * COVER_HISTORY_PAGE_SIZE - (current ? 1 : 0),
            take: COVER_HISTORY_PAGE_SIZE,
          });
    return CoverHistoryPageSchema.parse({
      items: await Promise.all(
        rows.map(async (row) => ({
          ...(await this.view(row)),
          isCurrent: row.id === state?.currentAssetId,
        })),
      ),
      total: await this.prisma.coverAsset.count({ where }),
      page,
      pageSize: COVER_HISTORY_PAGE_SIZE,
    });
  }
  private async revision(
    id: string,
    expected: number,
    assetId: string | null,
    db: Prisma.TransactionClient,
  ) {
    await this.project(id, db);
    const existing = await db.projectCoverState.findUnique({ where: { projectId: id } });
    if ((existing?.revision ?? 0) !== expected)
      throw new ConflictException('封面已在其他页面更新，请核对后重试');
    if (existing?.currentAssetId === assetId) return;
    await db.projectCoverState.upsert({
      where: { projectId: id },
      create: { projectId: id, revision: 1, currentAssetId: assetId },
      update: { currentAssetId: assetId, revision: { increment: 1 } },
    });
    await db.project.update({ where: { id }, data: { updatedAt: new Date() } });
  }
  /** 缩略图是可重建投影，上传落盘与读取校验共用同一条管线。 */
  private thumbnail(data: Buffer) {
    return sharp(data)
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .png()
      .toBuffer();
  }
  private async write(id: string, name: string, data: Buffer) {
    const target = await this.files.path(id, name);
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    const handle = await open(temp, 'wx', 0o600);
    try {
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, target);
    } finally {
      await rm(temp, { force: true });
    }
  }
  async upload(id: string, data: Buffer, filename: string, expected: number) {
    if (data.length > COVER_MAX_BYTES) throw new PayloadTooLargeException(COVER_TOO_LARGE_MESSAGE);
    if (!data.length) throw new BadRequestException('请选择封面图片');
    return this.locked(id, async () => {
      await this.project(id);
      const baseline = await this.state(id);
      if (baseline.revision !== expected) throw new ConflictException('封面已变化，请核对后重试');
      let normalized: { data: Buffer; info: OutputInfo };
      let format: (typeof COVER_SOURCE_FORMATS)[number];
      const limits = { limitInputPixels: COVER_MAX_TOTAL_PIXELS, failOn: 'warning' } as const;
      try {
        const meta = await sharp(data, limits).metadata();
        const source = COVER_SOURCE_FORMATS.find((item) => item === meta.format);
        if (!source || (meta.pages ?? 1) > 1) throw new Error('仅支持静态 JPG、PNG、WebP');
        if (!meta.width || !meta.height || Math.max(meta.width, meta.height) > COVER_MAX_EDGE_PX)
          throw new Error(`图片最长边不能超过 ${COVER_MAX_EDGE_PX} 像素`);
        format = source;
        const pipeline = sharp(data, limits).rotate().toColourspace('srgb');
        normalized = await (
          format === 'jpeg' ? pipeline.jpeg({ quality: 95 }) : pipeline.png()
        ).toBuffer({ resolveWithObject: true });
      } catch (e) {
        throw new UnprocessableEntityException(
          e instanceof Error ? `封面校验失败：${e.message}` : '图片无法解码',
        );
      }
      const digest = hash(normalized.data);
      const candidates = await this.prisma.coverAsset.findMany({
        where: { projectId: id, sha256: digest, deletedAt: null },
      });
      for (const row of candidates) {
        if ((await this.fileStatus(row)) === 'available') {
          await this.prisma.$transaction((tx) => this.revision(id, expected, row.id, tx));
          return this.state(id);
        }
      }
      const assetId = randomUUID();
      const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const path = `covers/${assetId}/cover.${coverExtension(mimeType)}`;
      const thumbnailPath = `covers/${assetId}/thumbnail.png`;
      try {
        await this.write(id, path, normalized.data);
        await this.write(id, thumbnailPath, await this.thumbnail(normalized.data));
        await this.prisma.$transaction(async (tx) => {
          await this.revision(id, expected, assetId, tx);
          await tx.coverAsset.create({
            data: {
              id: assetId,
              projectId: id,
              path,
              thumbnailPath,
              sourceFormat: format,
              mimeType,
              width: normalized.info.width,
              height: normalized.info.height,
              size: normalized.data.length,
              sha256: digest,
              originalFilename: safeName(decodeUploadName(filename)),
            },
          });
        });
      } catch (e) {
        await rm(await this.files.path(id, `covers/${assetId}`), { recursive: true, force: true });
        throw e;
      }
      return this.state(id);
    });
  }
  async activate(id: string, assetId: string, expected: number) {
    return this.locked(id, async () => {
      await this.image(id, assetId);
      await this.prisma.$transaction((tx) => this.revision(id, expected, assetId, tx));
      return this.state(id);
    });
  }
  async remove(id: string, assetId: string, expected: number) {
    return this.locked(id, async () => {
      await this.prisma.$transaction(async (tx) => {
        const state = await tx.projectCoverState.findUnique({ where: { projectId: id } });
        if (state?.currentAssetId !== assetId)
          throw new ConflictException('当前封面已变化，请重新核对');
        await this.revision(id, expected, null, tx);
        await tx.coverAsset.update({
          where: { id: assetId, projectId: id },
          data: { deletedAt: new Date() },
        });
      });
      await this.cleanup(id, assetId);
      return this.state(id);
    });
  }
  private async cleanup(id: string, assetId: string) {
    // 删除凭据保留在数据库；磁盘清理失败可在重启后重试。
    try {
      await rm(await this.files.path(id, `covers/${assetId}`), { recursive: true, force: true });
    } catch {
      /* 保留 deletedAt */
    }
  }
  async onModuleInit() {
    const deleted = await this.prisma.coverAsset.findMany({ where: { deletedAt: { not: null } } });
    for (const row of deleted) await this.cleanup(row.projectId, row.id);
    // 仅回收宕机遗留且超过一小时的无引用目录，历史资源永不按“非当前”回收。
    const projects = await this.prisma.project.findMany({ select: { id: true } });
    for (const project of projects) {
      try {
        const directory = await this.files.path(project.id, 'covers');
        const entries = await readdir(directory, { withFileTypes: true });
        const assets = await this.prisma.coverAsset.findMany({
          where: { projectId: project.id },
          select: { id: true },
        });
        const referenced = new Set(assets.map((asset) => asset.id));
        for (const entry of entries) {
          if (
            !entry.isDirectory() ||
            !/^[a-f0-9-]{36}$/.test(entry.name) ||
            referenced.has(entry.name)
          )
            continue;
          const path = await this.files.path(project.id, `covers/${entry.name}`);
          if ((await stat(path)).mtimeMs < Date.now() - 3_600_000)
            await rm(path, { recursive: true, force: true });
        }
      } catch {
        /* 目录不存在或临时不可读不阻塞启动，下次再清理。 */
      }
    }
  }
  async image(id: string, assetId: string, thumbnail = false) {
    const project = await this.project(id);
    const row = await this.prisma.coverAsset.findFirst({
      where: { id: assetId, projectId: id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('封面不存在');
    let data: Buffer;
    try {
      data = await this.read(id, row.path);
      if (hash(data) !== row.sha256) throw new Error('哈希不符');
    } catch {
      throw new ConflictException('封面文件不可用，请重新上传、切换历史封面或删除');
    }
    if (thumbnail) {
      // 缩略图是可重建投影，不信任手工修改过的投影内容。
      const thumb = await this.thumbnail(data);
      try {
        data = await this.read(id, row.thumbnailPath);
        if (hash(data) !== hash(thumb)) data = thumb;
      } catch {
        data = thumb;
      }
    }
    return {
      data,
      row,
      mime: thumbnail ? 'image/png' : row.mimeType,
      filename: `${safeName(project.title)}-${assetId.slice(0, 8)}.${coverExtension(row.mimeType)}`,
    };
  }
  async currentImage(id: string) {
    const state = await this.state(id);
    if (!state.currentCover) return { revision: state.revision, cover: null };
    const image = await this.image(id, state.currentCover.id);
    return { revision: state.revision, cover: { ...image, asset: state.currentCover } };
  }
}
