import { TestSuiteBuilder } from '../src'

describe('simple tests', () => {
  it('names are assigned correctly', () => {
    const builder = new TestSuiteBuilder({
      systemPrompt: 'You are a helpful assistant',
      tools: {},
      models: {},
    })
    builder.eval(
      {
        name: 'Dummy test',
        messages: [
          {
            role: 'user',
            content: 'What is the weather in my current location?',
          },
        ],
      },
      async (_arg) => {},
    )
    builder.eval('Who are you?', (_arg) => {})
    const suite = builder.build()
    expect(Object.keys(suite.tests).sort()).toEqual([
      'Dummy test',
      'Who are you?',
    ])
  })
})
