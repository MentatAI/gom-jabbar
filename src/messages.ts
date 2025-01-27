import { UIMessage } from './ai-types'

export function user(content: string): UIMessage {
  return {
    role: 'user',
    content,
  }
}

export function assistant(content: string): UIMessage {
  return {
    role: 'assistant',
    content,
  }
}

export function data(content: string): UIMessage {
  return {
    role: 'data',
    content,
  }
}

export function toolCall(toolName: string, args: any, result: any): UIMessage {
  const toolCallId = crypto.randomUUID()
  return {
    role: 'assistant',
    content: '',
    toolInvocations: [
      {
        state: 'result',
        toolCallId,
        toolName,
        args,
        result,
      },
    ],
  }
}
