import { parseDiscoverInput, parseLearnInput, parseRunInput } from "./config";
import { toEngineError } from "./errors";
import type { DiscoveryEvent } from "./events";
import { createDiscoveryWorkflows } from "./internal/discovery-workflows";
import { createLearningWorkflows } from "./internal/learning-workflows";
import { createEngineRuntime, type EngineRuntime } from "./internal/runtime";
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
    const runtime = createEngineRuntime(dependencies, {
      timeoutMs,
    });
    const learningWorkflows = createLearningWorkflows(runtime);
    const discoveryWorkflows = createDiscoveryWorkflows(runtime, {
      handleAutopilotResponse: learningWorkflows.handleAutopilotResponse,
    });
    return { runtime, learningWorkflows, discoveryWorkflows };
  };

  const learn = async (input: EngineLearnInput) => {
    const parsed = parseLearnInput(input);
    const execution = createExecution(parsed.runOptions?.timeoutMs);
    try {
      return await execution.learningWorkflows.performLearning(parsed);
    } finally {
      execution.runtime.dispose();
    }
  };

  const discover = async (input: EngineDiscoverInput) => {
    const parsed = parseDiscoverInput(input);
    const execution = createExecution(parsed.runOptions?.timeoutMs);
    try {
      return await execution.discoveryWorkflows.performDiscovery(parsed);
    } finally {
      execution.runtime.dispose();
    }
  };

  const run = async (input: EngineRunInput): Promise<EngineRunResult> => {
    const parsed = parseRunInput(input);
    const { runtime, learningWorkflows, discoveryWorkflows } = createExecution(
      parsed.runOptions?.timeoutMs,
    );
    const initialWords = sanitizeWords(parsed.words);
    let phase: EnginePhase = EnginePhase.Learning;
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
          profile.initialRequestResponse.response.body,
        ),
      ]);
      totalParametersAmount = words.length;

      runtime.events.emit(parsed.runOptions, {
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

      return finalizeRun(
        runtime,
        parsed.runOptions,
        createCompletedRunResult({
          findings: discoveryResult.findings,
          profile: requireProfile(
            profile,
            "Baseline profile missing after learning completed",
          ),
          totalParametersAmount: discoveryResult.totalParametersAmount,
        }),
      );
    } catch (error) {
      const engineError = toEngineError(error);
      if (engineError.code === "RUN_ABORTED") {
        return finalizeRun(
          runtime,
          parsed.runOptions,
          createCanceledRunResult({
            phase,
            profile,
            findings: partialFindings,
            totalParametersAmount,
          }),
        );
      }

      if (engineError.code === "RUN_TIMEOUT") {
        return finalizeRun(
          runtime,
          parsed.runOptions,
          createTimeoutRunResult({
            phase,
            profile,
            findings: partialFindings,
            totalParametersAmount,
          }),
        );
      }

      if (engineError.code === "PROVIDER_ERROR") {
        const failureReason = describeProviderFailure(engineError);
        runtime.events.emit(parsed.runOptions, {
          type: "log",
          level: "error",
          message: failureReason,
        });
        return finalizeRun(
          runtime,
          parsed.runOptions,
          createErrorRunResult({
            phase,
            profile,
            findings: partialFindings,
            totalParametersAmount,
            failureReason,
          }),
        );
      }

      runtime.events.emit(parsed.runOptions, {
        type: "state",
        state: EngineState.Error,
        phase,
      });
      throw engineError;
    } finally {
      runtime.dispose();
    }
  };

  return {
    learn,
    discover,
    run,
  };
}

function finalizeRun(
  runtime: EngineRuntime,
  runOptions: RunOptions | undefined,
  result: EngineRunResult,
): EngineRunResult {
  runtime.events.emit(runOptions, {
    type: "state",
    state: result.state,
    phase: result.phase,
  });

  const { profile: _profile, ...summary } = result;
  runtime.events.emit(runOptions, { type: "completed", ...summary });
  return result;
}
