# Jev options and v2 role coverage

Date: 2026-11-01. Scope: source-backed classifier limits, task taxonomy and configured routing hypotheses. This is not a workload-quality approval or authorization to spend model allowance.

## What the option-count evidence establishes

- The [official Choice documentation](https://docs.typesafe.ai/primitives/choice.md) permits **255 options per question**. This is an API ceiling, not an optimal taxonomy size. It recommends discriminative descriptions, inclusions/exclusions and examples for confused labels.
- The [classification cookbook](https://docs.typesafe.ai/cookbooks/classification_using_confidence) claims reliable operation up to **roughly 240 options** and demonstrates a 75-category task. Its filtered 60-example confidence demonstration is not a controlled option-count sweep.
- [Evaluating and Benchmarking the System One Model Jev, revision October 29, 2026](https://arxiv.org/html/2609.37647v2), evaluates Jev-1.13.0: BANKING77 has 77 choices and 79.7% accuracy; CLINC150 has 151 choices including out-of-scope and 89.5% overall accuracy. These are different tasks, not evidence that increasing choices improves accuracy or a measured count–accuracy curve.
- [Jev 1.13 weaknesses](https://docs.typesafe.ai/model-jaggedness/jev-1.13) warns about literal interpretation, incomplete criteria and option-position bias. Reordering choices is a useful sensitivity test, not proof of universal stability.
- The [hierarchical-classification cookbook](https://docs.typesafe.ai/cookbooks/hierarchical_classification) discusses large/deep taxonomies and early-error propagation. It supplies no numerical threshold at which this router needs a hierarchy.

There is **no established small-count cliff** at 8, 10 or 20 options. The earlier suggested 8–12 roles was a maintainability preference, not a capacity limit. Additional distinct roles are reasonable; count alone does not make them useful. The router retains separate questions for role, specification, verification, span and consequence rather than enumerating every role/model/effort combination.

## Classification boundaries

Choose the primary requested deliverable, not vocabulary or a model name. Mixed assignments use these boundaries:

| Role | Includes | Excludes / tie-break |
|---|---|---|
| `simple-answer` | Short literal/stable facts; standalone greetings and thanks | Explanations, approvals and context-free continuations |
| `explanation` | Teach concepts, explain causes or compare known concepts | Condensing a supplied document; fresh external evidence gathering |
| `summarization` | Condense supplied content without adding new findings | Original writing, translation, external research |
| `writing` | Create/edit non-code prose, emails, copy and documents | Choosing architecture/strategy is planning; rewriting source code is implementation |
| `translation` | Preserve meaning while changing natural language | Explaining language concepts; implementing application localization |
| `extraction` | Extract/classify/reformat supplied facts into a requested schema | Deriving statistics or new quantitative conclusions |
| `data-analysis` | Compute/interpret quantitative trends, statistics and supplied datasets | Abstract proofs/formulas are mathematics; extracting numbers is extraction |
| `mathematics` | Solve multi-step mathematical/formal-logic problems, derive formulas or construct proofs | Literal counts are simple answers; teaching concepts is explanation; dataset statistics are data analysis |
| `research` | Find and verify external/current evidence and synthesize sources | Explaining stable knowledge or diagnosing a concrete software failure |
| `planning` | Choose a strategy, architecture or actionable plan without implementation yet | Coordinating named agents is orchestration; implementing the plan is implementation |
| `implementation` | Create/change code, tests or configuration; implement a design | Planning-only deliverables; executing existing commands without code changes |
| `investigation` | Diagnose an unknown cause in code, logs or interacting systems | General external research; applying an already prescribed fix |
| `operations` | Execute/inspect an existing workflow, command, service or tool without authoring code | Writing the workflow/code itself; deployment risk still follows consequence constraints |
| `review` | Evaluate an existing artifact for defects or conformance | Authoring a replacement; ordinary review prose grants no independent-review authority |
| `orchestration` | Delegate, coordinate agents and reconcile their work | A single-author plan or roadmap |
| `visual-analysis` | Interpret images, screenshots or rendered layouts | Implementing UI from references; numerical dataset analysis |
| `file-scout` | Locate files and return paths/snippets | Diagnosing or synthesizing what the located code means |
| `unknown` | Missing intent/context or genuinely ambiguous assignment | Never a universal cheap-model default |

These are operational definitions, not a claim that natural-language categories never overlap. Specific transformation/output roles take precedence over a generic request to “write”; planning dominates the document format when new architectural decisions are the deliverable. A bare “continue” or approval without the underlying task stays unknown. Explicit requirements and risk constraints apply independently.

## Model selection evidence and choices

- [OpenAI model-selection guidance](https://developers.openai.com/api/docs/guides/model-selection) recommends **GPT-6.1 Terra** for brief grounded writing, scoped code fixes and verifiable computer-use tasks, and **Luna at low effort** for extraction and constrained work. It does not establish superiority on translation or summarization. Using Luna for source-grounded text transformations is a configured hypothesis requiring task checks, not a measured benchmark ranking.
- [Sonnet 5.5 announcement](https://www.anthropic.com/claude-sonnet-5-5) positions it for bounded everyday coding and document work. It reports Terminal-Bench 4.0 at 70.6%, but effort/harness choices matter; this does not prove an explanation-quality ranking. Sonnet is the general bounded explanation/analysis/review default here as an explicit policy choice.
- [Fable 5.1 overview](https://platform.claude.com/docs/en/models/fable-5-1/overview) identifies `claude-fable-5-1` for demanding reasoning and long-horizon agentic coding, research and document work; it recommends starting most workloads on Opus 5.5. Fable's default API effort is high. Do not spend Fable on every planning or research request simply because its name appears in a category.

Exact observed IDs are `gpt-6.1-terra`, `gpt-6-luna` and `claude-fable-5-1`; discovery is not compatibility. Read-only local `/v1/models` discovery advertised all three. On Claude Code 2.1.316, bounded governed Bash `printf` probes succeeded for Terra/medium and Luna/low and reported the requested model identities. These establish basic text/tool compatibility only; proxy version, actual serving effort, quality and subscription consumption remain unknown.

The Fable/high probe returned **HTTP 429: usage credits are required**. No account/credential/billing changes or alternate-route retries were attempted. The long-horizon default therefore remains Opus/medium; Fable is a configurable candidate, not a silently enabled production path. Explicit unavailable pins remain failures. Future successful qualification must update the evidence rather than treating advertisement as success.

Raw private discovery/probe reports remain under ignored `test-results/role-*`. Existing legacy classifier questions, model defaults and the raw legacy catalog snapshot remain unchanged. Configured recommendations and empirical workload approvals remain separate.

A first 35-case live classification pass matched all role labels, but the formal-proof example had only 0.57 role confidence under the broad data-analysis label. The taxonomy therefore separates `mathematics` from dataset/statistical analysis rather than lowering the threshold. The final fixture labels reflect that explicit semantic refinement; results are development evidence, not a held-out estimate.
