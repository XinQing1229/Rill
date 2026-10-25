import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { z } from 'zod';
import {
  BookCopyBodySchema,
  BookFormatSchema,
  BookPreviewBodySchema,
  CreateBookJobSchema,
  ProseChapterParamSchema,
  RetryBookJobSchema,
  SaveBookSettingsSchema,
} from '@rill/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { BookExportService } from './book-export.service.js';
@Controller('novel/projects/:id/book-export')
export class BookExportController {
  constructor(private readonly service: BookExportService) {}
  @Get('settings') settings(@Param('id') id: string) {
    return this.service.settings(id);
  }
  @Patch('settings') save(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SaveBookSettingsSchema))
    body: z.infer<typeof SaveBookSettingsSchema>,
  ) {
    return this.service.saveSettings(id, body);
  }
  @Post('preview') @HttpCode(200) preview(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(BookPreviewBodySchema)) body: z.infer<typeof BookPreviewBodySchema>,
  ) {
    return this.service.preview(id, body.chapterNumber, body.previewToken);
  }
  @Post('chapters/:number/copy') @HttpCode(200) copy(
    @Param('id') id: string,
    @Param('number', new ZodValidationPipe(ProseChapterParamSchema)) number: number,
    @Body(new ZodValidationPipe(BookCopyBodySchema)) body: z.infer<typeof BookCopyBodySchema>,
  ) {
    return this.service.copy(id, number, body.mode);
  }
  @Post('jobs') @HttpCode(202) create(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateBookJobSchema)) body: z.infer<typeof CreateBookJobSchema>,
  ) {
    return this.service.create(id, body);
  }
  @Get('jobs') list(@Param('id') id: string, @Query('page') page = '1') {
    if (!/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page)))
      throw new BadRequestException('非法页码');
    return this.service.list(id, Number(page));
  }
  @Get('jobs/:jobId') job(@Param('id') id: string, @Param('jobId') jobId: string) {
    return this.service.job(id, jobId);
  }
  @Post('jobs/:jobId/retry') @HttpCode(202) retry(
    @Param('id') id: string,
    @Param('jobId') jobId: string,
    @Body(new ZodValidationPipe(RetryBookJobSchema)) body: z.infer<typeof RetryBookJobSchema>,
  ) {
    return this.service.retry(id, jobId, body.formats);
  }
  @Delete('jobs/:jobId') @HttpCode(202) remove(
    @Param('id') id: string,
    @Param('jobId') jobId: string,
  ) {
    return this.service.remove(id, jobId);
  }
  @Get('jobs/:jobId/files/:format') async download(
    @Param('id') id: string,
    @Param('jobId') jobId: string,
    @Param('format', new ZodValidationPipe(BookFormatSchema))
    format: z.infer<typeof BookFormatSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.service.download(id, jobId, format);
    response.setHeader('Content-Type', file.mime);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="book.${format === 'markdown' ? 'md' : format}"; filename*=UTF-8''${encodeURIComponent(file.filename).replace(/'/g, '%27')}`,
    );
    response.setHeader('Content-Length', file.data.length);
    return new StreamableFile(Readable.from(file.data));
  }
}
