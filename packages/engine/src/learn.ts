import { EngineError } from "./errors";
import type {
  AdditionalChecksResult,
  AttackType,
  BaselineProfile,
  EngineRequestResponse,
  InspectableBodyKind,
  Parameter,
  ParameterValueType,
  StableFactors,
} from "./types";
import {
  countLineDifferences,
  countOccurrences,
  DEFAULT_LEARNING_PARAMETER_NAME_LENGTH,
  DEFAULT_LEARNING_PARAMETER_VALUE_LENGTH,
  getFirstHeaderValue,
  getHeaderValues,
  getNormalizedHeaderNames,
  headerValuesEqual,
  normalizeHeaderName,
  randomString,
  sanitizeWords,
  stringSimilarity,
} from "./utils";

const DEFAULT_UNSTABLE_HEADERS = ["Content-Length", "Date", "CF-Cache-Status"];

export interface LearningSample {
  requestResponse: EngineRequestResponse;
  parameters: Parameter[];
}

interface SizeProbeConfig {
  sizes: number[];
  defaultSize: number;
  createParameters: (random: () => number, size: number) => Parameter[];
}

export function generateLearningParameters(
  count: number,
  random: () => number,
  customValueType?: ParameterValueType,
): Parameter[] {
  return Array.from({ length: count }, () => ({
    name: randomString(DEFAULT_LEARNING_PARAMETER_NAME_LENGTH + count, random),
    value: createLearningParameterValue(
      DEFAULT_LEARNING_PARAMETER_VALUE_LENGTH,
      random,
      customValueType,
    ),
  }));
}

export function deriveBaselineProfile(
  samples: LearningSample[],
): BaselineProfile {
  if (samples.length < 2) {
    throw new EngineError(
      "INVALID_CONFIG",
      "At least two learning samples are required to derive a baseline profile",
    );
  }

  const initialRequestResponse = samples[0]?.requestResponse;
  const secondSample = samples[1];
  if (!initialRequestResponse || !secondSample) {
    throw new EngineError("INTERNAL_ERROR", "Learning samples were missing");
  }

  const initialBody = initialRequestResponse.response.body ?? "";
  const secondBody = secondSample.requestResponse.response.body ?? "";
  const bodyDiffReferenceCount = countLineDifferences(initialBody, secondBody);
  let stableFactors = checkStableFactors(
    initialRequestResponse,
    secondSample.requestResponse,
    secondSample.parameters,
    bodyDiffReferenceCount,
  );

  for (const sample of samples.slice(2)) {
    const nextFactors = checkStableFactors(
      initialRequestResponse,
      sample.requestResponse,
      sample.parameters,
      bodyDiffReferenceCount,
    );

    stableFactors = {
      ...stableFactors,
      bodyStable: stableFactors.bodyStable && nextFactors.bodyStable,
      bodyLengthStable:
        stableFactors.bodyLengthStable && nextFactors.bodyLengthStable,
      statusCodeStable:
        stableFactors.statusCodeStable && nextFactors.statusCodeStable,
      reflectionStable:
        stableFactors.reflectionStable && nextFactors.reflectionStable,
      headersStable: stableFactors.headersStable && nextFactors.headersStable,
      similarityStable:
        stableFactors.similarityStable && nextFactors.similarityStable,
      redirectStable:
        stableFactors.redirectStable && nextFactors.redirectStable,
      similarity: Math.min(stableFactors.similarity, nextFactors.similarity),
      unstableHeaders: Array.from(
        new Set([
          ...stableFactors.unstableHeaders,
          ...nextFactors.unstableHeaders,
        ]),
      ),
      redirect: nextFactors.redirect,
    };

    if (stableFactors.reflectionsCount !== nextFactors.reflectionsCount) {
      stableFactors.reflectionStable = false;
    }
  }

  return {
    initialRequestResponse,
    stableFactors,
    bodyDiffReferenceCount,
  };
}

export function extractWordsFromResponseBody(body: string): string[] {
  const cleaned = body
    .replace(/[^a-zA-Z0-9\s_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return [];
  }

  return sanitizeWords(cleaned.split(" ").filter((word) => word.length > 2));
}

export function applyAdditionalChecks(
  words: string[],
  result: AdditionalChecksResult,
): string[] {
  if (result.handlesSpecialCharacters) {
    return words;
  }

  if (!result.handlesEncodedSpecialCharacters) {
    return words.filter((word) => !/[^a-zA-Z0-9-_]/.test(word));
  }

  return words.map((word) =>
    word.replace(/[^a-zA-Z0-9-_]/g, (character) =>
      encodeURIComponent(character),
    ),
  );
}

export function getSizeProbeConfig(
  attackType: AttackType,
  bodyKind: InspectableBodyKind,
  customValueType?: ParameterValueType,
): SizeProbeConfig {
  if (attackType === "headers") {
    return {
      sizes: [100, 80, 50, 20],
      defaultSize: 20,
      createParameters: (random, size) =>
        Array.from({ length: size }, () => ({
          name: randomString(10, random),
          value: createLearningParameterValue(10, random, customValueType),
        })),
    };
  }

  if (attackType === "query") {
    return {
      sizes: [14000, 8000, 4000, 2000, 500],
      defaultSize: 500,
      createParameters: (random, size) => [
        {
          name: "paramFinderTest",
          value: createLearningParameterValue(size, random, customValueType),
        },
      ],
    };
  }

  if (bodyKind === "multipart") {
    return {
      sizes: [50000, 30000, 16000, 8000, 4000],
      defaultSize: 4000,
      createParameters: (random, size) => [
        {
          name: "paramFinderTest",
          value: createLearningParameterValue(size, random, customValueType),
        },
      ],
    };
  }

  if (bodyKind === "json" && customValueType === "integer") {
    return {
      sizes: [50000, 30000, 16000, 8000, 4000, 2000],
      defaultSize: 2000,
      createParameters: (random, size) =>
        createIntegerJsonProbeParameters(random, size),
    };
  }

  return {
    sizes: [50000, 30000, 16000, 8000, 4000, 2000],
    defaultSize: 2000,
    createParameters: (random, size) => [
      {
        name: "paramFinderTest",
        value: createLearningParameterValue(size, random, customValueType),
      },
    ],
  };
}

function createLearningParameterValue(
  length: number,
  random: () => number,
  customValueType?: ParameterValueType,
): string {
  if (customValueType === "integer") {
    return createIntegerString(length, random);
  }

  return randomString(length, random);
}

function createIntegerString(length: number, random: () => number): string {
  let digits = `${Math.floor(random() * 9) + 1}`;

  for (let index = 1; index < length; index += 1) {
    digits += Math.floor(random() * 10).toString();
  }

  return digits;
}

function createIntegerJsonProbeParameters(
  random: () => number,
  targetSize: number,
): Parameter[] {
  const parameters: Parameter[] = [];
  let estimatedBodyLength = 2;
  let index = 0;

  while (estimatedBodyLength < targetSize) {
    const name = `pf${index}`;
    const separatorLength = parameters.length === 0 ? 0 : 1;
    const propertyOverhead = name.length + 3;
    const remainingLength =
      targetSize - estimatedBodyLength - separatorLength - propertyOverhead;
    const digitsLength = Math.max(1, Math.min(15, remainingLength));
    const value = createIntegerString(digitsLength, random);

    parameters.push({ name, value });
    estimatedBodyLength += separatorLength + propertyOverhead + value.length;
    index += 1;
  }

  return parameters;
}

function checkStableFactors(
  initialRequestResponse: EngineRequestResponse,
  nextRequestResponse: EngineRequestResponse,
  parameters: Parameter[],
  bodyDiffReferenceCount: number,
): StableFactors {
  const initialResponse = initialRequestResponse.response;
  const nextResponse = nextRequestResponse.response;
  const initialBody = initialResponse.body ?? "";
  const nextBody = nextResponse.body ?? "";
  const initialLocation = getFirstHeaderValue(
    initialResponse.headers,
    "Location",
  );

  const unstableHeaders = new Set<string>(
    DEFAULT_UNSTABLE_HEADERS.map(normalizeHeaderName),
  );
  const headerNames = new Set([
    ...getNormalizedHeaderNames(initialResponse.headers),
    ...getNormalizedHeaderNames(nextResponse.headers),
  ]);
  const similarity = stringSimilarity(initialBody, nextBody);
  const diffCount = countLineDifferences(initialBody, nextBody);
  const reflectionsCount = getReflectionsCount(nextBody, parameters);
  for (const headerName of headerNames) {
    const initialHeaderValues = getHeaderValues(
      initialResponse.headers,
      headerName,
    );
    const nextHeaderValues = getHeaderValues(nextResponse.headers, headerName);
    if (!headerValuesEqual(initialHeaderValues, nextHeaderValues)) {
      unstableHeaders.add(headerName);
    }
  }

  const location = getFirstHeaderValue(nextResponse.headers, "Location");

  return {
    bodyStable: diffCount === bodyDiffReferenceCount,
    bodyLength: initialBody.length,
    bodyLengthStable: nextBody.length === initialBody.length,
    headersStable: true,
    statusCodeStable: nextResponse.status === initialResponse.status,
    reflectionStable: true,
    similarityStable: similarity > 0.98,
    redirectStable: initialLocation === location,
    reflectionsCount,
    statusCode: nextResponse.status,
    unstableHeaders: Array.from(unstableHeaders),
    similarity,
    redirect: location,
  };
}

function getReflectionsCount(body: string, parameters: Parameter[]): number {
  let maxCount = 0;

  for (const parameter of parameters) {
    for (const variation of getReflectionVariations(parameter.value)) {
      const count = countOccurrences(body, variation);
      if (count > maxCount) {
        maxCount = count;
      }
    }
  }

  return maxCount;
}

function getReflectionVariations(value: string): string[] {
  const variations = new Set<string>([value]);
  const encoded = encodeURIComponent(value);

  if (encoded !== value) {
    variations.add(encoded);
  }

  if (value.includes("<") || value.includes(">")) {
    variations.add(value.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  }

  if (value.includes('"')) {
    variations.add(value.replace(/"/g, "&quot;"));
  }

  if (value.includes("'")) {
    variations.add(value.replace(/'/g, "&#39;"));
  }

  return Array.from(variations);
}
