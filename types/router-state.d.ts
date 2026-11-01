/** Self-contained host contract: the Mods loader forbids imports in this file. */
export interface RouterStoredPin {
  field: 'model' | 'effort'
  value: string | number
  scope: 'assignment' | 'session' | 'persistent'
  purpose: 'execution' | 'review'
  source: string
  experimental: boolean
}
export interface RouterAssignmentPins {
  id: string
  purpose: 'execution' | 'review'
  pins: RouterStoredPin[]
  unknownOrigins: ('model' | 'effort')[]
}
export interface RouterStoredPins {
  schemaVersion: 2
  conversationId: string
  pins: {
    field: 'model' | 'effort'
    value: string | number
    scope: 'next' | 'session'
    purpose: 'execution' | 'review' | null
    origin: 'router-command' | 'coordinator' | 'unknown'
    source: string
    experimental: boolean
  }[]
  assignments: RouterAssignmentPins[]
}

declare module 'claude-code' {
  interface PluginState {
    'jev-model-router': {routerMenuOpen:boolean}
  }
}
