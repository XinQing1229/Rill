const jest = import.meta.jest;
import { ConfigService } from '@nestjs/config';
import { copyFileSync, mkdtempSync, rmSync, existsSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { COVER_HISTORY_PAGE_SIZE } from '@rill/shared';
import { CoverService } from './cover.service.js';
import { PrismaService } from '../prisma.service.js';
import { ProseFilesService } from '../prose/prose-files.service.js';
const directory = mkdtempSync(join(tmpdir(), 'rill-cover-unit-'));
copyFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../pipeline-test.db'),
  join(directory, 'test.db'),
);
process.env.DATABASE_URL = `file:${join(directory, 'test.db')}`;
describe('封面资源一致性', () => {
  let prisma: PrismaService;
  let files: ProseFilesService;
  let service: CoverService;
  let id: string;
  let png: Buffer;
  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    files = new ProseFilesService(
      new ConfigService({ PROSE_OUTPUT_DIR: join(directory, 'output') }),
    );
    await files.onModuleInit();
    service = new CoverService(prisma, files);
    png = await sharp({ create: { width: 60, height: 80, channels: 3, background: 'red' } })
      .png()
      .toBuffer();
  });
  beforeEach(async () => {
    id = (
      await prisma.project.create({
        data: { title: '封面资源', genre: 'dushi', length: 'short', currentStage: 'prose' },
      })
    ).id;
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  });
  it('并发上传同一基线只能提交一次，保留一个有效记录', async () => {
    const results = await Promise.allSettled([
      service.upload(id, png, 'a.png', 0),
      service.upload(id, png, 'b.png', 0),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await service.history(id, 1)).total).toBe(1);
  });
  it('数据库提交失败不切换引用或遗留新历史', async () => {
    const before = await service.upload(id, png, 'old.png', 0);
    const next = await sharp(png).tint('blue').png().toBuffer();
    jest.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('测试提交失败'));
    await expect(service.upload(id, next, 'next.png', 1)).rejects.toThrow('测试提交失败');
    expect((await service.state(id)).currentCover!.id).toBe(before.currentCover!.id);
    expect((await service.history(id, 1)).total).toBe(1);
  });
  it('旋转方向在规范化后固化，元数据不继续传播', async () => {
    const jpeg = await sharp(png).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await service.upload(id, jpeg, 'rotated.jpg', 0);
    expect(result.currentCover!.width).toBe(80);
    expect(result.currentCover!.height).toBe(60);
    const stored = await service.image(id, result.currentCover!.id);
    expect((await sharp(stored.data).metadata()).orientation).toBeUndefined();
  });
  it('像素超限和伪装图片被拒绝，当前引用不变化', async () => {
    const large = await sharp({
      create: { width: 8193, height: 1, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await expect(service.upload(id, large, 'wide.png', 0)).rejects.toThrow('8192');
    // 可解码静态内容仍按真实格式判断；伪 SVG 不受扩展名信任。
    await expect(
      service.upload(
        id,
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'),
        'fake.webp',
        0,
      ),
    ).rejects.toThrow('静态');
    expect((await service.state(id)).currentCover).toBeNull();
  });
  it('动画 WebP 不被静默截成首帧', async () => {
    const blue = await sharp(png).tint('blue').png().toBuffer();
    const animated = await sharp([png, blue], { join: { animated: true } })
      .webp()
      .toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    await expect(service.upload(id, animated, 'animated.webp', 0)).rejects.toThrow('静态');
    expect((await service.history(id, 1)).total).toBe(0);
  });
  it('历史分页时当前封面置顶且不重复出现', async () => {
    const ids: string[] = [];
    for (let index = 0; index < COVER_HISTORY_PAGE_SIZE + 1; index += 1) {
      const asset = await sharp({
        create: { width: 60 + index, height: 80, channels: 3, background: 'red' },
      })
        .png()
        .toBuffer();
      ids.push((await service.upload(id, asset, `cover-${index}.png`, index)).currentCover!.id);
    }
    const oldest = ids[0];
    await service.activate(id, oldest, COVER_HISTORY_PAGE_SIZE + 1);
    const first = await service.history(id, 1);
    expect(first.total).toBe(COVER_HISTORY_PAGE_SIZE + 1);
    expect(first.items).toHaveLength(COVER_HISTORY_PAGE_SIZE);
    expect(first.items[0].id).toBe(oldest);
    expect(first.items[0].isCurrent).toBe(true);
    const second = await service.history(id, 2);
    expect(second.items).toHaveLength(1);
    expect(second.items.map((item) => item.id)).not.toContain(oldest);
  });
  it('重新初始化清理已删除资源，不回收非当前历史', async () => {
    const first = await service.upload(id, png, 'one.png', 0);
    const second = await service.upload(
      id,
      await sharp(png).tint('blue').png().toBuffer(),
      'two.png',
      1,
    );
    const row = await prisma.coverAsset.findUniqueOrThrow({
      where: { id: second.currentCover!.id },
    });
    // 模拟数据库已提交删除、进程在文件清理前退出。
    await prisma.coverAsset.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
    await prisma.projectCoverState.update({
      where: { projectId: id },
      data: { currentAssetId: null },
    });
    await service.onModuleInit();
    expect(existsSync(await files.path(id, row.path))).toBe(false);
    expect((await service.image(id, first.currentCover!.id)).data.length).toBeGreaterThan(0);
  });
  it('启动回收超时孤立目录，保留新目录和有引用历史', async () => {
    const first = await service.upload(id, png, 'kept.png', 0);
    const old = await files.path(id, 'covers/11111111-1111-4111-8111-111111111111');
    const fresh = await files.path(id, 'covers/22222222-2222-4222-8222-222222222222');
    mkdirSync(old, { recursive: true });
    mkdirSync(fresh, { recursive: true });
    const yesterday = new Date(Date.now() - 86_400_000);
    utimesSync(old, yesterday, yesterday);
    await service.onModuleInit();
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect((await service.image(id, first.currentCover!.id)).data.length).toBeGreaterThan(0);
  });
});
