import { JSONPath } from "jsonpath-plus";
import { Parameter, Request, RequestContext } from "shared";
import { sendRequest } from "../requests/requests";
import { generateID } from "../util/helper";
import { autopilotCheckResponse } from "./features/autopilot";
import { ParamMiner } from "./param-miner";

export class Requester {
  private paramMiner: ParamMiner;
  public bodyType: "json" | "query" | "multipart" | "xml" | null = null;
  public multipartBoundary: string | null = null;

  constructor(paramMiner: ParamMiner) {
    this.paramMiner = paramMiner;
  }

  private isJSONBody(body: string): boolean {
    try {
      JSON.parse(body);
      return true;
    } catch {
      return false;
    }
  }

  private isQueryBody(body: string): boolean {
    // Check if body follows key=value&key2=value2 format
    const queryRegex = /^(?:[^=&]*=[^=&]*&?)*$/;
    return queryRegex.test(body);
  }

  private isXMLBody(body: string): boolean {
    try {
      // Check for XML declaration or root element
      const trimmedBody = body.trim();
      return (
        (trimmedBody.startsWith("<?xml") || trimmedBody.match(/^<[^?!]/) !== null) &&
        trimmedBody.includes(">")
      );
    } catch {
      return false;
    }
  }

  public async sendRequestWithParams(
    request: Request,
    parameters: Parameter[],
    context?: RequestContext
  ) {
    const attackType = this.paramMiner.config.attackType;

    const requestCopy = {
      ...request,
      id: generateID(),
      context: context ?? "discovery",
      headers: { ...request.headers },
    };

    this.paramMiner.eventEmitter.emit(
      "debug",
      `[requester.ts] Sending request with ${
        parameters.length
      } parameters... (requestCopy has ${
        Object.keys(requestCopy).length
      } parameters)`
    );

    switch (attackType) {
      case "query":
        this.handleQueryParameters(requestCopy, parameters);
        if (this.paramMiner.config.cacheBusterParameter || this.paramMiner.config.addCacheBusterParameter) {
          this.handleCacheBusterParameter(requestCopy);
        }
        break;

      case "headers":
        this.handleHeaderParameters(requestCopy, parameters);
        if (this.paramMiner.config.cacheBusterParameter || this.paramMiner.config.addCacheBusterParameter) {
          this.handleCacheBusterParameter(requestCopy);
        }
        break;

      case "body":
        this.handleBodyParameters(requestCopy, parameters);
        break;
    }

    // Update Content-Length if needed
    if (this.paramMiner.config.updateContentLength) {
      this.updateContentLength(requestCopy);
    }

    const requestResponse = await sendRequest(this.paramMiner.sdk, requestCopy);

    // Autopilot feature
    if (this.paramMiner.config.autopilotEnabled && context === "discovery") {
      const hasTakenAction = await autopilotCheckResponse(
        this.paramMiner,
        requestResponse
      );
      if (hasTakenAction) {
        this.paramMiner.sdk.console.log("Autopilot has taken action.");
      }
    }

    return requestResponse;
  }

  private handleQueryParameters(request: Request, parameters: Parameter[]) {
    const queryParams = parameters
      .map(
        (p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`
      )
      .join("&");

    request.query = request.query
      ? `${request.query}&${queryParams}`
      : queryParams;
  }

  private handleCacheBusterParameter(request: Request) {
    const cacheBusterParam = `cb${Date.now()}=${Date.now()}`;
    request.query = request.query
      ? `${request.query}&${cacheBusterParam}`
      : cacheBusterParam;
  }

  private handleHeaderParameters(request: Request, parameters: Parameter[]) {
    parameters.forEach((p) => {
      request.headers[p.name] = [p.value];
    });
  }

  private handleBodyParameters(request: Request, parameters: Parameter[]) {
    const originalBody = request.body || "";
    const contentType = request.headers["Content-Type"]?.[0]?.toLowerCase();

    if (!this.bodyType) {
      this.determineBodyType(originalBody, contentType);
    }

    switch (this.bodyType) {
      case "json":
        this.handleJSONBody(request, parameters, originalBody);
        break;

      case "query":
        this.handleQueryBody(request, parameters, originalBody);
        break;

      case "multipart":
        this.handleMultipartBody(request, parameters, originalBody);
        break;

      default:
        throw new Error("Unsupported body type.");
    }
  }

  private handleJSONBody(
    request: Request,
    parameters: Parameter[],
    originalBody: string
  ): void {
    try {
      const bodyObj = originalBody ? JSON.parse(originalBody) : {};

      let jsonPath = this.paramMiner.config.jsonBodyPath;
      if (jsonPath) {
        jsonPath = jsonPath.startsWith("$") ? jsonPath : `$.${jsonPath}`;

        const paramsToInject = parameters.reduce(
          (acc, param) => ({
            ...acc,
            [param.name]: param.value,
          }),
          {}
        );

        const target = JSONPath({
          path: jsonPath,
          json: bodyObj,
          wrap: false,
        });

        if (target && typeof target === "object") {
          Object.assign(target, paramsToInject);
        }
      } else {
        // If no path specified, add parameters to root
        parameters.forEach((p) => {
          bodyObj[p.name] = p.value;
        });
      }

      request.body = JSON.stringify(bodyObj);
      request.headers["content-type"] = ["application/json"];
    } catch (error) {
      throw new Error(`Failed to handle JSON body: ${error.message}`);
    }
  }

  private handleQueryBody(
    request: Request,
    parameters: Parameter[],
    originalBody: string
  ) {
    const existingParams = originalBody ? originalBody + "&" : "";
    const newParams = parameters
      .map(
        (p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`
      )
      .join("&");
    request.body = existingParams + newParams;
    request.headers["content-type"] = ["application/x-www-form-urlencoded"];
  }

  private handleMultipartBody(
    request: Request,
    parameters: Parameter[],
    originalBody: string
  ) {
    const originalContentType = request.headers["Content-Type"]?.[0];
    if (!originalContentType) throw new Error("Missing Content-Type header");

    const boundaryMatch = originalContentType.match(/boundary=(.+)/);
    if (!boundaryMatch) throw new Error("Missing multipart boundary");

    const boundary = boundaryMatch[1];
    const finalBoundary = `--${boundary}--`;
    const finalIndex = originalBody.indexOf(finalBoundary);
    if (finalIndex === -1)
      throw new Error("Invalid multipart body: cannot find final boundary");

    let bodyUpToFinalBoundary = originalBody.slice(0, finalIndex);
    if (!bodyUpToFinalBoundary.endsWith("\r\n")) {
      bodyUpToFinalBoundary += "\r\n";
    }

    for (const p of parameters) {
      bodyUpToFinalBoundary += `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`;
    }

    bodyUpToFinalBoundary += finalBoundary;
    request.body = bodyUpToFinalBoundary;
    request.headers["Content-Type"] = [originalContentType];
    this.multipartBoundary = boundary;
  }

  private determineBodyType(body: string, contentType: string | undefined) {
    // Check content-type first
    if (contentType) {
      if (contentType.includes("application/json")) {
        this.bodyType = "json";
      } else if (contentType.includes("application/x-www-form-urlencoded")) {
        this.bodyType = "query";
      } else if (contentType.includes("multipart/form-data")) {
        this.bodyType = "multipart";
      } else if (contentType.includes("application/xml") || contentType.includes("text/xml")) {
        this.bodyType = "xml";
      }
    }

    if (!this.bodyType) {
      if (this.isJSONBody(body)) {
        this.bodyType = "json";
      } else if (this.isQueryBody(body)) {
        this.bodyType = "query";
      } else if (this.isXMLBody(body)) {
        this.bodyType = "xml";
      } else {
        throw new Error("Unsupported body type detected.");
      }
    }

    this.paramMiner.sdk.api.send(
      "paramfinder:log",
      this.paramMiner.id,
      `Determined body format: ${this.bodyType}`
    );
  }

  private updateContentLength(request: Request) {
    const contentLength = request.body.length;
    if (contentLength === 0) {
      delete request.headers["Content-Length"];
    } else {
      request.headers["Content-Length"] = [contentLength.toString()];
    }
  }
}
