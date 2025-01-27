import { cli, expectSingleToolCall, TestSuiteBuilder } from '../src'
import { tool } from 'ai'
import { z } from 'zod'
import { expect } from 'expect'
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'
import dotenv from 'dotenv'

dotenv.config({
  path: '.env.evals.local',
})

// Typically, you would import your tools from elsewhere in your codebase,
// but for this example, we'll just define them here. Ideally you should
// use the exact same tools for your evals that you use in your production
// code.
const tools = {
  add: tool({
    description: 'A tool that can add two numbers',
    parameters: z.object({
      lhs: z.number(),
      rhs: z.number(),
    }),
    execute: async ({ lhs, rhs }) => {
      // In this case, the code here doesnt matter because gom-jabbar
      // never executes your tools during evaluation.
      return lhs + rhs
    },
  }),
}

// Your test suite builder is initialized with your tools, system prompt,
// and models. Define all the models you want to evaluate here.
const suite = new TestSuiteBuilder({
  tools,
  systemPrompt:
    'You are a helpful assistant that can use tools to answer questions.',
  models: {
    // It is considered a best practice to use exact model versions for evals
    // so that you can pinpoint regressions easier. These models can also be imported
    // from your application code, including middleware!
    o1: openai('o1-2024-12-17'),
    gpt4o: openai('gpt-4o-2024-08-06'),
    haiku: anthropic('claude-3-haiku-20240307'),
    sonnet: anthropic('claude-3-5-sonnet-20240620'),
  },
})

suite.eval('What is 2 + 4?', async ({ result }) => {
  const toolParams = expectSingleToolCall(result, 'add')
  // `toolParams` is strongly typed based on the tool definition
  // and you can use expect to assert dynamic properties.
  expect(toolParams.lhs).toBe(2)
  expect(toolParams.rhs).toBe(4)
})

// Finally, you can build your test suite and run the cli.
// Now you can run a benchmark by calling this file with the benchmark command.
cli(suite.build())
