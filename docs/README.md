# Model router documentation

Use this index for current plugin usage, contributor setup, the implemented v2 design, and its research inputs. The repository [README](../README.md) is the entry point for installation and current behavior.

## Current plugin and development

| Document | Purpose |
|---|---|
| [Development guide](development.md) | Portable checkout setup, code map, validation, and local reports |
| [Router controls](usage/router-controls.md) | Current routing switches, native configuration, manual selection, and logs |
| [Task routing](usage/task-routing.md) | Current classifier categories, model preferences, and catalog checks |
| [Model catalog](../catalog/README.md) | Editable model profiles, evidence, and generated runtime data |
| [Harness contract probes](../experiments/harness-contracts/README.md) | Isolated, offline native-host checks for v2 integration primitives |

## Personal development material

Use ignored `/local/` for workstation notes, private experiment records, and unredacted research. Native personal project settings and generated harness declarations have separate explicit ignore rules. Public guides retain generic paths, configuration names, and reproducible test evidence. Personal notes are optional and are absent from a normal clone.

## V2 specification

Start with the [official v2 design brief](v2/design-brief.md). It consolidates the product direction, selected architecture, control interfaces, alternatives, implementation plan, and release gates. The November 1 ownership revision and native integration supersede the October 31 offline-only checkpoint; model-quality claims still require separate evidence.

The supporting documents have narrower responsibilities:

| Document | Purpose |
|---|---|
| [Design brief](v2/design-brief.md) | Entry point and selected product/architecture decisions |
| [C4 overview](v2/c4-overview.md) | System context and the components inside the router Mod |
| [Implementation handoff](v2/implementation-handoff.md) | Starting point for a fresh coding session, final clarifications, and delivery checkpoints |
| [Product spec](v2/product.md) | Goals, user controls, scope, examples, and acceptance criteria |
| [Architecture spec](v2/architecture.md) | Component responsibilities, logical schemas, and execution flows |
| [Decision contract](v2/decision-contract.md) | Detailed precedence, eligibility, outcomes, fallback, and boundary cases |
| [Runtime contracts](v2/runtime-contracts.md) | Catalog schema/migration, candidate enrollment, and trusted-check interfaces |
| [Validation plan](v2/validation.md) | Recorded offline/live evidence and remaining quality research |

Status: **Configured native v2 integration, November 1, 2026.** These documents do not grant model approvals or authorize model experiments. The brief owns selected product/architecture choices, the decision contract governs routing semantics, runtime contracts define stored data and authority-bearing inputs, and validation records the evidence for each enabled path. Resolve contradictions explicitly before implementation.

## Research inputs

[Research and development](r-and-d/README.md) contains public copies of the two supplied research files. Personal resource details have been generalized; untouched originals remain in ignored `/local/`. Benchmark, pricing, and vendor claims remain source material for validation. They do not automatically become routing rules.

The [Claude Mods harness validation](r-and-d/03-claude-code-mods-harness-validation.md) records official capabilities, primary community evidence, local offline results, and the remaining live checks.

Update the specs when research changes a design decision. Preserve source provenance and record new findings separately, with their sources, tested versions, and limits.

## V2 implementation checkpoint

Phases 1–7 and the configured native integration are implemented; empirical workload-quality certification remains separate. Start with [controls, candidates and rollback](usage/router-controls.md#v2-controls-and-pins), [actual validation evidence](v2/validation.md#configured-native-integration--november-1-2026) and [native runtime boundaries](v2/runtime-contracts.md#phases-57-native-integration). The [development guide](development.md#offline-v2-checks-and-release-boundary) lists reproducible checks. Legacy is still the default, and synthetic native/replay evidence is not a workload approval.
