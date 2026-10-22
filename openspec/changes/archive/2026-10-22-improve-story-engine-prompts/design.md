# Design

## Context

See [proposal.md](./proposal.md) for motivation and scope. The current `PremiseSchema` separates the protagonist's desire from the general core conflict but has no structured opening objective, opposition, failure cost, or escalation path. World, character, and relation schemas already have descriptions, goals, flaws, backgrounds, arcs, and relation descriptions, so their first improvement can remain prompt-only and preserve persisted shapes.

The active `add-outline-generation` change independently plans outline context assembly and is not yet implemented. This change must define the story-engine contract and coordinate its handoff into outline generation without editing that other change's planning artifacts.

## Goals / Non-Goals

**Goals:**

- Make seed output actionable for plotting by separating the protagonist's opening objective from their longer-term desire.
- Make world details and character relationships create usable pressure and choices.
- Preserve existing world, character, and relation object shapes.
- Ensure the confirmed seed story engine reaches outline generation.
- Keep older stored seed records readable during rollout.

**Non-Goals:**

- Add structured secret, boundary, or relationship-development fields to world, character, or relation contracts.
- Generate chapter beats or prose.
- Automatically score literary quality or guarantee causal coherence.
- Modify the existing `add-outline-generation` change artifacts as part of this change.

## Decisions

### 1. Add a `storyEngine` object to the seed contract

Add `storyEngine` to `PremiseSchema` with:

- `openingGoal`: the protagonist's concrete, near-term objective at the beginning of the story;
- `mainObstacle`: the primary person, institution, rule, or circumstance blocking that objective;
- `failureCost`: a concrete consequence if the protagonist fails;
- `escalationPath`: an ordered list of two to four pressure steps that make pursuit harder or costlier.

Keep `protagonist.desire` as the protagonist's broader want. This avoids conflating character motivation with the immediate action that starts the plot. Use a list for escalation so the model and downstream outline can reason over ordered steps; bound the list to avoid an unstructured subplot.

Alternative considered: enrich only `logline` and `coreConflict`. That avoids a contract change, but makes the four story-driving facts difficult to validate and pass to downstream stages independently.

### 2. Keep world, character, and relation output shapes stable

Update prompts to put story function into existing descriptions:

- World rules explain the limitation, cost, opportunity, or consequence they create. Factions explain their purpose and how their position intersects with the protagonist or core conflict. Type-specific settings must also produce constraints or opportunities usable in plot.
- Character `desire` expresses a concrete goal; `background` carries relevant hidden history; `flaw` or `personality` conveys a meaningful limit or boundary; `arc` connects a consequential choice to a change in the character.
- Relation `description` records current tension and the choice or event that could change the relationship.

Alternative considered: add explicit secret, boundary, conflict, and relationship-trigger fields now. That would improve field-level validation, but increases contract and UI work before confirming how downstream outline generation uses each detail. If prompt-only output proves too inconsistent, a later change can promote the highest-value details into fields.

### 3. Pass story-engine data into the outline prompt

Render all `storyEngine` fields from the confirmed premise in the context assembled for outline generation. Keep author-created premise and outline content as story data, not as instructions that can override generation rules. Coordinate the implementation with `add-outline-generation`, which owns the outline assembler and prompt. This change owns the requirement that the fields are available; it does not rewrite that change's artifacts.

For existing stored premises without `storyEngine`, keep reads and non-outline stages working. The renderer should omit the missing section or label it unavailable; it must not fabricate confirmed facts. A newly generated or explicitly regenerated premise will include the new required object.

Alternative considered: make outline generation depend on a premise regeneration. This could interrupt existing projects and discard author-approved seed content, so legacy records remain usable with the field absent until the author regenerates the seed.

## Risks / Trade-offs

- A richer required seed schema can reject old records if validated as current output → keep a legacy-safe read path and only require `storyEngine` for newly generated seed output.
- Prompt-only character and relation details can vary in specificity → map them into stable existing fields and include representative examples in prompt tests; promote fields later only if downstream needs justify it.
- The outline change may implement context assembly in parallel → make integration an explicit dependency/coordination task and avoid changing its planning artifacts here.
- Extra seed detail can lengthen model output → bound escalation to two to four concise steps and keep prompt ordering stable.

## Migration Plan

1. Extend the shared seed schema and seed prompt for newly generated premises.
2. Preserve compatibility when reading stored premises that lack `storyEngine`; do not backfill inferred facts into approved content.
3. Update the outline context assembler/prompt to pass through the confirmed fields, coordinated with the outline-generation work.
4. Update prompt and contract tests, then validate existing project reads and new seed generation.

Rollback removes the new generation requirement only with a coordinated schema change; retain the optional stored data so projects that already have `storyEngine` do not lose author-approved content.
