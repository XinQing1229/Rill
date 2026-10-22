# Tasks

## 1. Seed story engine contract and generation

- [x] 1.1 Add `storyEngine` to the shared premise output contract with opening goal, main obstacle, failure cost, and a bounded ordered escalation path; verify schema tests reject missing or out-of-range escalation steps.
- [x] 1.2 Update the premise prompt to distinguish opening goal from long-term desire and generate actionable stakes and escalation under the selected questionnaire constraints; verify prompt tests cover supplied and missing ideas.
- [x] 1.3 Preserve existing stored premise compatibility; verify a legacy premise without `storyEngine` remains readable and a newly generated premise includes it.
- [x] 1.4 Display the story-engine fields in the premise workbench; verify component tests cover rendering the new fields and legacy seeds without them.

## 2. Make world, character, and relation prompts serve the plot

- [x] 2.1 Update the world prompt so rules, factions, and genre-specific settings each connect to a character limitation, cost, pressure, or usable opportunity; verify prompt tests exercise light and detailed world tiers.
- [x] 2.2 Update the character prompt to express distinct goals, relevant hidden history, meaningful limits, conflicts with the protagonist, and choice-driven arcs using existing schema fields; verify output remains valid under `CharacterListSchema`.
- [x] 2.3 Update the relation prompt to describe current tension and a choice that could change the relationship using the existing description field; verify output remains valid under `RelationListSchema` and does not introduce characters.

## 3. Carry story-driving context into outline generation

- [x] 3.1 Use the existing `UpstreamAssembler` and `StageContext` consumed by `OutlineService` as the shared handoff, without changing `add-outline-generation` artifacts; verify planning reads that assembled context.
- [x] 3.2 Pass confirmed seed story-engine fields and the relevant confirmed world, character-arc, and relation details into the outline prompt as story data; verify prompt tests assert all fields are present and treated as data rather than overriding instructions.
- [x] 3.3 Keep legacy premises usable when the story-engine object is absent and avoid fabricating values; verify outline context rendering omits unavailable fields while preserving other context.

## 4. Verify the integrated behavior

- [x] 4.1 Update stage generation and context tests for the richer plot-driving content; verify affected backend and frontend test suites pass.
- [x] 4.2 Validate the change artifacts and confirm their requirements match the implemented contracts and prompt behavior; verify `openspec validate improve-story-engine-prompts --strict` succeeds.
