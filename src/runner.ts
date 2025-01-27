import { CoreTool } from 'ai'
import yargs from 'yargs/yargs'
import CliTable3 from 'cli-table3'
import cliCursor from 'cli-cursor'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import PQueue from 'p-queue'
import { EvalResult, TestSuite } from './suite'
import { assertNever } from './utils'
import { UIMessage } from './ai-types'

const STATUS = {
  WAITING: '⏳',
  RUNNING: '🔄',
  SUCCESS: '✅',
  TEST_FAILURE: '❌',
  GENERATION_FAILURE: '👎',
} as const

type StatusType = (typeof STATUS)[keyof typeof STATUS]

const MAX_LOGS = 1000

export interface EvalLogItem<TOOLS extends Record<string, CoreTool>> {
  testCase: string
  model: string
  messages: UIMessage[]
  result: EvalResult<TOOLS>
}

async function runCli<TOOLS extends Record<string, CoreTool>>(suite: TestSuite<TOOLS>) {
  const allModelChoices = Array.from(Object.keys(suite.models)).sort()
  await yargs(process.argv.slice(2))
    .command({
      command: 'benchmark',
      describe: 'Run eval suite, comparing outputs between different models',
      builder: (yargs) =>
        yargs.options({
          models: {
            type: 'string',
            describe:
              'Model or models to use for benchmarking, if not specified, all models will be used.',
            array: true,
            choices: allModelChoices,
            default: allModelChoices,
          },
          limit: {
            type: 'number',
            describe:
              'Limit the number of evals to run, if not specified or 0, all evals will be run.',
            default: 0,
          },
          verbose: {
            type: 'boolean',
            default: false,
            describe: 'Show verbose output.',
          },
          randomize: {
            type: 'boolean',
            default: true,
            describe: 'Randomize the order of the evals.',
          },
        }),
      handler: (argv) => runBenchmarkCommand(suite, argv),
    })
    .command({
      command: 'inspect',
      describe: 'Run individual eval and dump the input/output to the console',
      builder: (yargs) =>
        yargs.options({
          model: {
            type: 'string',
            default: allModelChoices.length > 0 ? allModelChoices[0] : undefined,
            choices: allModelChoices,
            demandOption: true,
          },
          'eval-id': {
            type: 'string',
            choices: suite.tests
              .map((t) => t.name)
              .filter((id): id is string => id !== undefined)
              .sort(),
            demandOption: true,
          },
        }),
      handler: (argv) => runInspectCommand(suite, argv),
    })
    .demandCommand()
    .parse()
}

async function runInspectCommand<TOOLS extends Record<string, CoreTool>>(
  suite: TestSuite<TOOLS>,
  argv: { model: string; evalId: string },
) {
  const model = suite.findModel(argv.model)
  const selectedTestCase = suite.findEval(argv.evalId)
  console.log(`Running ${selectedTestCase.name} with ${argv.model}`)
  const evalResult = await suite.runTestCase(selectedTestCase, model)
  console.log(evalResult)
}

async function runBenchmarkCommand<TOOLS extends Record<string, CoreTool>>(
  suite: TestSuite<TOOLS>,
  argv: { models: string[]; limit: number; verbose: boolean; randomize: boolean },
) {
  const logMessages: string[] = []
  // Generate unique session ID and create log file path
  const sessionId = uuidv4()
  const logDir = 'eval-out'
  const logPath = path.join(logDir, `${sessionId}.jsonl`)

  await fs.mkdir(logDir, { recursive: true })

  const modelNames = [...argv.models].sort()
  const selectedModels = modelNames
    .map((modelId) => suite.findModel(modelId))
    .filter((m): m is NonNullable<typeof m> => m !== undefined)

  // const selectedTestCases = (argv.randomize ? suite.shuffleEvals() : Array.from(suite.tests)).slice(
  //   0,
  //   Math.min(argv.limit, suite.tests.length),
  // )
  const selectedTestCases = suite.tests

  // Initialize table
  const table = new CliTable3({
    head: ['Test Case', ...modelNames],
  }) as CliTable3.GenericTable<CliTable3.HorizontalTableRow>

  // Initialize status matrix
  const statusMatrix = selectedTestCases.map((_test) =>
    selectedModels.map(() => STATUS.WAITING as StatusType),
  )

  // Fill initial table
  selectedTestCases.forEach((test, i) => {
    table.push([test.name, ...statusMatrix[i]])
  })

  // Hide cursor and render initial table
  cliCursor.hide()
  console.clear()
  renderTableAndLogs()

  const toRunByModel: Record<string, (() => Promise<void>)[]> = {}

  // Run all test cases for all models
  for (let modelIndex = 0; modelIndex < selectedModels.length; modelIndex++) {
    const model = selectedModels[modelIndex]
    const modelName = modelNames[modelIndex]
    for (let testIndex = 0; testIndex < selectedTestCases.length; testIndex++) {
      const testCase = selectedTestCases[testIndex]
      const testCaseName = testCase.name

      async function runEval() {
        // Update status to running
        statusMatrix[testIndex][modelIndex] = STATUS.RUNNING
        updateTable(testIndex, modelIndex)
        addLog(`${STATUS.RUNNING} Running ${testCaseName} with ${modelName}`)
        const evalResult = await suite.runTestCase(testCase, model)
        if (evalResult.type === 'test-passed') {
          statusMatrix[testIndex][modelIndex] = STATUS.SUCCESS
          addLog(`✅ ${testCaseName} with ${modelName}: Success`)
        } else {
          if (evalResult.type === 'failed-to-generate') {
            statusMatrix[testIndex][modelIndex] = STATUS.GENERATION_FAILURE
          } else if (evalResult.type === 'test-failed') {
            statusMatrix[testIndex][modelIndex] = STATUS.TEST_FAILURE
          } else {
            assertNever(evalResult)
          }
          addLog(
            `❌ ${testCaseName} with ${modelName}, ${evalResult.type}: ${evalResult.testError}`,
          )
        }
        updateTable(testIndex, modelIndex)
        const evalLogItem = {
          testCase: testCaseName,
          model: modelName,
          messages: testCase.messages,
          result: evalResult,
        } satisfies EvalLogItem<TOOLS>

        // Write eval log item to JSONL file asynchronously
        await fs.appendFile(logPath, `${JSON.stringify(evalLogItem)}\n`)
      }
      const queueName = `${model.provider}/${modelName}`
      if (!toRunByModel[queueName]) {
        toRunByModel[queueName] = []
      }
      toRunByModel[queueName].push(runEval)
    }
  }

  // process evals in parallel
  const maxConcurrency = 3

  // Run all tasks in parallel for each model, respecting the concurrency limit per model
  await Promise.all(
    Object.entries(toRunByModel).map(async ([modelId, evals]) => {
      const queue = new PQueue({ concurrency: maxConcurrency })
      addLog(
        `Starting queue for ${modelId} with ${evals.length} evals and max concurrency ${maxConcurrency}`,
      )
      await queue.addAll(evals)
      // await queue.onIdle()
      addLog(`Finished processing all evals for ${modelId}`)
    }),
  )

  // Show cursor again before exiting
  cliCursor.show()

  function updateTable(testIndex: number, modelIndex: number) {
    table[testIndex][modelIndex + 1] = statusMatrix[testIndex][modelIndex]
    renderTableAndLogs()
  }

  function addLog(message: string) {
    logMessages.push(`${new Date().toISOString()}: ${message}`)
    if (logMessages.length > MAX_LOGS) {
      logMessages.shift()
    }
    renderTableAndLogs()
  }

  function renderTableAndLogs() {
    console.clear()

    const columns = process.stdout.columns
    const totalRows = process.stdout.rows

    // We'll track how many lines we've printed so far
    let linesPrinted = 0
    const incrementLineCount = (count = 1) => {
      linesPrinted += count
    }

    // Helper to print a single line and increment the count
    function printLine(text: string) {
      console.log(text)
      incrementLineCount()
    }

    // Print session info
    printLine(`Session: ${sessionId}`)
    printLine(`Log file: ${logPath}`)

    // Print a separator line
    printLine('')
    printLine('─'.repeat(columns))

    // Print the table
    const tableStr = table.toString()
    const tableLines = tableStr.split(/\r?\n/)
    tableLines.forEach((line) => printLine(line))

    // Print another separator line
    printLine('')
    printLine('─'.repeat(columns))

    // Print logs header
    printLine('Recent Logs:')

    // Calculate how many rows remain for logs
    const remainingRows = totalRows - linesPrinted
    if (remainingRows > 0) {
      // Decide how many logs to show
      const logsToShow = logMessages.slice(-remainingRows)
      logsToShow.forEach((msg) => printLine(msg))
    }
  }
}

export function cli<TOOLS extends Record<string, CoreTool>>(suite: TestSuite<TOOLS>) {
  runCli(suite).catch(console.error)
}
