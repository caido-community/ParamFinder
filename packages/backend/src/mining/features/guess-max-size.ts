import { ParamMiner } from "../param-miner";
import {
  DEFAULT_RANDOM_PARAMETER_VALUE_LENGTH,
  randomString,
} from "../../util/helper";
import { Parameter } from "shared";

interface SizeConfig {
  sizes: number[];
  defaultSize: number;
  generateParams: (size: number) => Parameter[];
}

export const sizeConfigs: Record<string, SizeConfig> = {
  headers: {
    sizes: [100, 80, 50, 20],
    defaultSize: 20,
    generateParams: (size) =>
      Array.from({ length: size }, () => ({
        name: randomString(10),
        value: randomString(DEFAULT_RANDOM_PARAMETER_VALUE_LENGTH),
      })),
  },
  query: {
    sizes: [14000, 8000, 4000, 2000, 500],
    defaultSize: 500,
    generateParams: (size) => [
      {
        name: "paramFinderTest",
        value: randomString(size),
      },
    ],
  },
  body: {
    sizes: [50000, 30000, 16000, 8000, 4000, 2000],
    defaultSize: 2000,
    generateParams: (size) => [
      {
        name: "paramFinderTest",
        value: randomString(size),
      },
    ],
  },
  multipart: {
    sizes: [50000, 30000, 16000, 8000, 4000],
    defaultSize: 4000,
    generateParams: (size) => [
      {
        name: "paramFinderTest",
        value: randomString(size),
      },
    ],
  },
};

// Can send up to sizeConfigs[paramMiner.config.attackType].sizes.length requests for max size detection
export async function guessMaxSize(paramMiner: ParamMiner): Promise<number> {
  const config = sizeConfigs[paramMiner.config.attackType];
  if (!config) {
    throw new Error(`Invalid attack type: ${paramMiner.config.attackType}`);
  }

  let lastSuccessfulSize = 0;
  const { sizes, defaultSize, generateParams } = config;

  paramMiner.sdk.console.log(
    `Detecting maximum ${paramMiner.config.attackType} size...`,
  );

  for (const size of sizes) {
    try {
      const params = generateParams(size);

      const requestResponse = await paramMiner.requester.sendRequestWithParams(
        paramMiner.target,
        params,
        "learning",
      );

      paramMiner.eventEmitter.emit("responseReceived", 0, requestResponse);

      // 414: URI Too Long
      if (requestResponse.response.status !== 414) {
        const anomaly = paramMiner.anomalyDetector.hasChanges(
          requestResponse.response,
          params,
        );

        if (!anomaly) {
          lastSuccessfulSize = size;
          break;
        }
      }

      await new Promise((resolve) =>
        setTimeout(resolve, paramMiner.config.delayBetweenRequests),
      );
    } catch (error) {
      continue;
    }
  }

  if (lastSuccessfulSize === 0) {
    paramMiner.sdk.console.log(
      `Could not determine maximum ${paramMiner.config.attackType} size, using default of ${defaultSize}`,
    );
    return defaultSize;
  }

  paramMiner.sdk.console.log(
    `Maximum ${paramMiner.config.attackType} size detected: ${lastSuccessfulSize}`,
  );
  return lastSuccessfulSize;
}
