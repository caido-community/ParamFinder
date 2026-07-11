import { parseDiscoverInput, parseLearnInput, parseRunInput } from "./config";
import { toEngineError } from "./errors";
import type { DiscoveryEvent } from "./events";
import { createDiscoveryWorkflows } from "./internal/discovery-workflows";
import { createLearningWorkflows } from "./internal/learning-workflows";
import {
  createEngineRuntimeContext,
  type EngineRuntimeContext,
} from "./internal/runtime";
import {
  createCanceledRunResult,
  createCompletedRunResult,
  createErrorRunResult,
  createTimeoutRunResult,
  describeProviderFailure,
  getConfiguredMaxSize,
  requireProfile,
} from "./internal/shared";
import { extractWordsFromResponseBody } from "./learn";
import type { EngineDependencies } from "./provider";
import { EnginePhase, EngineState } from "./types";
import type {
  BaselineProfile,
  EngineDiscoverInput,
  EngineLearnInput,
  EngineRunInput,
  EngineRunResult,
  Finding,
  RunOptions,
} from "./types";
import { sanitizeWords } from "./utils";

export function createDiscoveryEngine(dependencies: EngineDependencies) {
  const createExecution = (timeoutMs?: number) => {
    const runtimeContext = createEngineRuntimeContext(dependencies, {
      timeoutMs,
    });
    const learningWorkflows = createLearningWorkflows(runtimeContext);
    const discoveryWorkflows = createDiscoveryWorkflows(runtimeContext, {
      handleAutopilotResponse: learningWorkflows.handleAutopilotResponse,
    });
    return { runtimeContext, learningWorkflows, discoveryWorkflows };
  };

  const learn = async (input: EngineLearnInput) => {
    const parsed = parseLearnInput(input);
    const execution = createExecution(parsed.runOptions?.timeoutMs);
    try {
      return await execution.learningWorkflows.performLearning(parsed);
    } finally {
      execution.runtimeContext.dispose();
    }
  };

  const discover = async (input: EngineDiscoverInput) => {
    const parsed = parseDiscoverInput(input);
    const execution = createExecution(parsed.runOptions?.timeoutMs);
    try {
      return await execution.discoveryWorkflows.performDiscovery(parsed);
    } finally {
      execution.runtimeContext.dispose();
    }
  };

  const run = async (input: EngineRunInput): Promise<EngineRunResult> => {
    const parsed = parseRunInput(input);
    const { runtimeContext, learningWorkflows, discoveryWorkflows } =
      createExecution(parsed.runOptions?.timeoutMs);
    const initialWords = sanitizeWords(parsed.words);
    let phase = EnginePhase.Learning;
    let profile: BaselineProfile | undefined;
    let totalParametersAmount = initialWords.length;
    const partialFindings: Finding[] = [];

    try {
      const learningResult = await learningWorkflows.performLearning({
        request: parsed.request,
        engineConfig: parsed.engineConfig,
        runOptions: parsed.runOptions,
      });
      profile = learningResult.profile;

      if (parsed.engineConfig.autoDetectMaxSize) {
        profile.maxSize = await learningWorkflows.guessMaxSize(
          parsed.request,
          parsed.engineConfig,
          profile,
          parsed.runOptions,
        );
      } else {
        profile.maxSize = getConfiguredMaxSize(parsed.engineConfig);
      }

      if (parsed.engineConfig.wafDetection) {
        profile.wafResponse = await learningWorkflows.checkForWaf(
          parsed.request,
          parsed.engineConfig,
          profile,
          parsed.runOptions,
        );
      }

      let words = [...initialWords];
      if (parsed.engineConfig.additionalChecks) {
        const additionalChecks =
          await learningWorkflows.performAdditionalChecks(
            parsed.request,
            parsed.engineConfig,
            profile,
            parsed.runOptions,
          );
        profile.additionalChecks = additionalChecks;
        words = learningWorkflows.applyAdditionalChecks(
          words,
          additionalChecks,
        );
      }

      words = sanitizeWords([
        ...words,
        ...extractWordsFromResponseBody(
          profile.initialRequestResponse.response.body ?? "",
        ),
      ]);
      totalParametersAmount = words.length;

      runtimeContext.emit(parsed.runOptions, {
        type: "adjustTotalParameters",
        totalParametersAmount,
      });

      phase = EnginePhase.Discovery;
      const discoveryRunOptions = {
        ...parsed.runOptions,
        onEvent: (event: DiscoveryEvent) => {
          if (event.type === "finding") {
            partialFindings.push(event.finding);
          }
          parsed.runOptions?.onEvent?.(event);
        },
      };
      const discoveryResult = await discoveryWorkflows.performDiscovery({
        request: parsed.request,
        words,
        engineConfig: parsed.engineConfig,
        profile,
        runOptions: discoveryRunOptions,
      });

      return finalizeRun(runtimeContext, parsed.runOptions, {
        state: EngineState.Completed,
        phase,
        findings: discoveryResult.findings,
        profile: requireProfile(
          profile,
          "Baseline profile missing after learning completed",
        ),
        totalParametersAmount: discoveryResult.totalParametersAmount,
      });
    } catch (error) {
      const engineError = toEngineError(error);
      if (engineError.code === "RUN_ABORTED") {
        return finalizeRun(runtimeContext, parsed.runOptions, {
          state: EngineState.Canceled,
          phase,
          profile,
          findings: partialFindings,
          totalParametersAmount,
        });
      }

      if (engineError.code === "RUN_TIMEOUT") {
        return finalizeRun(runtimeContext, parsed.runOptions, {
          state: EngineState.Timeout,
          phase,
          profile,
          findings: partialFindings,
          totalParametersAmount,
        });
      }

      if (engineError.code === "PROVIDER_ERROR") {
        const failureReason = describeProviderFailure(engineError);
        runtimeContext.emit(parsed.runOptions, {
          type: "log",
          level: "error",
          message: failureReason,
        });
        return finalizeRun(runtimeContext, parsed.runOptions, {
          state: EngineState.Error,
          phase,
          profile,
          findings: partialFindings,
          totalParametersAmount,
          failureReason,
        });
      }

      runtimeContext.emit(parsed.runOptions, {
        type: "state",
        state: EngineState.Error,
        phase,
      });
      throw engineError;
    } finally {
      runtimeContext.dispose();
    }
  };

  return {
    learn,
    discover,
    run,
  };
}

type FinalizeRunArgs =
  | (Parameters<typeof createCompletedRunResult>[0] & {
      state: EngineState.Completed;
      phase: EnginePhase.Discovery;
    })
  | (Parameters<typeof createCanceledRunResult>[0] & {
      state: EngineState.Canceled;
    })
  | (Parameters<typeof createTimeoutRunResult>[0] & {
      state: EngineState.Timeout;
    })
  | (Parameters<typeof createErrorRunResult>[0] & {
      state: EngineState.Error;
    });

function finalizeRun(
  runtimeContext: EngineRuntimeContext,
  runOptions: RunOptions | undefined,
  args: FinalizeRunArgs,
): EngineRunResult {
  runtimeContext.emit(runOptions, {
    type: "state",
    state: args.state,
    phase: args.phase,
  });
  let result: EngineRunResult;
  switch (args.state) {
    case EngineState.Completed:
      result = createCompletedRunResult(args);
      break;
    case EngineState.Canceled:
      result = createCanceledRunResult(args);
      break;
    case EngineState.Timeout:
      result = createTimeoutRunResult(args);
      break;
    case EngineState.Error:
      result = createErrorRunResult(args);
      break;
  }

  const { profile: _profile, ...summary } = result;
  runtimeContext.emit(runOptions, { type: "completed", ...summary });
  return result;
}
