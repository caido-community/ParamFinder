import {
  EngineState,
  RunControl,
  runDiscoveryScan,
  toEngineError,
} from "@paramfinder/engine";

import { getCliHelpText, parseCliArgs } from "./args";
import { createRunInputFromCli, NodeRequestProvider } from "./node-request";
import { createReporter } from "./reporter";
import { loadCliWords } from "./word-source";

export async function runCli(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  try {
    const options = parseCliArgs(argv);
    if (options.help) {
      process.stdout.write(`${getCliHelpText()}\n`);
      return 0;
    }

    const reporter = createReporter(options.outputMode, {
      quiet: options.quiet,
      verbose: options.verbose,
    });
    const words = await loadCliWords(options);
    const { request, engineConfig } = createRunInputFromCli(options);
    const controller = new AbortController();
    const runControl = new RunControl();
    const startedAt = Date.now();
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;

    const handleSigint = () => {
      controller.abort();
    };
    process.once("SIGINT", handleSigint);

    try {
      reporter.start({
        url: request.url,
        method: request.method,
        attackType: engineConfig.attackType,
        wordCount: words.length,
        delayMs: options.delayMs,
        timeoutMs: options.timeoutMs,
      });

      const { summary } = await runDiscoveryScan(
        {
          provider: new NodeRequestProvider(),
          sleep:
            process.env.PARAMFINDER_TEST_SKIP_SLEEP === "1"
              ? async () => undefined
              : undefined,
        },
        {
          request,
          words,
          engineConfig,
          runOptions: {
            delayMs: options.delayMs,
            timeoutMs: options.timeoutMs,
            signal: controller.signal,
            runControl,
          },
        },
        {
          onEvent: (event) => {
            reporter.handle(event);
            if (event.type === "state" && event.state === EngineState.Paused) {
              const retryDelayMs = Math.max(options.delayMs ?? 0, 250);
              if (resumeTimer) {
                clearTimeout(resumeTimer);
              }
              resumeTimer = setTimeout(() => {
                runControl.resume();
              }, retryDelayMs);
            }
          },
        },
      );

      reporter.complete({
        url: request.url,
        method: request.method,
        attackType: engineConfig.attackType,
        durationMs: Date.now() - startedAt,
        summary,
      });

      switch (summary.state) {
        case EngineState.Completed:
          return 0;
        case EngineState.Canceled:
          return 130;
        case EngineState.Timeout:
          return 2;
        case EngineState.Error:
          return 1;
        default:
          return 1;
      }
    } finally {
      if (resumeTimer) {
        clearTimeout(resumeTimer);
      }
      process.removeListener("SIGINT", handleSigint);
    }
  } catch (error) {
    createReporter("human").error(toEngineError(error).message);
    return 1;
  }
}
