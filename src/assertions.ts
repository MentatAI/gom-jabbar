import { CoreTool } from 'ai'
import { z } from 'zod'
import { EvalParams } from './suite'
import { expect } from 'expect'
import { inferParameters } from './ai-types'

export function expectSingleToolCall<TOOLS extends Record<string, CoreTool>, T extends keyof TOOLS>(
  result: EvalParams<TOOLS>['result'],
  toolName: T,
): inferParameters<TOOLS[T]['parameters']> {
  expect(result.toolCalls.length).toBe(1)
  expect(result.toolCalls[0].toolName).toBe(toolName)
  return result.toolCalls[0].args
}
