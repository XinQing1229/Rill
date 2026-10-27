import { Module } from '@nestjs/common';
import { ProseContentModule } from '../prose/prose-content.module.js';
import { CoverController } from './cover.controller.js';
import { CoverService } from './cover.service.js';
@Module({
  imports: [ProseContentModule],
  controllers: [CoverController],
  providers: [CoverService],
  exports: [CoverService],
})
export class CoverModule {}
