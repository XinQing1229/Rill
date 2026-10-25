import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { ProseFilesService } from './prose-files.service.js';
import { ProseContentService } from './prose-content.service.js';
@Module({
  providers: [PrismaService, ProseFilesService, ProseContentService],
  exports: [PrismaService, ProseFilesService, ProseContentService],
})
export class ProseContentModule {}
