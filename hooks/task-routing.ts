import type {ModelCatalog} from './model-catalog.ts'
export const ROLES = ['orchestration', 'visual-analysis', 'file-scout', 'implementation', 'investigation', 'review', 'simple-answer', 'explanation'] as const
export const IMPLEMENTATION_CATEGORIES = ['design-led', 'specified', 'mechanical', 'not-applicable'] as const
export interface TaskClassification {
  role: typeof ROLES[number]
  implementationCategory: typeof IMPLEMENTATION_CATEGORIES[number]
  roleConfidence: number | null
  categoryConfidence: number | null
}
export interface TaskPreferences {
  orchestration: string; visualAnalysis: string; designLed: string
  specified: string; mechanical: string; fileScout: string; simpleAnswer: string
}
export const DEFAULT_PREFERENCES: TaskPreferences = {
  orchestration:'claude-opus-5-5', visualAnalysis:'gpt-6-astra', designLed:'claude-opus-5-5',
  simpleAnswer:'claude-haiku-5-5', specified:'claude-sonnet-5-5', mechanical:'claude-haiku-5-5', fileScout:'claude-haiku-5-5',
}
// Examples are boundary guidance, separate from held-out evaluation fixtures.
export const TASK_EXAMPLES = [
  {task:'Spell the word blueberry.', role:'simple-answer', category:'not-applicable'},
  {task:'How many letters are in banana?', role:'simple-answer', category:'not-applicable'},
  {task:'What is the capital of France?', role:'simple-answer', category:'not-applicable'},
  {task:'Teach me how database indexes work, including tradeoffs and worked examples.', role:'explanation', category:'not-applicable'},
  {task:'Explain why counting letters can be difficult for token-based language models.', role:'explanation', category:'not-applicable'},
  {task:'Coordinate specialists and reconcile their findings into a plan.', role:'orchestration', category:'not-applicable'},
  {task:'Analyze a screenshot for alignment, hierarchy and visual defects.', role:'visual-analysis', category:'not-applicable'},
  {task:'Find files containing cache invalidation and return paths with matching lines; do not diagnose the design.', role:'file-scout', category:'not-applicable'},
  {task:'Choose service boundaries and design a system architecture with tradeoffs.', role:'implementation', category:'design-led'},
  {task:'Invent an original dashboard layout and its interaction patterns.', role:'implementation', category:'design-led'},
  {task:'Build a form from the supplied exact mockup, component references and acceptance criteria.', role:'implementation', category:'specified'},
  {task:'Implement an endpoint with an explicit schema, existing pattern and acceptance tests.', role:'implementation', category:'specified'},
  {task:'Apply this exact string replacement in a known list of files and verify no old matches remain.', role:'implementation', category:'mechanical'},
  {task:'Trace an unexplained race in token refresh before deciding on a fix.', role:'investigation', category:'not-applicable'},
] as const
export function taskQuestions(): Record<string, unknown> {
  const guidance = `Simple answers are spelling, short literal counts, direct lookups in supplied information, and straightforward stable facts requiring no synthesis. Short prompts are not automatically simple: teaching, causal reasoning, comparisons and tradeoffs are explanation; uncertain causes are investigation. Medical/legal/financial judgments and current facts requiring research are not simple answers. Classify the assignment itself, not its subject vocabulary. Architecture is design-led. Frontend implementation with an exact design is specified; original UX/UI requires design judgment. Schema/endpoints with unresolved authorization, concurrency or compatibility decisions are not routine. Mechanical means the exact edit is already given and verification is predetermined. Choosing the fix or designing boundary tests requires specified implementation, even for a local known bug. Examples: ${JSON.stringify(TASK_EXAMPLES)}`
  return {
    taskRole:{type:'choice', instructions:guidance, criteria:{
      orchestration:'Decompose, coordinate, delegate or reconcile work across agents.',
      'visual-analysis':'Interpret screenshots, visual references or rendered layouts.',
      'file-scout':'Locate files or gather paths/snippets without interpreting the system.',
      implementation:'Create a plan/design/architecture or change code; use the implementation category to express judgment required.',
      investigation:'Determine an unknown cause or understand interacting systems.',
      review:'Independently evaluate work for defects or verify its behavior.',
      'simple-answer':'Give a short literal answer: spelling, a small count, a direct supplied lookup, or a straightforward stable fact. No teaching, synthesis, investigation, research or consequential advice.',
      explanation:'Teach or explain concepts, causes, comparisons or tradeoffs, or summarize information; reasoning complexity is assessed separately by tier and effort.',
    }},
    implementationCategory:{type:'choice',instructions:guidance,criteria:{
      'design-led':'Architecture/system design, original UX/UI, or implementation requiring invention and unresolved design tradeoffs.',
      specified:'Implement an established solution with explicit contracts, specifications and references.',
      mechanical:'Apply an exact prescribed transformation, with predetermined checks and no need to choose a fix or design test cases. Small code changes alone are not mechanical.',
      'not-applicable':'The assignment is orchestration, visual analysis, file scouting, investigation, review, simple answer or explanation rather than implementation/design.',
    }},
  }
}
function confidence(answer: any): number | null {
  if (typeof answer?.confidence === 'number' && Number.isFinite(answer.confidence) && answer.confidence>=0 && answer.confidence<=1) return answer.confidence
  const values=Object.values(answer?.probabilities ?? {})
  return values.length && values.every(v=>typeof v==='number' && Number.isFinite(v) && v>=0 && v<=1) ? Math.max(...values as number[]) : null
}
export function readTaskClassification(answers: any): TaskClassification | null {
  const role=answers?.taskRole, category=answers?.implementationCategory
  if (!ROLES.includes(role?.choice) || !IMPLEMENTATION_CATEGORIES.includes(category?.choice)) return null
  if ((role.choice==='implementation') === (category.choice==='not-applicable')) return null
  return {role:role.choice, implementationCategory:category.choice,roleConfidence:confidence(role),categoryConfidence:confidence(category)}
}
export interface TaskRecommendation {
  preferredModel: string | null; model: string | null; effort: 'medium' | null; reason: string
}
export function recommendTask(task: TaskClassification | null, catalog: ModelCatalog, preferences: TaskPreferences = DEFAULT_PREFERENCES, minConfidence=0.8, risky=false): TaskRecommendation {
  const no = (reason:string,preferredModel:string|null=null):TaskRecommendation=>({preferredModel,model:null,effort:null,reason})
  if (!task) return no('missing or inconsistent task classification')
  let preferred:string|null=null
  if (task.role==='orchestration') preferred=preferences.orchestration
  else if (task.role==='visual-analysis') preferred=preferences.visualAnalysis
  else if (task.role==='simple-answer') preferred=preferences.simpleAnswer
  else if (task.role==='file-scout') preferred=preferences.fileScout
  else if (task.role==='implementation') preferred=task.implementationCategory==='design-led' ? preferences.designLed : task.implementationCategory==='specified' ? preferences.specified : preferences.mechanical
  if (!preferred) return no(`no preference for ${task.role}; retain legacy routing`)
  if (risky) return no('consequential action: retain legacy risk escalation',preferred)
  const scores=task.role==='implementation' ? [task.roleConfidence,task.categoryConfidence] : [task.roleConfidence]
  if (scores.some(x=>x===null || x<minConfidence)) return no('classification confidence below task routing threshold',preferred)
  const model=catalog.models.find(m=>m.id===preferred)
  if (!model) return no('preferred model is absent from catalog',preferred)
  if (!model.enabled || model.availability!=='verified' || model.claudeCodeCompatibility!=='verified' || model.capabilities.toolCalling!==true) return no('preferred model is disabled or its availability/tool compatibility is unverified',preferred)
  if (task.role==='orchestration' && !model.capabilities.reasoningEfforts.includes('medium')) return no('orchestration medium effort is unverified',preferred)
  return {preferredModel:preferred,model:preferred,effort:task.role==='orchestration'?'medium':null,reason:`user preference for ${task.role}/${task.implementationCategory}`}
}
