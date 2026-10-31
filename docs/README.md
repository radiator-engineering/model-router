# Model router documentation

Use this index for current plugin usage, contributor setup, the proposed v2 design, and its research inputs. The repository [README](../README.md) is the entry point for installation and current behavior.

## Current plugin and development

| Document | Purpose |
|---|---|
| [Development guide](development.md) | Portable checkout setup, code map, validation, and local reports |
| [Router controls](usage/router-controls.md) | Current routing switches, native configuration, manual selection, and logs |
| [Task routing](usage/task-routing.md) | Current classifier categories, model preferences, and catalog checks |
| [Model catalog](../catalog/README.md) | Editable model profiles, evidence, and generated runtime data |

## Personal development material

Use ignored `/local/` for workstation notes, private experiment records, and unredacted research. Native personal project settings and generated harness declarations have separate explicit ignore rules. Public guides retain generic paths, configuration names, and reproducible test evidence. Personal notes are optional and are absent from a normal clone.

## V2 specification

Read these documents in order:

| Document | Purpose |
|---|---|
| [Product spec](v2/product.md) | Goals, user controls, scope, examples, and acceptance criteria |
| [Architecture spec](v2/architecture.md) | Component responsibilities, logical schemas, and execution flows |
| [Decision contract](v2/decision-contract.md) | Detailed precedence, eligibility, outcomes, fallback, and boundary cases |
| [Validation plan](v2/validation.md) | Questions and evidence needed before implementation and rollout |

Status: **Draft v2 design baseline, October 31, 2026.** These documents do not establish harness support, grant model approvals, or authorize model experiments. The decision contract governs routing semantics. The product and architecture specs describe how those semantics serve the user and fit together. Resolve contradictions explicitly before implementation.

## Research inputs

[Research and development](r-and-d/README.md) contains public copies of the two supplied research files. Personal resource details have been generalized; untouched originals remain in ignored `/local/`. Benchmark, pricing, and vendor claims remain source material for validation. They do not automatically become routing rules.

Update the specs when research changes a design decision. Preserve source provenance and record new findings separately, with their sources, tested versions, and limits.
