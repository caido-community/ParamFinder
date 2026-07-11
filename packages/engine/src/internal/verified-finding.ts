import { compareResponseToReference, detectAnomaly } from "../detect-anomaly";
import { describeAnomaly } from "../discovery";
import type {
  AnomalyType,
  BaselineProfile,
  EngineConfig,
  EngineRequest,
  Parameter,
  RunOptions,
} from "../types";

import type { EngineRuntimeContext } from "./runtime";
import {
  anomaliesMatch,
  isStrongVerificationAnomaly,
  type VerifiedAnomalyResult,
} from "./shared";

export interface VerifyParameterChunkInput {
  request: EngineRequest;
  parameters: Parameter[];
  engineConfig: EngineConfig;
  profile: BaselineProfile;
  runOptions?: RunOptions;
  ignoredAnomalyTypes?: readonly AnomalyType[];
}

export interface ParameterChunkVerifier {
  verifyParameterChunk(
    input: VerifyParameterChunkInput,
  ): Promise<VerifiedAnomalyResult | undefined>;
}

export function createParameterChunkVerifier(
  runtimeContext: EngineRuntimeContext,
): ParameterChunkVerifier {
  const verifyParameterChunk = async (
    input: VerifyParameterChunkInput,
  ): Promise<VerifiedAnomalyResult | undefined> => {
    const skipCloudflareBlocks = input.engineConfig.ignoreCloudflareBlocks;
    const ignoredAnomalyTypes =
      input.ignoredAnomalyTypes ?? input.engineConfig.ignoreAnomalyTypes;
    const controlBeforeRequestResponse =
      await runtimeContext.sendMutatedRequest({
        baseRequest: input.request,
        parameters: [],
        attackType: input.engineConfig.attackType,
        context: "narrower",
        engineConfig: input.engineConfig,
        runOptions: input.runOptions,
      });

    runtimeContext.detectAndEmitRequest(
      input.runOptions,
      controlBeforeRequestResponse,
      0,
    );
    const requestResponse = await runtimeContext.sendMutatedRequest({
      baseRequest: input.request,
      parameters: input.parameters,
      attackType: input.engineConfig.attackType,
      context: "narrower",
      engineConfig: input.engineConfig,
      runOptions: input.runOptions,
    });

    runtimeContext.detectAndEmitRequest(input.runOptions, requestResponse, 0);
    const controlAfterRequestResponse = await runtimeContext.sendMutatedRequest(
      {
        baseRequest: input.request,
        parameters: [],
        attackType: input.engineConfig.attackType,
        context: "narrower",
        engineConfig: input.engineConfig,
        runOptions: input.runOptions,
      },
    );

    runtimeContext.detectAndEmitRequest(
      input.runOptions,
      controlAfterRequestResponse,
      0,
    );

    const baselineAnomaly = detectAnomaly(
      input.profile,
      requestResponse.response,
      input.parameters,
      ignoredAnomalyTypes,
      skipCloudflareBlocks,
    );
    const controlBeforeAnomaly = detectAnomaly(
      input.profile,
      controlBeforeRequestResponse.response,
      [],
      ignoredAnomalyTypes,
      skipCloudflareBlocks,
    );
    const controlAfterAnomaly = detectAnomaly(
      input.profile,
      controlAfterRequestResponse.response,
      [],
      ignoredAnomalyTypes,
      skipCloudflareBlocks,
    );
    const candidateVsBefore = compareResponseToReference(input.profile, {
      referenceResponse: controlBeforeRequestResponse.response,
      response: requestResponse.response,
      parameters: input.parameters,
      ignoredAnomalyTypes,
      skipCloudflareBlocks,
    });
    const candidateVsAfter = compareResponseToReference(input.profile, {
      referenceResponse: controlAfterRequestResponse.response,
      response: requestResponse.response,
      parameters: input.parameters,
      ignoredAnomalyTypes,
      skipCloudflareBlocks,
    });
    const controlWindowAnomaly = compareResponseToReference(input.profile, {
      referenceResponse: controlBeforeRequestResponse.response,
      response: controlAfterRequestResponse.response,
      parameters: [],
      ignoredAnomalyTypes,
      skipCloudflareBlocks,
    });

    if (
      candidateVsBefore &&
      candidateVsAfter &&
      anomaliesMatch(candidateVsBefore, candidateVsAfter) &&
      !controlWindowAnomaly
    ) {
      return {
        anomaly:
          baselineAnomaly && anomaliesMatch(baselineAnomaly, candidateVsBefore)
            ? baselineAnomaly
            : candidateVsBefore,
        requestResponse,
      };
    }

    if (
      candidateVsBefore &&
      !candidateVsAfter &&
      !controlBeforeAnomaly &&
      baselineAnomaly &&
      anomaliesMatch(baselineAnomaly, candidateVsBefore) &&
      isStrongVerificationAnomaly(candidateVsBefore)
    ) {
      return {
        anomaly: baselineAnomaly,
        requestResponse,
      };
    }

    if (
      candidateVsAfter &&
      !candidateVsBefore &&
      !controlAfterAnomaly &&
      baselineAnomaly &&
      anomaliesMatch(baselineAnomaly, candidateVsAfter) &&
      isStrongVerificationAnomaly(candidateVsAfter)
    ) {
      return {
        anomaly: baselineAnomaly,
        requestResponse,
      };
    }

    emitDiscardedVerificationLog(runtimeContext, input, {
      controlBeforeAnomaly,
      candidateVsBefore,
      candidateVsAfter,
      controlAfterAnomaly,
      controlWindowAnomaly,
    });
    return undefined;
  };

  return {
    verifyParameterChunk,
  };
}

function emitDiscardedVerificationLog(
  runtimeContext: EngineRuntimeContext,
  input: VerifyParameterChunkInput,
  anomalies: {
    controlBeforeAnomaly?: ReturnType<typeof detectAnomaly>;
    candidateVsBefore?: ReturnType<typeof compareResponseToReference>;
    candidateVsAfter?: ReturnType<typeof compareResponseToReference>;
    controlAfterAnomaly?: ReturnType<typeof detectAnomaly>;
    controlWindowAnomaly?: ReturnType<typeof compareResponseToReference>;
  },
): void {
  const discardReasons = [
    anomalies.controlBeforeAnomaly
      ? `before=${describeAnomaly(anomalies.controlBeforeAnomaly)}`
      : undefined,
    anomalies.candidateVsBefore
      ? `candidateVsBefore=${describeAnomaly(anomalies.candidateVsBefore)}`
      : undefined,
    anomalies.candidateVsAfter
      ? `candidateVsAfter=${describeAnomaly(anomalies.candidateVsAfter)}`
      : undefined,
    anomalies.controlAfterAnomaly
      ? `after=${describeAnomaly(anomalies.controlAfterAnomaly)}`
      : undefined,
    anomalies.controlWindowAnomaly
      ? `controlWindow=${describeAnomaly(anomalies.controlWindowAnomaly)}`
      : undefined,
  ].filter(Boolean);

  runtimeContext.emit(input.runOptions, {
    type: "log",
    level: "debug",
    message: `Discarded anomaly because the control window did not confirm it${discardReasons.length > 0 ? ` (${discardReasons.join(", ")})` : "."}`,
  });
}
