import { getReflectionVariations } from "./internal/reflections";
import type {
  Anomaly,
  BaselineProfile,
  EngineResponse,
  Parameter,
  ReflectionCountAnomaly,
} from "./types";
import { AnomalyType } from "./types";
import {
  buildFragmentCounts,
  countLineDifferencesFromLeft,
  countOccurrences,
  getFirstHeaderValue,
  getHeaderValues,
  hasHeader,
  headerValuesEqual,
  normalizeHeaderName,
  sampleBody,
  similarityFromFragmentCounts,
  splitLines,
} from "./utils";

interface ReferenceIndex {
  similarityCounts?: Map<string, number>;
  similarityLength?: number;
  lines?: string[];
}

const referenceCache = new WeakMap<EngineResponse, ReferenceIndex>();

function getReferenceIndex(response: EngineResponse): ReferenceIndex {
  let index = referenceCache.get(response);
  if (index === undefined) {
    index = {};
    referenceCache.set(response, index);
  }

  return index;
}

function referenceSimilarity(
  reference: EngineResponse,
  responseBody: string,
): number {
  const referenceBody = reference.body;
  if (referenceBody === responseBody) {
    return 1;
  }

  const index = getReferenceIndex(reference);
  if (index.similarityCounts === undefined) {
    const lowered = sampleBody(referenceBody).toLowerCase();
    index.similarityCounts = buildFragmentCounts(lowered);
    index.similarityLength = lowered.length;
  }

  return similarityFromFragmentCounts(
    index.similarityCounts,
    index.similarityLength ?? 0,
    sampleBody(responseBody),
  );
}

function referenceLineDifferences(
  reference: EngineResponse,
  responseBody: string,
): number {
  if (reference.body === responseBody) {
    return 0;
  }

  const index = getReferenceIndex(reference);
  if (index.lines === undefined) {
    index.lines = splitLines(sampleBody(reference.body));
  }

  return countLineDifferencesFromLeft(index.lines, sampleBody(responseBody));
}

interface CompareResponseToReferenceOptions {
  referenceResponse: EngineResponse;
  response: EngineResponse;
  parameters: Parameter[];
  expectedBodyDiffCount?: number;
  expectedReflectionsCount?: number;
  expectedRedirect?: string;
  ignoredAnomalyTypes?: readonly AnomalyType[];
  skipCloudflareBlocks?: boolean;
}

const SIMILARITY_THRESHOLD = 0.95;

const CLOUDFLARE_BLOCK_STATUS = 403;
const CLOUDFLARE_BLOCK_MARKERS = [
  "sorry, you have been blocked",
  "attention required! | cloudflare",
  "error code: 1020",
  "cloudflare ray id",
  "cf-error-details",
];

export function matchesWafResponse(
  wafResponse: EngineResponse,
  response: EngineResponse,
): boolean {
  const wafBody = wafResponse.body;
  const responseBody = response.body;
  return (
    wafResponse.status === response.status &&
    (wafBody === responseBody ||
      referenceSimilarity(wafResponse, responseBody) > 0.85)
  );
}

/**
 * Recognizes a Cloudflare WAF block page (HTTP 403 "Sorry, you have been
 * blocked" / error 1020). These are emitted when a request value trips a
 * managed firewall rule and carry no signal about the parameter under test, so
 * they can optionally be suppressed instead of surfaced as findings.
 */
export function matchesCloudflareBlock(response: EngineResponse): boolean {
  if (response.status !== CLOUDFLARE_BLOCK_STATUS) {
    return false;
  }

  const haystack = `${response.body}\n${response.raw ?? ""}`.toLowerCase();
  return CLOUDFLARE_BLOCK_MARKERS.some((marker) => haystack.includes(marker));
}

export function compareResponseToReference(
  profile: BaselineProfile,
  options: CompareResponseToReferenceOptions,
): Anomaly | undefined {
  const stableFactors = profile.stableFactors;
  const referenceBody = options.referenceResponse.body;
  const responseBody = options.response.body;
  const ignoredAnomalyTypes = new Set(options.ignoredAnomalyTypes);
  const unstableHeaders = new Set(
    stableFactors.unstableHeaders.map(normalizeHeaderName),
  );
  if (
    profile.wafResponse &&
    matchesWafResponse(profile.wafResponse, options.response)
  ) {
    return undefined;
  }

  if (
    options.skipCloudflareBlocks &&
    matchesCloudflareBlock(options.response)
  ) {
    return undefined;
  }

  if (
    !ignoredAnomalyTypes.has(AnomalyType.StatusCode) &&
    stableFactors.statusCodeStable &&
    options.response.status !== options.referenceResponse.status
  ) {
    return {
      type: AnomalyType.StatusCode,
      from: options.referenceResponse.status,
      to: options.response.status,
    };
  }

  const expectedRedirect =
    options.expectedRedirect ??
    getFirstHeaderValue(options.referenceResponse.headers, "Location");
  if (
    !ignoredAnomalyTypes.has(AnomalyType.Redirect) &&
    stableFactors.redirectStable
  ) {
    const currentLocation = getFirstHeaderValue(
      options.response.headers,
      "Location",
    );
    if (currentLocation !== expectedRedirect) {
      return {
        type: AnomalyType.Redirect,
        from: expectedRedirect,
        to: currentLocation,
      };
    }
  }

  if (!ignoredAnomalyTypes.has(AnomalyType.Headers)) {
    for (const [headerName, values] of Object.entries(
      options.referenceResponse.headers,
    )) {
      if (unstableHeaders.has(normalizeHeaderName(headerName))) {
        continue;
      }

      const responseValues = getHeaderValues(
        options.response.headers,
        headerName,
      );
      if (!headerValuesEqual(responseValues, values)) {
        return {
          type: AnomalyType.Headers,
          headerName,
          from: values,
          to: responseValues,
        };
      }
    }

    for (const headerName of Object.keys(options.response.headers)) {
      if (
        unstableHeaders.has(normalizeHeaderName(headerName)) ||
        hasHeader(options.referenceResponse.headers, headerName)
      ) {
        continue;
      }

      return {
        type: AnomalyType.Headers,
        headerName,
        to: options.response.headers[headerName],
      };
    }
  }

  if (
    !ignoredAnomalyTypes.has(AnomalyType.ReflectionCount) &&
    stableFactors.reflectionStable
  ) {
    const reflectionAnomaly = getReflectionCountAnomalies({
      referenceBody,
      responseBody,
      parameters: options.parameters,
      expectedReflectionsCount: options.expectedReflectionsCount,
    })[0];
    if (reflectionAnomaly !== undefined) {
      return reflectionAnomaly;
    }
  }

  if (
    !ignoredAnomalyTypes.has(AnomalyType.Body) &&
    stableFactors.bodyLengthStable &&
    responseBody.length !== referenceBody.length
  ) {
    return {
      type: AnomalyType.Body,
      check: "length",
      from: referenceBody.length,
      to: responseBody.length,
    };
  }

  if (!ignoredAnomalyTypes.has(AnomalyType.Body) && stableFactors.bodyStable) {
    const diffCount = referenceLineDifferences(
      options.referenceResponse,
      responseBody,
    );
    const expectedDiffCount = options.expectedBodyDiffCount ?? 0;
    if (diffCount !== expectedDiffCount) {
      return {
        type: AnomalyType.Body,
        check: "content",
        expectedDiffCount,
        actualDiffCount: diffCount,
      };
    }
  }

  if (
    !ignoredAnomalyTypes.has(AnomalyType.Similarity) &&
    stableFactors.similarityStable
  ) {
    const similarity = referenceSimilarity(
      options.referenceResponse,
      responseBody,
    );
    if (similarity < SIMILARITY_THRESHOLD) {
      return {
        type: AnomalyType.Similarity,
        similarity,
        threshold: SIMILARITY_THRESHOLD,
      };
    }
  }

  return undefined;
}

export function detectAnomaly(
  profile: BaselineProfile,
  response: EngineResponse,
  parameters: Parameter[],
  ignoredAnomalyTypes?: readonly AnomalyType[],
  skipCloudflareBlocks = false,
): Anomaly | undefined {
  return compareResponseToReference(profile, {
    referenceResponse: profile.initialRequestResponse.response,
    response,
    parameters,
    expectedBodyDiffCount: profile.bodyDiffReferenceCount,
    expectedReflectionsCount: profile.stableFactors.reflectionsCount,
    expectedRedirect: profile.stableFactors.redirect,
    ignoredAnomalyTypes,
    skipCloudflareBlocks,
  });
}

export function detectReflectionCountAnomalies(
  profile: BaselineProfile,
  response: EngineResponse,
  parameters: Parameter[],
): ReflectionCountAnomaly[] {
  if (!profile.stableFactors.reflectionStable) {
    return [];
  }

  return getReflectionCountAnomalies({
    referenceBody: profile.initialRequestResponse.response.body,
    responseBody: response.body,
    parameters,
    expectedReflectionsCount: profile.stableFactors.reflectionsCount,
  });
}

function getReflectionCountAnomalies(args: {
  referenceBody: string;
  responseBody: string;
  parameters: Parameter[];
  expectedReflectionsCount?: number;
}): ReflectionCountAnomaly[] {
  const anomalies: ReflectionCountAnomaly[] = [];

  for (const parameter of args.parameters) {
    const reflectionCount = getReflectionCount(
      args.responseBody,
      parameter.value,
    );
    const referenceReflectionCount = getReflectionCount(
      args.referenceBody,
      parameter.value,
    );
    const expectedCount =
      args.expectedReflectionsCount === undefined
        ? referenceReflectionCount
        : args.expectedReflectionsCount;

    if (reflectionCount !== expectedCount) {
      anomalies.push({
        type: AnomalyType.ReflectionCount,
        parameterName: parameter.name,
        from: expectedCount,
        to: reflectionCount,
      });
    }
  }

  return anomalies;
}

function getReflectionCount(body: string, value: string): number {
  let maxCount = 0;

  for (const variation of getReflectionVariations(value)) {
    const count = countOccurrences(body, variation);
    if (count > maxCount) {
      maxCount = count;
    }
  }

  return maxCount;
}
