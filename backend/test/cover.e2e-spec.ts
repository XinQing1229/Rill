import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import request from 'supertest';
import { CoverModule } from '../src/novel/cover/cover.module.js';
import { PrismaService } from '../src/novel/prisma.service.js';
import { ProseFilesService } from '../src/novel/prose/prose-files.service.js';
import type { ProjectCoverState } from '@rill/shared';
const directory = mkdtempSync(join(tmpdir(), 'rill-cover-http-'));
copyFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../pipeline-test.db'),
  join(directory, 'test.db'),
);
process.env.DATABASE_URL = `file:${join(directory, 'test.db')}`;
describe('封面上传、历史、下载与删除 HTTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let files: ProseFilesService;
  let id: string;
  let png: Buffer;
  const base = () => `/api/novel/projects/${id}/cover`;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), CoverModule],
    })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService({ PROSE_OUTPUT_DIR: join(directory, 'output') }))
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = module.get(PrismaService);
    files = module.get(ProseFilesService);
    png = await sharp({ create: { width: 90, height: 120, channels: 4, background: '#12345680' } })
      .png()
      .toBuffer();
  });
  beforeEach(async () => {
    id = (
      await prisma.project.create({
        data: { title: '封面小说', genre: 'dushi', length: 'short', currentStage: 'premise' },
      })
    ).id;
  });
  afterAll(async () => {
    await app?.close();
    rmSync(directory, { recursive: true, force: true });
  });
  async function upload(data = png, revision = 0, name = 'cover.png') {
    return (
      await request(app.getHttpServer())
        .post(base() + '/assets')
        .field('expectedRevision', revision)
        .attach('file', data, name)
        .expect(201)
    ).body as ProjectCoverState;
  }
  it('空状态可读，首次上传、相同内容重试不重复，下载为完整图片', async () => {
    expect((await request(app.getHttpServer()).get(base()).expect(200)).body).toEqual({
      revision: 0,
      currentCover: null,
    });
    const state = await upload();
    const asset = state.currentCover!;
    expect(state.revision).toBe(1);
    expect(asset.fileStatus).toBe('available');
    const repeated = await upload(png, 1);
    expect(repeated.revision).toBe(1);
    expect(
      (
        await request(app.getHttpServer())
          .get(base() + '/assets')
          .expect(200)
      ).body.total,
    ).toBe(1);
    const response = await request(app.getHttpServer())
      .get(base() + `/assets/${asset.id}/download`)
      .expect(200);
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['cache-control']).toBe('no-store');
    expect((await sharp(response.body as Buffer).metadata()).width).toBe(90);
    expect((await prisma.project.findUniqueOrThrow({ where: { id } })).currentStage).toBe(
      'premise',
    );
  });
  it('更换保留历史，显式启用历史不新增，删除当前不回退', async () => {
    const first = await upload();
    const webp = await sharp(png).tint('#fa0000').webp().toBuffer();
    const second = await upload(webp, 1, 'new.webp');
    expect(second.currentCover!.sourceFormat).toBe('webp');
    expect(second.currentCover!.mimeType).toBe('image/png');
    await request(app.getHttpServer())
      .patch(base() + '/current')
      .send({ assetId: first.currentCover!.id, expectedRevision: 2 })
      .expect(200);
    const history = (
      await request(app.getHttpServer())
        .get(base() + '/assets')
        .expect(200)
    ).body;
    expect(history.total).toBe(2);
    expect(history.items[0].id).toBe(first.currentCover!.id);
    expect(history.items[0].isCurrent).toBe(true);
    const deleted = await request(app.getHttpServer())
      .delete(base() + '/current')
      .send({ assetId: first.currentCover!.id, expectedRevision: 3 })
      .expect(200);
    expect(deleted.body.currentCover).toBeNull();
    expect(deleted.body.revision).toBe(4);
    expect((await request(app.getHttpServer()).get(base() + '/assets')).body.total).toBe(1);
    await request(app.getHttpServer())
      .get(base() + `/assets/${first.currentCover!.id}/download`)
      .expect(404);
    await request(app.getHttpServer())
      .get(base() + `/assets/${second.currentCover!.id}/download`)
      .expect(200);
  });
  it('旧版本和其他项目资源不能覆盖当前封面', async () => {
    const first = await upload();
    await request(app.getHttpServer())
      .post(base() + '/assets')
      .field('expectedRevision', 0)
      .attach('file', png, 'x.png')
      .expect(409);
    const other = (
      await prisma.project.create({
        data: { title: '其他', genre: 'dushi', length: 'short', currentStage: 'premise' },
      })
    ).id;
    await request(app.getHttpServer())
      .patch(`/api/novel/projects/${other}/cover/current`)
      .send({ assetId: first.currentCover!.id, expectedRevision: 0 })
      .expect(404);
    expect((await request(app.getHttpServer()).get(base() + '/assets')).body.total).toBe(1);
  });
  it('伪文件、超大文件和非法页码不进入历史', async () => {
    await request(app.getHttpServer())
      .post(base() + '/assets')
      .field('expectedRevision', 0)
      .attach('file', Buffer.from('<svg></svg>'), 'cover.png')
      .expect(422);
    await request(app.getHttpServer())
      .post(base() + '/assets')
      .field('expectedRevision', 0)
      .attach('file', Buffer.alloc(10_000_001), 'huge.png')
      .expect(413);
    await request(app.getHttpServer())
      .get(base() + '/assets?page=-1')
      .expect(400);
    expect((await request(app.getHttpServer()).get(base() + '/assets')).body.total).toBe(0);
  });
  it('损坏原图不能启用或下载，缺失缩略图仍能重建响应', async () => {
    const state = await upload();
    const asset = state.currentCover!;
    const row = await prisma.coverAsset.findUniqueOrThrow({ where: { id: asset.id } });
    rmSync(await files.path(id, row.thumbnailPath));
    await request(app.getHttpServer())
      .get(base() + `/assets/${asset.id}/image?variant=thumbnail`)
      .expect(200);
    writeFileSync(await files.path(id, row.path), 'corrupt');
    expect((await request(app.getHttpServer()).get(base())).body.currentCover.fileStatus).toBe(
      'corrupt',
    );
    await request(app.getHttpServer())
      .patch(base() + '/current')
      .send({ assetId: asset.id, expectedRevision: 1 })
      .expect(409);
    await request(app.getHttpServer())
      .get(base() + `/assets/${asset.id}/download`)
      .expect(409);
  });
  it('软删除冻结所有资源接口，恢复后仍可访问', async () => {
    const state = await upload();
    await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
    await request(app.getHttpServer()).get(base()).expect(404);
    await request(app.getHttpServer())
      .get(base() + '/assets')
      .expect(404);
    await request(app.getHttpServer())
      .get(base() + `/assets/${state.currentCover!.id}/image`)
      .expect(404);
    await prisma.project.update({ where: { id }, data: { deletedAt: null } });
    await request(app.getHttpServer())
      .get(base() + `/assets/${state.currentCover!.id}/image`)
      .expect(200);
  });
});
