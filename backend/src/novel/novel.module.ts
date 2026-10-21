import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { PrismaService } from './prisma.service';
import { QuestionnaireService } from './questionnaire/questionnaire';
import { ArtifactRegistry } from './premise/artifact.registry';
import { PremiseGenerator } from './premise/premise.generator';
import { PipelineService } from './pipeline/pipeline.service';
import { NovelController } from './novel.controller';

@Module({
  imports: [AiModule],
  controllers: [NovelController],
  providers: [
    PrismaService,
    QuestionnaireService,
    ArtifactRegistry,
    PremiseGenerator,
    PipelineService,
  ],
  exports: [PipelineService],
})
export class NovelModule {}
