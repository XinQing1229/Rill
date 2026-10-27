import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import {
  ActivateCoverSchema,
  DeleteCurrentCoverSchema,
  CoverRevisionSchema,
  COVER_MAX_BYTES,
} from '@rill/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { coverExtension, CoverService } from './cover.service.js';

@Controller('novel/projects/:id/cover')
export class CoverController {
  constructor(private readonly service: CoverService) {}
  @Get() state(@Param('id') id: string) {
    return this.service.state(id);
  }
  @Get('assets') history(@Param('id') id: string, @Query('page') page = '1') {
    if (!/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page)))
      throw new BadRequestException('非法页码');
    return this.service.history(id, Number(page));
  }
  @Post('assets')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: COVER_MAX_BYTES, files: 1, fields: 1 } }),
  )
  upload(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(CoverRevisionSchema)) body: z.infer<typeof CoverRevisionSchema>,
  ) {
    if (!file) throw new BadRequestException('请选择封面图片');
    return this.service.upload(id, file.buffer, file.originalname, body.expectedRevision);
  }
  @Patch('current') activate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ActivateCoverSchema)) body: z.infer<typeof ActivateCoverSchema>,
  ) {
    return this.service.activate(id, body.assetId, body.expectedRevision);
  }
  @Delete('current') remove(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DeleteCurrentCoverSchema))
    body: z.infer<typeof DeleteCurrentCoverSchema>,
  ) {
    return this.service.remove(id, body.assetId, body.expectedRevision);
  }
  @Get('assets/:assetId/image') async image(
    @Param('id') id: string,
    @Param('assetId') assetId: string,
    @Query('variant') variant = 'full',
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!['full', 'thumbnail'].includes(variant)) throw new BadRequestException('非法图片规格');
    return this.respond(
      await this.service.image(id, assetId, variant === 'thumbnail'),
      response,
      false,
    );
  }
  @Get('assets/:assetId/download') async download(
    @Param('id') id: string,
    @Param('assetId') assetId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond(await this.service.image(id, assetId), response, true);
  }
  private respond(
    file: Awaited<ReturnType<CoverService['image']>>,
    response: Response,
    attachment: boolean,
  ) {
    response.setHeader('Content-Type', file.mime);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    if (attachment)
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="cover.${coverExtension(file.mime)}"; filename*=UTF-8''${encodeURIComponent(file.filename).replace(/'/g, '%27')}`,
      );
    return new StreamableFile(file.data);
  }
}
