import {
  detectAnomaly,
  detectReflectionCountAnomalies,
} from "../detect-anomaly";
import {
  describeAnomaly,
  describeAnomalyReason,
  getNextChunk,
  splitChunk,
} from "../discovery";
import type {
  Anomaly,
  BaselineProfile,
  EngineConfig,
  EngineDiscoverInput,
  EngineDiscoverResult,
  EngineRequest,
  EngineRequestResponse,
  Finding,
  Parameter,
  RunOptions,
} from "../types";
import { AnomalyType, EnginePhase, EngineState } from "../types";
import { sanitizeWords } from "../utils";

import { createBaselineHealthMonitor } from "./baseline-health";
import type { EngineRuntime } from "./runtime";
import { type AutopilotResult, getConfiguredMaxSize } from "./shared";
import { createParameterChunkVerifier } from "./verified-finding";

const DRIFT_RECHECK_THRESHOLD = 3;
const MAX_SCAN_CALIBRATIONS = 3;

interface DiscoveryWorkflowDependencies {
  handleAutopilotResponse: (args: {
    request: EngineRequest;
    response: EngineRequestResponse;
    engineConfig: EngineConfig;
    profile: BaselineProfile;
    currentMaxSize?: number;
    hasAdjustedQuerySize: boolean;
    runOptions?: RunOptions;
  }) => Promise<AutopilotResult>;
}

export function createDiscoveryWorkflows(
  runtime: Pick<EngineRuntime, "events" | "random" | "requests" | "run">,
  dependencies: DiscoveryWorkflowDependencies,
) {
  const parameterChunkVerifier = createParameterChunkVerifier(runtime);
  const baselineHealthMonitor = createBaselineHealthMonitor(runtime);

  const verifySingleParameter = async (args: {
    request: EngineRequest;
    parameter: Parameter;
    anomaly: Anomaly;
    engineConfig: EngineConfig;
    profile: BaselineProfile;
    runOptions?: RunOptions;
    ignoredAnomalyTypes?: readonly AnomalyType[];
  }): Promise<Finding | undefined> => {
    await runtime.run.waitForCheckpoint(args.runOptions);
    runtime.events.emit(args.runOptions, {
      type: "log",
      level: "info",
      message: `Verifying candidate parameter "${args.parameter.name}": ${describeAnomalyReason(args.anomaly)} (${describeAnomaly(args.anomaly)})`,
    });
    const verified = await parameterChunkVerifier.verifyParameterChunk({
      request: args.request,
      parameters: [args.parameter],
      engineConfig: args.engineConfig,
      profile: args.profile,
      runOptions: args.runOptions,
      ignoredAnomalyTypes: args.ignoredAnomalyTypes,
    });

    if (verified === undefined) {
      return undefined;
    }

    const finding: Finding = {
      requestResponse: verified.requestResponse,
      parameter: args.parameter,
      anomaly: verified.anomaly,
    };
    runtime.events.emit(args.runOptions, {
      type: "log",
      level: "info",
      message: `Confirmed parameter "${args.parameter.name}": ${describeAnomalyReason(verified.anomaly)} (${describeAnomaly(verified.anomaly)})`,
    });
    runtime.events.emit(args.runOptions, {
      type: "finding",
      finding,
    });

    return finding;
  };

  const narrowDownChunk = async (args: {
    request: EngineRequest;
    chunk: Parameter[];
    engineConfig: EngineConfig;
    profile: BaselineProfile;
    runOptions?: RunOptions;
    ignoredAnomalyTypes?: readonly AnomalyType[];
  }): Promise<Finding[]> => {
    const findings: Finding[] = [];
    const stack: Parameter[][] = [args.chunk];

    while (stack.length > 0) {
      await runtime.run.waitForCheckpoint(args.runOptions);
      const currentChunk = stack.pop();
      if (!currentChunk || currentChunk.length === 0) {
        continue;
      }

      const requestResponse = await runtime.requests.sendMutatedRequest({
        baseRequest: args.request,
        parameters: currentChunk,
        attackType: args.engineConfig.attackType,
        context: "narrower",
        engineConfig: args.engineConfig,
        runOptions: args.runOptions,
      });

      runtime.events.detectAndEmitRequest(
        args.runOptions,
        requestResponse,
        0,
        currentChunk.length,
      );
      const anomaly = detectAnomaly(
        args.profile,
        requestResponse.response,
        currentChunk,
        args.ignoredAnomalyTypes,
        args.engineConfig.ignoreCloudflareBlocks,
      );

      if (!anomaly) {
        await runtime.run.sleepIfNeeded(args.runOptions);
        continue;
      }

      if (currentChunk.length === 1) {
        const parameter = currentChunk[0];
        if (parameter) {
          const finding = await verifySingleParameter({
            request: args.request,
            parameter,
            anomaly,
            engineConfig: args.engineConfig,
            profile: args.profile,
            runOptions: args.runOptions,
            ignoredAnomalyTypes: args.ignoredAnomalyTypes,
          });
          if (finding !== undefined) {
            findings.push(finding);
          }
        }
      } else {
        const [firstHalf, secondHalf] = splitChunk(currentChunk);
        stack.push(secondHalf, firstHalf);
      }

      await runtime.run.sleepIfNeeded(args.runOptions);
    }

    return findings;
  };

  const performDiscovery = async (
    parsed: EngineDiscoverInput,
  ): Promise<EngineDiscoverResult> => {
    runtime.requests.setKnownWafResponse(parsed.profile.wafResponse);
    const sanitizedWords = sanitizeWords(parsed.words);
    const findings: Finding[] = [];
    let maxSize =
      parsed.profile.maxSize ?? getConfiguredMaxSize(parsed.engineConfig);
    let nextIndex = 0;
    let hasAdjustedQuerySize = false;
    let effectiveMaxParametersAmount = parsed.engineConfig.maxParametersAmount;
    let calibrationPending = true;
    let calibrationAttempts = 0;
    let consecutiveRejectedAnomalies = 0;

    runtime.events.emit(parsed.runOptions, {
      type: "state",
      state: EngineState.Running,
      phase: EnginePhase.Discovery,
    });

    while (nextIndex < sanitizedWords.length) {
      await runtime.run.waitForCheckpoint(parsed.runOptions);
      const chunkStartIndex = nextIndex;
      const chunk = getNextChunk({
        words: sanitizedWords,
        startIndex: nextIndex,
        request: parsed.request,
        attackType: parsed.engineConfig.attackType,
        maxSize,
        maxParametersAmount: effectiveMaxParametersAmount,
        customValue: parsed.engineConfig.customValue,
        customValueType: parsed.engineConfig.customValueType,
        jsonBodyPath: parsed.engineConfig.jsonBodyPath,
        random: runtime.random,
      });

      if (chunk.parameters.length === 0) {
        break;
      }

      if (calibrationPending) {
        calibrationAttempts += 1;
        const calibration = await baselineHealthMonitor.calibrate({
          request: parsed.request,
          parameters: chunk.parameters,
          engineConfig: parsed.engineConfig,
          profile: parsed.profile,
          runOptions: parsed.runOptions,
          maxParametersAmount: effectiveMaxParametersAmount,
        });
        effectiveMaxParametersAmount = calibration.maxParametersAmount;
        calibrationPending = false;
        if (calibration.changed) {
          nextIndex = chunkStartIndex;
          continue;
        }
      }

      const requestResponse = await runtime.requests.sendMutatedRequest({
        baseRequest: parsed.request,
        parameters: chunk.parameters,
        attackType: parsed.engineConfig.attackType,
        context: "discovery",
        engineConfig: parsed.engineConfig,
        runOptions: parsed.runOptions,
      });

      runtime.events.detectAndEmitRequest(
        parsed.runOptions,
        requestResponse,
        chunk.parameters.length,
      );

      const autopilot = await dependencies.handleAutopilotResponse({
        request: parsed.request,
        response: requestResponse,
        engineConfig: parsed.engineConfig,
        profile: parsed.profile,
        currentMaxSize: maxSize,
        hasAdjustedQuerySize,
        runOptions: parsed.runOptions,
      });

      maxSize = autopilot.nextMaxSize;
      hasAdjustedQuerySize = autopilot.hasAdjustedQuerySize;
      if (autopilot.handled) {
        await runtime.run.sleepIfNeeded(parsed.runOptions);
        continue;
      }

      nextIndex = chunk.nextIndex;

      const anomaly = detectAnomaly(
        parsed.profile,
        requestResponse.response,
        chunk.parameters,
        parsed.engineConfig.ignoreAnomalyTypes,
        parsed.engineConfig.ignoreCloudflareBlocks,
      );

      if (anomaly) {
        runtime.events.emit(parsed.runOptions, {
          type: "log",
          level: "info",
          message: `${describeAnomalyReason(anomaly)} (${describeAnomaly(anomaly)}) after sending ${chunk.parameters.length} parameter${chunk.parameters.length === 1 ? "" : "s"}`,
        });
      }

      if (anomaly) {
        let parametersToVerify = chunk.parameters;
        let ignoredAnomalyTypes = parsed.engineConfig.ignoreAnomalyTypes;

        if (anomaly.type === AnomalyType.ReflectionCount) {
          const reflectionAnomalies = detectReflectionCountAnomalies(
            parsed.profile,
            requestResponse.response,
            chunk.parameters,
          );
          if (reflectionAnomalies.length > 0) {
            const confirmedReflectionNames = new Set<string>();
            for (const reflectionAnomaly of reflectionAnomalies) {
              const reflectedParameter = chunk.parameters.find(
                (parameter) =>
                  parameter.name === reflectionAnomaly.parameterName,
              );
              if (reflectedParameter !== undefined) {
                const finding = await verifySingleParameter({
                  request: parsed.request,
                  parameter: reflectedParameter,
                  anomaly: reflectionAnomaly,
                  engineConfig: parsed.engineConfig,
                  profile: parsed.profile,
                  runOptions: parsed.runOptions,
                });
                if (finding !== undefined) {
                  findings.push(finding);
                  confirmedReflectionNames.add(reflectedParameter.name);
                }
              }
            }

            parametersToVerify = chunk.parameters.filter(
              (parameter) => !confirmedReflectionNames.has(parameter.name),
            );
            ignoredAnomalyTypes = [
              ...parsed.engineConfig.ignoreAnomalyTypes,
              AnomalyType.ReflectionCount,
            ];

            if (parametersToVerify.length === 0) {
              await runtime.run.sleepIfNeeded(parsed.runOptions);
              continue;
            }
          }
        }

        const verified = await parameterChunkVerifier.verifyParameterChunk({
          request: parsed.request,
          parameters: parametersToVerify,
          engineConfig: parsed.engineConfig,
          profile: parsed.profile,
          runOptions: parsed.runOptions,
          ignoredAnomalyTypes,
        });

        if (verified) {
          consecutiveRejectedAnomalies = 0;
          runtime.events.emit(parsed.runOptions, {
            type: "log",
            level: "info",
            message: `Narrowing down chunk of ${parametersToVerify.length} parameter${parametersToVerify.length === 1 ? "" : "s"}`,
          });
          const narrowedFindings = await narrowDownChunk({
            request: parsed.request,
            chunk: parametersToVerify,
            engineConfig: parsed.engineConfig,
            profile: parsed.profile,
            runOptions: parsed.runOptions,
            ignoredAnomalyTypes,
          });
          findings.push(...narrowedFindings);
        } else {
          consecutiveRejectedAnomalies += 1;
          if (
            consecutiveRejectedAnomalies >= DRIFT_RECHECK_THRESHOLD &&
            calibrationAttempts < MAX_SCAN_CALIBRATIONS
          ) {
            consecutiveRejectedAnomalies = 0;
            calibrationPending = true;
            nextIndex = chunkStartIndex;
            continue;
          }
        }
      } else {
        consecutiveRejectedAnomalies = 0;
      }

      await runtime.run.sleepIfNeeded(parsed.runOptions);
    }

    return {
      findings,
      totalParametersAmount: sanitizedWords.length,
    };
  };

  return {
    performDiscovery,
  };
}
