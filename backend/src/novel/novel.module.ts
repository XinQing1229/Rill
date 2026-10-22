import { OutlineService } from './outline/outline.service.js';
import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { PrismaService } from './prisma.service.js';
import { QuestionnaireService } from './questionnaire/questionnaire.js';
import { ArtifactRegistry } from './pipeline/artifact.registry.js';
import { UpstreamAssembler } from './pipeline/upstream.assembler.js';
import { PremiseGenerator } from './premise/premise.generator.js';
import { WorldGenerator } from './world/world.generator.js';
import { CharacterGenerator } from './characters/characters.generator.js';
import { RelationGenerator } from './relations/relations.generator.js';
import { PipelineService } from './pipeline/pipeline.service.js';
import { NovelController } from './novel.controller.js';

@Module({
  imports: [AiModule],
  controllers: [NovelController],
  providers: [
    PrismaService,
    QuestionnaireService,
    ArtifactRegistry,
    UpstreamAssembler,
    PremiseGenerator,
    WorldGenerator,
    CharacterGenerator,
    RelationGenerator,
    PipelineService,
    OutlineService,
  ],
  exports: [PipelineService],
})
export class NovelModule {}
