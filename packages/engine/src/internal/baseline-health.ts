import { detectAnomaly } from "../detect-anomaly";
import { describeAnomaly } from "../discovery";
import { deriveBaselineProfile, type LearningSample } from "../learn";
import type {
  Anomaly,
  BaselineProfile,
  EngineConfig,
  EngineRequest,
  Parameter,
  RunOptions,
} from "../types";
import { AnomalyType } from "../types";
import { normalizeHeaderName, randomString } from "../utils";

import type { EngineRuntimeContext } from "./runtime";
import { anomaliesMatch } from "./shared";

const CANARY_REQUESTS = 3;
const MAX_CALIBRATION_ROUNDS = 8;

interface BaselineCalibrationInput {
  request: EngineRequest;
  parameters: Parameter[];
  engineConfig: EngineConfig;
  profile: BaselineProfile;
  runOptions?: RunOptions;
  maxParametersAmount?: number;
}

interface BaselineCalibrationResult {
  changed: boolean;
  maxParametersAmount?: number;
}

export function createBaselineHealthMonitor(
  runtimeContext: EngineRuntimeContext,
) {
  const calibrate = async (
    input: BaselineCalibrationInput,
  ): Promise<BaselineCalibrationResult> => {
    let changed = false;
    let maxParametersAmount = input.maxParametersAmount;
    let parameters = capParameters(input.parameters, maxParametersAmount);

    for (let round = 0; round < MAX_CALIBRATION_ROUNDS; round += 1) {
      const canarySamples = await sendCanarySamples(
        runtimeContext,
        input,
        parameters,
      );
      const canaryAnomaly = findQuorumAnomaly(
        input.profile,
        canarySamples,
        input.engineConfig,
      );

      if (canaryAnomaly === undefined) {
        return { changed, maxParametersAmount };
      }

      const controlSamples = await sendControlSamples(runtimeContext, input);
      const controlAnomaly = findQuorumAnomaly(
        input.profile,
        controlSamples,
        input.engineConfig,
      );

      if (controlAnomaly !== undefined) {
        replaceProfile(input.profile, deriveBaselineProfile(canarySamples));
        changed = true;
        runtimeContext.emit(input.runOptions, {
          type: "log",
          level: "warn",
          message: `Baseline drift detected during calibration (${describeAnomaly(controlAnomaly)}); refreshed the discovery profile.`,
        });
        runtimeContext.emit(input.runOptions, {
          type: "learnedProfile",
          profile: input.profile,
        });
        continue;
      }

      if (parameters.length > 1) {
        const nextLimit = Math.max(1, Math.floor(parameters.length / 2));
        maxParametersAmount =
          maxParametersAmount === undefined
            ? nextLimit
            : Math.min(maxParametersAmount, nextLimit);
        parameters = input.parameters.slice(0, maxParametersAmount);
        changed = true;
        runtimeContext.emit(input.runOptions, {
          type: "log",
          level: "warn",
          message: `Random canary parameters reproduced ${describeAnomaly(canaryAnomaly)}; reducing discovery chunks to ${maxParametersAmount} parameter${maxParametersAmount === 1 ? "" : "s"}.`,
        });
        continue;
      }

      disableUnstableFactor(input.profile, canaryAnomaly);
      changed = true;
      runtimeContext.emit(input.runOptions, {
        type: "log",
        level: "warn",
        message: `Random one-parameter canaries reproduced ${describeAnomaly(canaryAnomaly)}; disabled that unstable signal for this scan.`,
      });
      runtimeContext.emit(input.runOptions, {
        type: "learnedProfile",
        profile: input.profile,
      });
      return { changed, maxParametersAmount };
    }

    runtimeContext.emit(input.runOptions, {
      type: "log",
      level: "warn",
      message:
        "Baseline calibration did not converge; continuing with the safest calibrated settings.",
    });
    return { changed, maxParametersAmount };
  };

  return { calibrate };
}

async function sendCanarySamples(
  runtimeContext: EngineRuntimeContext,
  input: BaselineCalibrationInput,
  parameters: Parameter[],
): Promise<LearningSample[]> {
  const samples: LearningSample[] = [];
  for (let index = 0; index < CANARY_REQUESTS; index += 1) {
    const canaryParameters = createMatchedCanaryParameters(
      parameters,
      runtimeContext.runtime.random,
      input.engineConfig.customValueType,
      index,
    );
    const requestResponse = await runtimeContext.sendMutatedRequest({
      baseRequest: input.request,
      parameters: canaryParameters,
      attackType: input.engineConfig.attackType,
      context: "learning",
      engineConfig: input.engineConfig,
      runOptions: input.runOptions,
    });
    runtimeContext.detectAndEmitRequest(
      input.runOptions,
      requestResponse,
      0,
      canaryParameters.length,
    );
    samples.push({ requestResponse, parameters: canaryParameters });
    await runtimeContext.sleepIfNeeded(input.runOptions);
  }
  return samples;
}

async function sendControlSamples(
  runtimeContext: EngineRuntimeContext,
  input: BaselineCalibrationInput,
): Promise<LearningSample[]> {
  const samples: LearningSample[] = [];
  for (let index = 0; index < 2; index += 1) {
    const requestResponse = await runtimeContext.sendMutatedRequest({
      baseRequest: input.request,
      parameters: [],
      attackType: input.engineConfig.attackType,
      context: "learning",
      engineConfig: input.engineConfig,
      runOptions: input.runOptions,
    });
    runtimeContext.detectAndEmitRequest(input.runOptions, requestResponse, 0);
    samples.push({ requestResponse, parameters: [] });
    await runtimeContext.sleepIfNeeded(input.runOptions);
  }
  return samples;
}

function findQuorumAnomaly(
  profile: BaselineProfile,
  samples: LearningSample[],
  engineConfig: EngineConfig,
): Anomaly | undefined {
  const anomalies = samples
    .map((sample) =>
      detectAnomaly(
        profile,
        sample.requestResponse.response,
        sample.parameters,
        [...engineConfig.ignoreAnomalyTypes, AnomalyType.ReflectionCount],
        engineConfig.ignoreCloudflareBlocks,
      ),
    )
    .filter(
      (anomaly): anomaly is Anomaly =>
        anomaly !== undefined &&
        !(anomaly.type === AnomalyType.StatusCode && anomaly.to === 414),
    );

  for (const anomaly of anomalies) {
    if (
      anomalies.filter((candidate) => anomaliesMatch(anomaly, candidate))
        .length >= 2
    ) {
      return anomaly;
    }
  }
  return undefined;
}

function createMatchedCanaryParameters(
  parameters: Parameter[],
  random: () => number,
  customValueType: EngineConfig["customValueType"],
  sampleIndex: number,
): Parameter[] {
  return parameters.map((parameter, parameterIndex) => ({
    name: createCanaryToken(
      parameter.name.length,
      `pf${sampleIndex.toString(36)}${parameterIndex.toString(36)}`,
      random,
      false,
    ),
    value: createCanaryToken(
      parameter.value.length,
      `${sampleIndex + 1}${parameterIndex}`,
      random,
      customValueType === "integer",
    ),
  }));
}

function createCanaryToken(
  length: number,
  prefix: string,
  random: () => number,
  integer: boolean,
): string {
  if (length <= 0) return "";
  if (integer) {
    let value = `${(Number(prefix.replace(/\D/g, "")) % 9) + 1}`;
    while (value.length < length) {
      value += Math.floor(random() * 10).toString();
    }
    return value.slice(0, length);
  }

  return `${prefix}${randomString(length, random)}`.slice(0, length);
}

function capParameters(
  parameters: Parameter[],
  maxParametersAmount?: number,
): Parameter[] {
  return maxParametersAmount === undefined
    ? parameters
    : parameters.slice(0, maxParametersAmount);
}

function replaceProfile(
  target: BaselineProfile,
  replacement: BaselineProfile,
): void {
  const metadata = {
    wafResponse: target.wafResponse,
    additionalChecks: target.additionalChecks,
    maxSize: target.maxSize,
    bodyKind: target.bodyKind,
    multipartBoundary: target.multipartBoundary,
  };
  Object.assign(target, replacement, metadata);
}

function disableUnstableFactor(profile: BaselineProfile, anomaly: Anomaly) {
  switch (anomaly.type) {
    case AnomalyType.StatusCode:
      profile.stableFactors.statusCodeStable = false;
      return;
    case AnomalyType.Redirect:
      profile.stableFactors.redirectStable = false;
      return;
    case AnomalyType.Headers:
      profile.stableFactors.unstableHeaders = Array.from(
        new Set([
          ...profile.stableFactors.unstableHeaders,
          normalizeHeaderName(anomaly.headerName),
        ]),
      );
      return;
    case AnomalyType.Body:
      if (anomaly.check === "length") {
        profile.stableFactors.bodyLengthStable = false;
      } else {
        profile.stableFactors.bodyStable = false;
      }
      return;
    case AnomalyType.Similarity:
      profile.stableFactors.similarityStable = false;
      return;
    case AnomalyType.ReflectionCount:
      profile.stableFactors.reflectionStable = false;
  }
}
