import { CoreMessage, CoreTool, generateText, GenerateTextResult, LanguageModel } from 'ai'
import { UIMessage } from './ai-types'
export interface EvalParams<TOOLS extends Record<string, CoreTool>> {
  result: GenerateTextResult<TOOLS, string>
}

export interface EvalTestCase<TOOLS extends Record<string, CoreTool>> {
  name: string
  messages: Array<UIMessage>
  test: (params: EvalParams<TOOLS>) => void | Promise<void>
}

export type EvalArgs =
  | string
  | {
      name: string
      messages: Array<UIMessage>
    }

export class TestSuiteBuilder<TOOLS extends Record<string, CoreTool>> {
  private tools: TOOLS
  private systemPrompt: string
  private tests: EvalTestCase<TOOLS>[] = []
  private models: Record<string, LanguageModel> = {}

  constructor({
    tools,
    systemPrompt,
    models,
  }: {
    tools: TOOLS
    systemPrompt: string
    models: Record<string, LanguageModel>
  }) {
    this.tools = tools
    this.systemPrompt = systemPrompt
    this.models = models
  }

  addModel(identifier: string, model: LanguageModel) {
    this.models[identifier] = model
  }

  eval(arg: EvalArgs, test: (params: EvalParams<TOOLS>) => void | Promise<void>) {
    let testCase: EvalTestCase<TOOLS>
    if (typeof arg === 'string') {
      testCase = {
        name: arg,
        messages: [
          {
            role: 'user',
            content: arg,
          },
        ],
        test,
      }
    } else {
      testCase = {
        name: arg.name,
        messages: arg.messages,
        test,
      }
    }
    for (const [idx, message] of testCase.messages.entries()) {
      if (message.role === 'system') {
        throw new Error(
          `messages[${idx}] cannot be a system message -- the system message is set by the systemPrompt option`,
        )
      }
    }
    this.tests.push(testCase)
  }

  build() {
    return new TestSuite({
      tools: this.tools,
      systemPrompt: this.systemPrompt,
      tests: this.tests,
      models: this.models,
    })
  }
}

export type EvalResult<TOOLS extends Record<string, CoreTool>> =
  | {
      type: 'failed-to-generate'
      completion: undefined
      completionError: string
      testError: undefined
    }
  | {
      type: 'test-failed'
      completion: GenerateTextResult<TOOLS, never>
      completionError: undefined
      testError: string
    }
  | {
      type: 'test-passed'
      completion: GenerateTextResult<TOOLS, never>
      completionError: undefined
      testError: undefined
    }

export function isSuccess<TOOLS extends Record<string, CoreTool>>(result: EvalResult<TOOLS>) {
  return result.type === 'test-passed'
}

export class TestSuite<TOOLS extends Record<string, CoreTool>> {
  readonly tools: TOOLS
  readonly systemPrompt: string
  readonly tests: EvalTestCase<TOOLS>[] = []
  readonly models: Record<string, LanguageModel> = {}

  constructor({
    tools,
    systemPrompt,
    tests,
    models,
  }: {
    tools: TOOLS
    systemPrompt: string
    tests: EvalTestCase<TOOLS>[]
    models: Record<string, LanguageModel>
  }) {
    this.tools = { ...tools }
    this.systemPrompt = systemPrompt
    this.tests = [...tests]
    this.models = { ...models }

    for (const tool of Object.values(this.tools)) {
      tool.execute = undefined
    }
  }

  findModel(identifier: string): LanguageModel {
    const model = this.models[identifier]
    if (!model) {
      throw new Error(`Model not found: ${identifier}`)
    }
    return model
  }

  findEval(name: string): EvalTestCase<TOOLS> {
    const testCase = this.tests.find((t) => t.name === name)
    if (!testCase) {
      throw new Error(`Eval not found: ${name}`)
    }
    return testCase
  }

  shuffleEvals(): EvalTestCase<TOOLS>[] {
    const shuffled = [...this.tests]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
  }

  async runTestCase(
    testCase: EvalTestCase<TOOLS>,
    model: LanguageModel,
  ): Promise<EvalResult<TOOLS>> {
    let result: GenerateTextResult<TOOLS, never>
    try {
      result = await generateText({
        model,
        system: this.systemPrompt,
        tools: this.tools,
        messages: testCase.messages,
      })
    } catch (error) {
      return {
        type: 'failed-to-generate',
        completion: undefined,
        completionError: `Error generating completion: ${error}`,
        testError: undefined,
      }
    }
    try {
      await testCase.test({ result })
      return {
        type: 'test-passed',
        completion: result,
        completionError: undefined,
        testError: undefined,
      }
    } catch (error) {
      return {
        type: 'test-failed',
        completion: result,
        completionError: undefined,
        testError: `Error running test: ${error}`,
      }
    }
  }
}
