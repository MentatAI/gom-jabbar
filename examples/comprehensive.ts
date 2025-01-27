import { cli, expectSingleToolCall, TestSuiteBuilder, M } from '../src'
import { tool } from 'ai'
import { z } from 'zod'
import { expect } from 'expect'
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'
import dotenv from 'dotenv'

dotenv.config({
  path: '.env.evals.local',
})

const calculatorOperations = {
  add: (a: number, b: number) => a + b,
  subtract: (a: number, b: number) => a - b,
  multiply: (a: number, b: number) => a * b,
  divide: (a: number, b: number) => a / b,
}

const tools = {
  calculator: tool({
    description: 'A tool that can perform basic arithmetic operations',
    parameters: z.object({
      operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
      numbers: z.array(z.number()),
    }),
    execute: async ({ operation, numbers }) => {
      if (numbers.length < 1) return 0
      const result = numbers.slice(1).reduce((acc, num) => {
        return calculatorOperations[operation](acc, num)
      }, numbers[0])
      return result
    },
  }),
  weather: tool({
    description: 'A tool that can get the weather for a given lat/long pair',
    parameters: z.object({
      latitude: z.number(),
      longitude: z.number(),
    }),
    execute: async ({ latitude, longitude }) => {
      return {
        temperature: 20,
        condition: 'sunny',
      }
    },
  }),
  geocoder: tool({
    description: 'A tool that can geocode a given location (outputs lat/long)',
    parameters: z.object({
      location: z.string(),
    }),
    execute: async ({ location }) => {
      return {
        latitude: 1,
        longitude: 2,
      }
    },
  }),
  getUserLocation: tool({
    description: "A tool that can get the user's current location (lat/long)",
    parameters: z.object({}),
    execute: async () => {
      return {
        latitude: 1,
        longitude: 2,
      }
    },
  }),
}

const suite = new TestSuiteBuilder({
  tools,
  systemPrompt:
    'You are a helpful assistant that can use tools to answer questions.',
  models: {
    '4o': openai('gpt-4o-2024-08-06'),
    '4o-mini': openai('gpt-4o-mini'),
    haiku: anthropic('claude-3-haiku-20240307'),
    sonnet: anthropic('claude-3-5-sonnet-20240620'),
  },
})

suite.eval('What is 1337 * 42?', async ({ result }) => {
  const toolParams = expectSingleToolCall(result, 'calculator')
  expect(toolParams.operation).toBe('multiply')
  expect(toolParams.numbers).toEqual([1337, 42])
})

suite.eval('What is 42 + 42?', async ({ result }) => {
  const toolParams = expectSingleToolCall(result, 'calculator')
  expect(toolParams.operation).toBe('add')
  expect(toolParams.numbers).toEqual([42, 42])
})

suite.eval('What is my current lat/long?', async ({ result }) => {
  expectSingleToolCall(result, 'getUserLocation')
})

suite.eval(
  {
    name: 'should start by getting the users lat/long',
    messages: [
      {
        role: 'user',
        content: 'What is the weather in my current location?',
      },
    ],
  },
  async ({ result }) => {
    expectSingleToolCall(result, 'getUserLocation')
  },
)

suite.eval(
  {
    name: 'should use the users lat/long to get the weather',
    messages: [
      M.user('What is the weather in my current location?'),
      M.toolCall(
        'getUserLocation',
        {},
        {
          latitude: 42,
          longitude: 84,
        },
      ),
    ],
  },
  async ({ result }) => {
    const toolParams = expectSingleToolCall(result, 'weather')
    expect(toolParams.latitude).toBe(42)
    expect(toolParams.longitude).toBe(84)
  },
)

suite.eval(
  {
    name: 'should tell the user the weather',
    messages: [
      M.user('What is the weather in my current location?'),
      M.toolCall(
        'getUserLocation',
        {},
        {
          latitude: 42,
          longitude: 84,
        },
      ),
      M.toolCall(
        'weather',
        {
          latitude: 42,
          longitude: 84,
        },
        {
          temperature: 20,
          condition: 'sunny',
        },
      ),
    ],
  },
  async ({ result }) => {
    expect(result.text).toContain('sunny')
  },
)

cli(suite.build())
