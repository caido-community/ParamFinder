import {
  Parameter,
  RequestResponse,
  Response,
} from "shared";
import { Anomaly, AnomalyType, StableFactors } from "shared";
import { DiffingSystem } from "../util/diffing";
import {
  DEFAULT_RANDOM_PARAMETER_VALUE_LENGTH,
  stringSimilarity,
  randomString,
} from "../util/helper";
import { ParamMiner } from "./param-miner";

const defaultUnstableHeaders = new Set<string>([
  "Content-Length",
  "Date",
  "CF-Cache-Status"
]);

export class AnomalyDetector {
  private stableFactors: StableFactors | undefined;
  public initialRequestResponse: RequestResponse | undefined;
  private paramMiner: ParamMiner;
  private differ: DiffingSystem | undefined;
  private wafResponse: Response | null = null;

  constructor(paramMiner: ParamMiner) {
    this.paramMiner = paramMiner;
  }

  public hasChanges(
    response: Response,
    parameters: Parameter[]
  ): Anomaly | undefined {
    if (!this.stableFactors || !this.initialRequestResponse?.response) {
      return undefined;
    }

    const responseBody = response.body || "";

    if (this.wafResponse) {
      if (
        this.wafResponse.status === response.status &&
        stringSimilarity(this.wafResponse.body, responseBody) > 0.85
      ) {
        return undefined;
      }
    }

    // Check if status code is stable
    if (
      this.stableFactors.statusCodeStable &&
      this.stableFactors.statusCode &&
      response.status !== this.initialRequestResponse.response.status
    ) {
      return {
        type: AnomalyType.StatusCode,
        from: this.initialRequestResponse.response.status.toString(),
        to: response.status.toString(),
      };
    }

    // Check if redirect is stable
    if (this.stableFactors.redirect && this.stableFactors.redirectStable) {
      if (
        response.headers["Location"] &&
        response.headers["Location"][0] !== this.stableFactors.redirect
      ) {
        return {
          type: AnomalyType.Redirect,
          from: this.stableFactors.redirect,
          to: response.headers["Location"][0],
        };
      }
    }

    // Check headers if they're stable
    if (this.stableFactors.headersStable) {
      const initialHeaders = this.initialRequestResponse.response.headers;
      const currentHeaders = response.headers;

      // Check for missing or modified headers from initial response
      for (const [key, value] of Object.entries(initialHeaders)) {
        if (this.stableFactors.unstableHeaders.has(key)) {
          continue;
        }

        if (
          !currentHeaders[key] ||
          JSON.stringify(currentHeaders[key]) !== JSON.stringify(value)
        ) {
          return {
            type: AnomalyType.Headers,
            from: JSON.stringify(value),
            to: JSON.stringify(currentHeaders[key]),
            which: key,
          };
        }
      }

      // Check for new headers not present in initial response
      for (const key of Object.keys(currentHeaders)) {
        if (
          !this.stableFactors.unstableHeaders.has(key) &&
          !initialHeaders[key]
        ) {
          return {
            type: AnomalyType.Headers,
            from: "N/A",
            to: JSON.stringify(currentHeaders[key]),
            which: key,
          };
        }
      }
    }

    // Check if reflections are stable
    if (this.stableFactors.reflectionStable) {
      for (const param of parameters) {
        const reflectionCount = responseBody.split(param.value).length - 1;
        if (reflectionCount !== this.stableFactors.reflectionsCount) {
          return {
            type: AnomalyType.ReflectionCount,
            from: this.stableFactors.reflectionsCount.toString(),
            to: reflectionCount.toString(),
            which: param.name,
          };
        }
      }
    }

    if (this.stableFactors.bodyLengthStable) {
      const responseLength = responseBody.length;
      if (responseLength !== this.stableFactors.bodyLength) {
        return {
          type: AnomalyType.Body,
          which: "length",
          from: this.stableFactors.bodyLength.toString(),
          to: responseLength.toString(),
        };
      }
    }

    // Check body changes
    if (this.stableFactors.bodyStable) {
      const differChanges = this.differ?.hasChanges(responseBody);
      if (differChanges) {
        return {
          type: AnomalyType.Body,
        };
      }
    }

    // Check similarity between responses if stable
    if (this.stableFactors.similarityStable) {
      const similarity = stringSimilarity(this.initialRequestResponse?.response.body || "", responseBody);
      if (similarity < 0.95) {
        return {
          type: AnomalyType.Similarity,
        };
      }
    }

    return undefined;
  }

  private getParams(count: number): Parameter[] {
    const params = [];
    for (let j = 0; j < count; j++) {
      params.push({
        name: randomString(10 + count),
        value: randomString(DEFAULT_RANDOM_PARAMETER_VALUE_LENGTH),
      } as Parameter);
    }
    return params;
  }

  public async learnFactors() {
    const learnRequestsCount = this.paramMiner.config.learnRequestsCount;
    if (learnRequestsCount <= 2) {
      throw new Error("Learn requests count must be at least 3");
    }

    this.paramMiner.eventEmitter.emit("debug", `[anomaly.ts] Starting learning phase with ${learnRequestsCount} requests`);

    const learnResponses: {
      requestResponse: RequestResponse;
      parameters: Parameter[];
    }[] = [];

    for (let i = 0; i < learnRequestsCount; i++) {
      if (!await this.paramMiner.stateManager.continueOrWait()) {
        this.paramMiner.eventEmitter.emit("debug", "[anomaly.ts] Learning phase canceled or errored");
        throw new Error("Learning phase canceled");
      }

      const params = this.getParams(i + 1);
      this.paramMiner.eventEmitter.emit("debug", `[anomaly.ts] Sending learning request ${i + 1}/${learnRequestsCount}`);

      const requestResponse =
        await this.paramMiner.requester.sendRequestWithParams(
          this.paramMiner.target,
          params,
          "learning"
        );

      if (!await this.paramMiner.stateManager.continueOrWait()) {
        this.paramMiner.eventEmitter.emit("debug", "[anomaly.ts] Learning phase canceled after request");
        throw new Error("Learning phase canceled");
      }

      this.paramMiner.eventEmitter.emit("responseReceived", 0, requestResponse);

      learnResponses.push({
        requestResponse,
        parameters: params,
      });

      const delay = this.paramMiner.config.delayBetweenRequests + Math.floor(Math.random() * 300) + 200;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    if (!await this.paramMiner.stateManager.continueOrWait()) {
      this.paramMiner.eventEmitter.emit("debug", "[anomaly.ts] Learning phase canceled before processing responses");
      throw new Error("Learning phase canceled");
    }

    this.initialRequestResponse = learnResponses[0]?.requestResponse;

    const initialResponse = this.initialRequestResponse?.response;
    const secondResponse = learnResponses[1]?.requestResponse.response;
    if (!initialResponse || !secondResponse) {
      throw new Error("Initial response or second response is undefined");
    }

    this.differ = new DiffingSystem(
      this.paramMiner.sdk,
      initialResponse?.body || "",
      secondResponse?.body || ""
    );

    const stable = this.checkFactors(
      secondResponse,
      learnResponses[1]?.parameters ?? []
    );

    // Check similarity between first two responses
    const similarity = stringSimilarity(initialResponse.body || "", secondResponse.body || "");
    stable.similarityStable = similarity > 0.98;
    stable.similarity = similarity;

    for (let i = 2; i < learnRequestsCount; i++) {
      const learnResponse = learnResponses[i];
      if (!learnResponse) {
        continue;
      }

      const response = learnResponse.requestResponse.response;
      const parameters = learnResponse.parameters;
      const newFactors = this.checkFactors(response, parameters);

      stable.bodyStable = stable.bodyStable && newFactors.bodyStable;
      stable.bodyLengthStable =
        stable.bodyLengthStable && newFactors.bodyLengthStable;
      stable.statusCodeStable =
        stable.statusCodeStable && newFactors.statusCodeStable;
      stable.reflectionStable =
        stable.reflectionStable && newFactors.reflectionStable;
      stable.headersStable = stable.headersStable && newFactors.headersStable;
      stable.similarityStable = stable.similarityStable && newFactors.similarityStable;
      stable.similarity = Math.min(stable.similarity, newFactors.similarity);
      stable.unstableHeaders = new Set([
        ...stable.unstableHeaders,
        ...newFactors.unstableHeaders,
      ]);
      stable.redirect = newFactors.redirect;
      stable.redirectStable = stable.redirectStable && newFactors.redirectStable;

      if (stable.reflectionsCount != newFactors.reflectionsCount) {
        stable.reflectionStable = false;
      }
    }

    this.stableFactors = stable;
    this.paramMiner.eventEmitter.emit("debug", "[anomaly.ts] Learning phase completed");
    this.paramMiner.eventEmitter.emit("debug", `[anomaly.ts] Factors: ${JSON.stringify(stable)}`);
  }

  private checkFactors(
    response: Response,
    parameters: Parameter[]
  ): StableFactors {
    const initialBody = this.initialRequestResponse?.response.body || "";
    const initialBodyLength = initialBody.length;
    const stable = {
      bodyStable: true,
      bodyLength: initialBodyLength,
      bodyLengthStable: true,
      headersStable: true,
      statusCodeStable: true,
      reflectionStable: true,
      similarityStable: true,
      redirectStable: true,
      reflectionsCount: 0,
      statusCode: response.status,
      unstableHeaders: new Set<string>(defaultUnstableHeaders),
      similarity: 1
    } as StableFactors;

    const locationHeader = response.headers["Location"];
    if (locationHeader) {
      stable.redirect = locationHeader[0];

      const initialLocationHeader = this.initialRequestResponse?.response.headers["Location"];
      if (initialLocationHeader) {
        stable.redirectStable = initialLocationHeader[0] === stable.redirect;
      }
    }

    const responseBody = response.body || "";

    // Calculate similarity with initial response
    const similarity = stringSimilarity(initialBody, responseBody);
    stable.similarity = similarity;
    stable.similarityStable = similarity > 0.98;

    if (responseBody.length !== initialBodyLength) {
      stable.bodyLengthStable = false;
    }

    const hasChanges = this.differ?.hasChanges(responseBody);
    if (hasChanges) {
      stable.bodyStable = false;
    }

    if (response.status !== this.initialRequestResponse?.response.status) {
      stable.statusCodeStable = false;
    }

    for (const param of parameters) {
      const variations = [param.value];

      const encoded = encodeURIComponent(param.value);
      if (encoded !== param.value) {
        variations.push(encoded);
      }

      if (param.value.includes('<') || param.value.includes('>')) {
        variations.push(param.value.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
      }

      if (param.value.includes('"')) {
        variations.push(param.value.replace(/"/g, '&quot;'));
      }

      if (param.value.includes("'")) {
        variations.push(param.value.replace(/'/g, '&#39;'));
      }

      for (const variation of variations) {
        if (responseBody.includes(variation)) {
          const reflections = responseBody.split(variation).length - 1;
          stable.reflectionsCount = Math.max(stable.reflectionsCount, reflections);
        }
      }
    }

    if (
      Object.keys(response.headers).length !==
      Object.keys(this.initialRequestResponse!.response.headers).length
    ) {
      stable.headersStable = false;
    } else {
      // Compare each header value
      for (const [headerName, headerValues] of Object.entries(
        response.headers
      )) {
        const initialHeaderValues =
          this.initialRequestResponse!.response.headers[headerName];

        // Check if header exists in initial response and values match
        if (
          !initialHeaderValues ||
          headerValues.length !== initialHeaderValues.length ||
          !headerValues.every((val, idx) => val === initialHeaderValues[idx])
        ) {
          stable.unstableHeaders.add(headerName);
        }
      }
    }

    return stable;
  }

  public setWafResponse(response: Response) {
    this.wafResponse = response;
  }

  public getWafResponse() {
    return this.wafResponse;
  }
}
