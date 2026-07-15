import { detectAnomaly, matchesWafResponse } from "../detect-anomaly";
import {
  applyAdditionalChecks,
  deriveBaselineProfile,
  generateLearningParameters,
  getSizeProbeConfig,
  type LearningSample,
} from "../learn";
import { inspectRequest } from "../mutate-request";
import type {
  AdditionalChecksResult,
  BaselineProfile,
  EngineConfig,
  EngineLearnInput,
  EngineLearnResult,
  EngineRequest,
  EngineRequestResponse,
  EngineResponse,
  RunOptions,
} from "../types";
import { AnomalyType, EnginePhase, EngineState } from "../types";

import type { EngineRuntime } from "./runtime";
import {
  type AutopilotResult,
  createAdditionalCheckParameterValue,
  createWafParameters,
  getWafPatterns,
} from "./shared";

export function createLearningWorkflows(
  runtime: Pick<EngineRuntime, "events" | "random" | "requests" | "run">,
) {
  const performLearning = async (
    parsed: EngineLearnInput,
  ): Promise<EngineLearnResult> => {
    const samples: LearningSample[] = [];

    runtime.events.emit(parsed.runOptions, {
      type: "state",
      state: EngineState.Learning,
      phase: EnginePhase.Learning,
    });

    for (
      let index = 0;
      index < parsed.engineConfig.learnRequestsCount;
      index += 1
    ) {
      await runtime.run.waitForCheckpoint(parsed.runOptions);

      const parameters = generateLearningParameters(
        index + 1,
        runtime.random,
        parsed.engineConfig.customValueType,
      );
      const requestResponse = await runtime.requests.sendMutatedRequest({
        baseRequest: parsed.request,
        parameters,
        attackType: parsed.engineConfig.attackType,
        context: "learning",
        engineConfig: parsed.engineConfig,
        runOptions: parsed.runOptions,
      });
      runtime.events.detectAndEmitRequest(
        parsed.runOptions,
        requestResponse,
        0,
        parameters.length,
      );
      samples.push({
        requestResponse,
        parameters,
      });

      if (index < parsed.engineConfig.learnRequestsCount - 1) {
        await runtime.run.sleepIfNeeded(
          parsed.runOptions,
          Math.floor(runtime.random() * 300) + 200,
        );
      }
    }

    const inspection = inspectRequest(parsed.request);
    const profile = deriveBaselineProfile(samples);
    profile.bodyKind = inspection.bodyKind;
    profile.multipartBoundary = inspection.multipartBoundary;

    runtime.events.emit(parsed.runOptions, {
      type: "learnedProfile",
      profile,
    });

    return { profile };
  };

  const guessMaxSize = async (
    request: EngineRequest,
    engineConfig: EngineConfig,
    profile: BaselineProfile,
    runOptions?: RunOptions,
  ): Promise<number> => {
    const probeConfig = getSizeProbeConfig(
      engineConfig.attackType,
      profile.bodyKind ?? "text",
      engineConfig.customValueType,
    );

    for (const size of probeConfig.sizes) {
      await runtime.run.waitForCheckpoint(runOptions);
      const parameters = probeConfig.createParameters(runtime.random, size);
      const requestResponse = await runtime.requests.sendMutatedRequest({
        baseRequest: request,
        parameters,
        attackType: engineConfig.attackType,
        context: "learning",
        engineConfig,
        runOptions,
      });

      runtime.events.detectAndEmitRequest(
        runOptions,
        requestResponse,
        0,
        parameters.length,
      );
      if (requestResponse.response.status !== 414) {
        const anomaly = detectAnomaly(
          profile,
          requestResponse.response,
          parameters,
        );
        if (!anomaly) {
          return size;
        }
      }

      await runtime.run.sleepIfNeeded(runOptions);
    }

    return probeConfig.defaultSize;
  };

  const handleAutopilotResponse = async (args: {
    request: EngineRequest;
    response: EngineRequestResponse;
    engineConfig: EngineConfig;
    profile: BaselineProfile;
    currentMaxSize?: number;
    hasAdjustedQuerySize: boolean;
    runOptions?: RunOptions;
  }): Promise<AutopilotResult> => {
    if (
      !args.engineConfig.autopilotEnabled ||
      args.engineConfig.attackType !== "query" ||
      args.response.response.status !== 414 ||
      args.hasAdjustedQuerySize
    ) {
      return {
        handled: false,
        nextMaxSize: args.currentMaxSize,
        hasAdjustedQuerySize: args.hasAdjustedQuerySize,
      };
    }

    runtime.events.emit(args.runOptions, {
      type: "log",
      level: "info",
      message: "Received 414: URI Too Long, adjusting max URL size.",
    });

    const guessedMaxSize = await guessMaxSize(
      args.request,
      args.engineConfig,
      args.profile,
      args.runOptions,
    );

    if (
      args.currentMaxSize !== undefined &&
      guessedMaxSize >= args.currentMaxSize
    ) {
      runtime.events.emit(args.runOptions, {
        type: "log",
        level: "info",
        message:
          guessedMaxSize === args.currentMaxSize
            ? "Guessed the same max URL size as before, ignoring."
            : "Guessed greater max URL size than before, ignoring.",
      });

      return {
        handled: false,
        nextMaxSize: args.currentMaxSize,
        hasAdjustedQuerySize: true,
      };
    }

    runtime.events.emit(args.runOptions, {
      type: "log",
      level: "info",
      message: `Adjusting max URL size to ${guessedMaxSize}${args.currentMaxSize !== undefined ? ` (old: ${args.currentMaxSize})` : ""}`,
    });

    args.profile.maxSize = guessedMaxSize;
    return {
      handled: true,
      nextMaxSize: guessedMaxSize,
      hasAdjustedQuerySize: true,
    };
  };

  const performAdditionalChecks = async (
    request: EngineRequest,
    engineConfig: EngineConfig,
    profile: BaselineProfile,
    runOptions?: RunOptions,
  ): Promise<AdditionalChecksResult> => {
    const parameterValue = createAdditionalCheckParameterValue(engineConfig);
    const rawAnomaly = await probeAdditionalCheckParameter(
      "paramFinder[]",
      parameterValue,
    );
    const encodedHashObjectAnomaly = await probeAdditionalCheckParameter(
      "paramFinder%5B%23hello%5D",
      parameterValue,
    );

    return {
      handlesSpecialCharacters: !rawAnomaly && !encodedHashObjectAnomaly,
      handlesEncodedSpecialCharacters: !encodedHashObjectAnomaly,
    };

    async function probeAdditionalCheckParameter(name: string, value: string) {
      await runtime.run.waitForCheckpoint(runOptions);
      const parameters = [{ name, value }];
      const requestResponse = await runtime.requests.sendMutatedRequest({
        baseRequest: request,
        parameters,
        attackType: engineConfig.attackType,
        context: "learning",
        engineConfig,
        runOptions,
      });

      runtime.events.detectAndEmitRequest(
        runOptions,
        requestResponse,
        0,
        parameters.length,
      );
      return detectAnomaly(profile, requestResponse.response, parameters);
    }
  };

  const checkForWaf = async (
    request: EngineRequest,
    engineConfig: EngineConfig,
    profile: BaselineProfile,
    runOptions?: RunOptions,
  ): Promise<EngineResponse | undefined> => {
    if (
      engineConfig.attackType === "body" &&
      engineConfig.customValueType === "integer"
    ) {
      return undefined;
    }

    const seenParameterSets = new Set<string>();
    const anomalousResponses: EngineResponse[] = [];

    for (const pattern of getWafPatterns()) {
      await runtime.run.waitForCheckpoint(runOptions);
      const parameters = createWafParameters(pattern, engineConfig);
      const parameterSetKey = createParameterSetKey(parameters);
      if (seenParameterSets.has(parameterSetKey)) {
        continue;
      }
      seenParameterSets.add(parameterSetKey);

      const requestResponse = await runtime.requests.sendMutatedRequest({
        baseRequest: request,
        parameters,
        attackType: engineConfig.attackType,
        context: "learning",
        engineConfig,
        runOptions,
        allowCloudflareChallenge: true,
      });

      runtime.events.detectAndEmitRequest(
        runOptions,
        requestResponse,
        0,
        parameters.length,
      );
      const anomaly = detectAnomaly(
        profile,
        requestResponse.response,
        parameters,
      );
      if (
        anomaly !== undefined &&
        anomaly.type !== AnomalyType.ReflectionCount &&
        anomalousResponses.some((response) =>
          matchesWafResponse(response, requestResponse.response),
        )
      ) {
        runtime.requests.setKnownWafResponse(requestResponse.response);
        return requestResponse.response;
      }
      if (
        anomaly !== undefined &&
        anomaly.type !== AnomalyType.ReflectionCount
      ) {
        anomalousResponses.push(requestResponse.response);
      }

      await runtime.run.sleepIfNeeded(runOptions);
    }

    return undefined;
  };

  return {
    applyAdditionalChecks,
    checkForWaf,
    guessMaxSize,
    handleAutopilotResponse,
    performAdditionalChecks,
    performLearning,
  };
}

function createParameterSetKey(
  parameters: readonly { name: string; value: string }[],
): string {
  return JSON.stringify(parameters);
}
