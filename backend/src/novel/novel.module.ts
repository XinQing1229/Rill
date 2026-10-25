import { ProseRevisionService } from './prose/prose-revision.service.js';
import { PremiseRevisionService } from './premise/premise-revision.service.js';
import { BookExportModule } from './book-export/book-export.module.js';
import { ProseContentModule } from './prose/prose-content.module.js';
import { ProseService } from './prose/prose.service.js';
import { OutlineService } from './outline/outline.service.js';
import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
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
  imports: [AiModule, ProseContentModule, BookExportModule],
  controllers: [NovelController],
  providers: [
    QuestionnaireService,
    ArtifactRegistry,
    UpstreamAssembler,
    PremiseGenerator,
    PremiseRevisionService,
    WorldGenerator,
    CharacterGenerator,
    RelationGenerator,
    ProseService,
    ProseRevisionService,
    PipelineService,
    OutlineService,
  ],
  exports: [PipelineService],
})
export class NovelModule {}
