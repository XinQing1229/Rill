import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { PrismaService } from './prisma.service';
import { QuestionnaireService } from './questionnaire/questionnaire';
import { ArtifactRegistry } from './pipeline/artifact.registry';
import { UpstreamAssembler } from './pipeline/upstream.assembler';
import { PremiseGenerator } from './premise/premise.generator';
import { WorldGenerator } from './world/world.generator';
import { CharacterGenerator } from './characters/characters.generator';
import { RelationGenerator } from './relations/relations.generator';
import { PipelineService } from './pipeline/pipeline.service';
import { NovelController } from './novel.controller';

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
  ],
  exports: [PipelineService],
})
export class NovelModule {}
