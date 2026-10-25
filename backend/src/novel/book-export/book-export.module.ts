import { Module } from '@nestjs/common';
import { ProseContentModule } from '../prose/prose-content.module.js';
import { BookExportController } from './book-export.controller.js';
import { BookExportService } from './book-export.service.js';
import { BookExportFilesService } from './book-export-files.service.js';
@Module({
  imports: [ProseContentModule],
  controllers: [BookExportController],
  providers: [BookExportService, BookExportFilesService],
  exports: [BookExportService],
})
export class BookExportModule {}
