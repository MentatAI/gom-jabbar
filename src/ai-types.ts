// types that are not exported by ai kit for some reason

import { ToolInvocation } from 'ai'
import { z } from 'zod'

export type Parameters = z.ZodTypeAny
export type inferParameters<PARAMETERS extends Parameters> = PARAMETERS extends z.ZodTypeAny
  ? z.infer<PARAMETERS>
  : never

export type UIMessage = {
  role: 'system' | 'user' | 'assistant' | 'data'
  content: string
  toolInvocations?: ToolInvocation[]
}
