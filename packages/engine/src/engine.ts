import { parseDiscoverInput, parseLearnInput, parseRunInput } from "./config";
import { toEngineError } from "./errors";
import type { DiscoveryEvent } from "./events";
import { createDiscoveryWorkflows } from "./internal/discovery-workflows";
import { createLearningWorkflows } from "./internal/learning-workflows";
import { createEngineRuntimeContext } from "./internal/runtime";
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

      runtimeContext.emit(parsed.runOptions, {
        type: "state",
        state: EngineState.Completed,
        phase,
      });
      runtimeContext.emit(parsed.runOptions, {
        type: "completed",
        state: EngineState.Completed,
        phase,
        findings: discoveryResult.findings,
        totalParametersAmount: discoveryResult.totalParametersAmount,
      });

      return createCompletedRunResult({
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
        runtimeContext.emit(parsed.runOptions, {
          type: "state",
          state: EngineState.Canceled,
          phase,
        });
        runtimeContext.emit(parsed.runOptions, {
          type: "completed",
          state: EngineState.Canceled,
          phase,
          findings: partialFindings,
          totalParametersAmount,
        });

        return createCanceledRunResult({
          phase,
          profile,
          totalParametersAmount,
          findings: partialFindings,
        });
      }

      if (engineError.code === "RUN_TIMEOUT") {
        runtimeContext.emit(parsed.runOptions, {
          type: "state",
          state: EngineState.Timeout,
          phase,
        });
        runtimeContext.emit(parsed.runOptions, {
          type: "completed",
          state: EngineState.Timeout,
          phase,
          findings: partialFindings,
          totalParametersAmount,
        });

        return createTimeoutRunResult({
          phase,
          profile,
          totalParametersAmount,
          findings: partialFindings,
        });
      }

      if (engineError.code === "PROVIDER_ERROR") {
        const failureReason = describeProviderFailure(engineError);
        runtimeContext.emit(parsed.runOptions, {
          type: "log",
          level: "error",
          message: failureReason,
        });
        runtimeContext.emit(parsed.runOptions, {
          type: "state",
          state: EngineState.Error,
          phase,
        });
        runtimeContext.emit(parsed.runOptions, {
          type: "completed",
          state: EngineState.Error,
          phase,
          findings: partialFindings,
          totalParametersAmount,
          failureReason,
        });

        return createErrorRunResult({
          phase,
          profile,
          totalParametersAmount,
          failureReason,
          findings: partialFindings,
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
