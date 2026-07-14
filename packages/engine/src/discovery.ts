import { wouldExceedMutationBudget } from "./mutate-request";
import type {
  Anomaly,
  AttackType,
  EngineRequest,
  Parameter,
  ParameterValueType,
} from "./types";
import { AnomalyType } from "./types";
import { randomString } from "./utils";

const DEFAULT_HEADER_CHUNK_SIZE = 20;
const PARAMETER_VALUE_LENGTH = 8;

interface NextChunkInput {
  words: string[];
  startIndex: number;
  request: EngineRequest;
  attackType: AttackType;
  maxSize?: number;
  maxParametersAmount?: number;
  customValue?: string;
  customValueType?: ParameterValueType;
  jsonBodyPath?: string;
  random: () => number;
}

interface NextChunkResult {
  parameters: Parameter[];
  nextIndex: number;
}

export function getNextChunk(input: NextChunkInput): NextChunkResult {
  switch (input.attackType) {
    case "headers":
      return getNextHeaderChunk(input);
    case "query":
      return getNextQueryChunk(input);
    case "body":
      return getNextBodyChunk(input);
  }
}

export function splitChunk(
  parameters: Parameter[],
): [Parameter[], Parameter[]] {
  const middle = Math.floor(parameters.length / 2);
  return [parameters.slice(0, middle), parameters.slice(middle)];
}

export function createParameterValue(
  customValue: string | undefined,
  customValueType: ParameterValueType | undefined,
  random: () => number,
): string {
  if (customValueType === "integer") {
    return createIntegerParameterValue(random);
  }

  const suffix = randomString(PARAMETER_VALUE_LENGTH, random);
  return customValue ? `${customValue}${suffix}` : suffix;
}

export function describeAnomalyReason(anomaly: Anomaly): string {
  switch (anomaly.type) {
    case AnomalyType.Body:
      return "response body changed";
    case AnomalyType.Headers:
      return "response headers changed";
    case AnomalyType.StatusCode:
      return "status code changed";
    case AnomalyType.Redirect:
      return "redirect target changed";
    case AnomalyType.Similarity:
      return "response became noticeably different";
    case AnomalyType.ReflectionCount:
      return "input reflection changed";
  }
}

export function describeAnomaly(anomaly?: Anomaly): string {
  if (!anomaly) {
    return "UNKNOWN";
  }

  switch (anomaly.type) {
    case AnomalyType.Body:
      return anomaly.check === "length"
        ? `BODY (length ${anomaly.from} -> ${anomaly.to})`
        : `BODY (diff ${anomaly.expectedDiffCount} -> ${anomaly.actualDiffCount})`;
    case AnomalyType.Headers:
      return `HEADERS (${anomaly.headerName}: ${JSON.stringify(anomaly.from)} -> ${JSON.stringify(
        anomaly.to,
      )})`;
    case AnomalyType.ReflectionCount:
      return `REFLECTION_COUNT (${anomaly.parameterName}: ${anomaly.from} -> ${anomaly.to})`;
    case AnomalyType.StatusCode:
      return `${anomaly.type.toUpperCase()} (${anomaly.from} -> ${anomaly.to})`;
    case AnomalyType.Redirect:
      return `${anomaly.type.toUpperCase()} (${anomaly.from ?? "NONE"} -> ${anomaly.to ?? "NONE"})`;
    case AnomalyType.Similarity:
      return `SIMILARITY (${anomaly.similarity.toFixed(2)} < ${anomaly.threshold.toFixed(2)})`;
  }
}

function getNextHeaderChunk(input: NextChunkInput): NextChunkResult {
  const headerLimit = input.maxSize ?? DEFAULT_HEADER_CHUNK_SIZE;
  return collectChunk(input, (parameters) =>
    wouldExceedMutationBudget({
      baseRequest: input.request,
      attackType: "headers",
      parameters,
      maxSize: headerLimit,
    }),
  );
}

function getNextQueryChunk(input: NextChunkInput): NextChunkResult {
  return collectChunk(input, (parameters) =>
    wouldExceedMutationBudget({
      baseRequest: input.request,
      attackType: "query",
      parameters,
      maxSize: input.maxSize,
    }),
  );
}

function getNextBodyChunk(input: NextChunkInput): NextChunkResult {
  return collectChunk(input, (parameters) =>
    wouldExceedMutationBudget({
      baseRequest: input.request,
      attackType: "body",
      parameters,
      maxSize: input.maxSize,
      customValueType: input.customValueType,
      jsonBodyPath: input.jsonBodyPath,
    }),
  );
}

function collectChunk(
  input: NextChunkInput,
  exceedsBudget: (parameters: Parameter[]) => boolean,
): NextChunkResult {
  const remaining = input.words.length - input.startIndex;
  const maxChunkSize =
    input.maxParametersAmount === undefined
      ? remaining
      : Math.min(remaining, input.maxParametersAmount);

  if (maxChunkSize <= 0) {
    return { parameters: [], nextIndex: input.startIndex };
  }

  const candidates: { parameter: Parameter; wordIndex: number }[] = [];
  let scanIndex = input.startIndex;

  const materializeUpTo = (count: number): boolean => {
    const target = Math.min(count, maxChunkSize);
    while (candidates.length < target && scanIndex < input.words.length) {
      const wordIndex = scanIndex;
      const word = input.words[scanIndex]?.trim();
      scanIndex += 1;
      if (!word) {
        continue;
      }

      candidates.push({
        parameter: {
          name: word,
          value: createParameterValue(
            input.customValue,
            input.customValueType,
            input.random,
          ),
        },
        wordIndex,
      });
    }

    return candidates.length >= count;
  };

  const fitsFirst = (count: number): boolean =>
    !exceedsBudget(candidates.slice(0, count).map((entry) => entry.parameter));

  if (!materializeUpTo(1)) {
    return { parameters: [], nextIndex: scanIndex };
  }

  let fitting = fitsFirst(1) ? 1 : 0;
  let over = 0;
  let probe = 1;

  while (fitting === probe && materializeUpTo(probe + 1)) {
    const next = Math.min(probe * 2, candidates.length);
    if (fitsFirst(next)) {
      fitting = next;
    } else {
      over = next;
      break;
    }
    probe = next;
  }

  if (over !== 0) {
    let low = fitting;
    let high = over;
    while (high - low > 1) {
      const mid = (low + high) >>> 1;
      if (fitsFirst(mid)) {
        low = mid;
      } else {
        high = mid;
      }
    }
    fitting = low;
  }

  const take = Math.max(1, fitting);
  const parameters = candidates.slice(0, take).map((entry) => entry.parameter);
  const nextIndex =
    take < candidates.length ? candidates[take]!.wordIndex : scanIndex;

  return {
    parameters,
    nextIndex,
  };
}

function createIntegerParameterValue(random: () => number): string {
  let digits = `${Math.floor(random() * 9) + 1}`;
  for (let index = 1; index < PARAMETER_VALUE_LENGTH; index += 1) {
    digits += Math.floor(random() * 10).toString();
  }

  return digits;
}
