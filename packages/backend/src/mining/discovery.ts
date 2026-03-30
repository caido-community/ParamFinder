import { Anomaly, Finding, MiningSessionPhase, MiningSessionState, Parameter, RequestResponse } from "shared";
import {
  DEFAULT_RANDOM_PARAMETER_VALUE_LENGTH,
  randomString,
} from "../util/helper";
import { ParamMiner } from "./param-miner";

interface ChunkResult {
  requestResponse: RequestResponse;
  parameters: Parameter[];
  anomaly?: Anomaly;
}

export class ParamDiscovery {
  private readonly paramMiner: ParamMiner;
  private lastWordlistIndex: number;
  private static readonly DEFAULT_HEADER_CHUNK_SIZE = 20;

  constructor(paramMiner: ParamMiner) {
    this.paramMiner = paramMiner;
    this.lastWordlistIndex = 0;
  }

  private emit(event: string, ...args: any[]): void {
    this.paramMiner.eventEmitter.emit(event, ...args);
  }

  private emitDebug(message: string): void {
    this.emit("debug", `[discovery.ts] ${message}`);
  }

  private emitLog(message: string): void {
    this.emit("logs", message);
  }

  public async startDiscovery(): Promise<void> {
    const timeout = this.paramMiner.config.timeout * 1000;
    const startTime = Date.now();

    this.emitDebug(`Starting discovery with timeout ${timeout}ms`);

    try {
      await this.processParameters(timeout, startTime);
    } catch (error) {
      this.emitDebug(
        `Discovery error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }

    if (await this.paramMiner.stateManager.continueOrWait()) {
      this.completeDiscovery(startTime);
    }
  }

  private async processParameters(
    timeout: number,
    startTime: number
  ): Promise<void> {
    while (this.hasMoreParameters()) {
      try {
        if (!(await this.paramMiner.stateManager.continueOrWait())) {
          this.emitDebug("Discovery canceled or errored");
          return;
        }

        if (this.isTimedOut(startTime, timeout)) {
          this.handleTimeout(timeout);
          return;
        }

        const chunk = this.getNextWordlistChunk();
        if (chunk.length === 0) {
          this.emitDebug("No more parameters to process");
          break;
        }

        await this.processChunk(chunk);
      } catch (error) {
        this.emitDebug(`Error processing chunk: ${error}`);
      }
    }
  }

  private isTimedOut(startTime: number, timeout: number): boolean {
    return Date.now() - startTime > timeout;
  }

  private handleTimeout(timeout: number): void {
    const message = `Discovery timed out after ${timeout}ms`;
    this.emitDebug(message);
    this.emitLog(message);
    this.paramMiner.updateState(MiningSessionState.Timeout);
  }

  private async processChunk(chunk: Parameter[]): Promise<void> {
    this.emitDebug(`Processing chunk of ${chunk.length} parameters`);

    const result = await this.sendRequest(chunk);
    if (!result) return;

    this.emit("responseReceived", chunk.length, result.requestResponse);

    if (!(await this.paramMiner.stateManager.continueOrWait())) {
      this.emitDebug("Discovery canceled after request");
      return;
    }

    if (this.isRateLimited(result.requestResponse.response)) {
      this.handleRateLimit();
      return;
    }

    const anomaly = this.paramMiner.anomalyDetector.hasChanges(
      result.requestResponse.response,
      chunk
    );

    if (anomaly) {
      await this.handleAnomaly(chunk, anomaly);
    }

    await this.delay();
  }

  private async sendRequest(
    chunk: Parameter[]
  ): Promise<ChunkResult | undefined> {
    this.emitDebug(`Sending request with ${chunk.length} parameters...`);
    const query = this.buildQueryString(chunk);
    this.emitDebug(`Built query string of length ${query.length}`);

    const requestResponse =
      await this.paramMiner.requester.sendRequestWithParams(
        this.paramMiner.target,
        chunk,
        "discovery"
      );

    return { requestResponse, parameters: chunk };
  }

  private buildQueryString(parameters: Parameter[]): string {
    return parameters
      .map(
        (param) =>
          `${encodeURIComponent(param.name)}=${encodeURIComponent(param.value)}`
      )
      .join("&");
  }

  private isRateLimited(response: any): boolean {
    return response.status === 429;
  }

  private handleRateLimit(): void {
    this.emitDebug("Rate limit detected (429)");
    this.emitLog(
      "Rate limited, pausing discovery. Please adjust delay between requests."
    );
    this.paramMiner.updateState(MiningSessionState.Paused);
  }

  private async handleAnomaly(chunk: Parameter[], anomaly: Anomaly): Promise<void> {
    if (this.paramMiner.config.ignoreAnomalyTypes.includes(anomaly.type)) {
      return;
    }

    this.emitDebug(
      `Initial anomaly detected: ${this.describeAnomaly(anomaly)}`
    );

    const verifyResult = await this.verifyAnomaly(chunk);
    if (!verifyResult) return;

    if (verifyResult.anomaly) {
      await this.processVerifiedAnomaly(chunk, verifyResult);
    } else {
      this.emitDebug("Anomaly not verified in second request");
    }
  }

  private async verifyAnomaly(
    chunk: Parameter[]
  ): Promise<ChunkResult | undefined> {
    const verifyRequestResponse =
      await this.paramMiner.requester.sendRequestWithParams(
        this.paramMiner.target,
        chunk,
        "narrower"
      );

    this.emit("responseReceived", 0, verifyRequestResponse);

    if (!(await this.paramMiner.stateManager.continueOrWait())) {
      this.emitDebug("Discovery canceled during verification");
      return;
    }

    const verifyAnomaly = this.paramMiner.anomalyDetector.hasChanges(
      verifyRequestResponse.response,
      chunk
    );

    if (!verifyAnomaly) {
      return undefined;
    }

    const controlRequestResponse =
      await this.paramMiner.requester.sendRequestWithParams(
        this.paramMiner.target,
        [],
        "narrower"
      );

    this.emit("responseReceived", 0, controlRequestResponse);

    if (!(await this.paramMiner.stateManager.continueOrWait())) {
      this.emitDebug("Discovery canceled during control verification");
      return;
    }

    const controlAnomaly = this.paramMiner.anomalyDetector.hasChanges(
      controlRequestResponse.response,
      []
    );

    if (controlAnomaly) {
      this.emitDebug(
        `Control request also changed: ${this.describeAnomaly(controlAnomaly)}`
      );
      return undefined;
    }

    return {
      requestResponse: verifyRequestResponse,
      parameters: chunk,
      anomaly: verifyAnomaly,
    };
  }

  private async processVerifiedAnomaly(
    chunk: Parameter[],
    verifyResult: ChunkResult
  ): Promise<void> {
    this.emitDebug(
      `Anomaly verified: ${this.describeAnomaly(verifyResult.anomaly)}`
    );
    this.emitAnomalyLog(chunk.length, verifyResult);

    const narrowedDownChunk = await this.narrowDownWordlist([...chunk]);
    this.emitDebug(`Narrowed down to ${narrowedDownChunk.length} parameters`);

    narrowedDownChunk.forEach((finding) => {
      this.emit("finding", finding);
    });

    if (narrowedDownChunk.length === 0) {
      this.emitDebug("False positive detected");
      this.emitLog("False positive - no parameters could be isolated");
    }
  }

  private emitAnomalyLog(chunkLength: number, result: ChunkResult): void {
    const anomaly = this.describeAnomaly(result.anomaly);
    this.emitLog(
      `Anomaly ${anomaly} detected in response. ` +
        `Narrowing down ${chunkLength} parameters.`
    );
  }

  private describeAnomaly(anomaly?: Anomaly): string {
    if (!anomaly) {
      return "UNKNOWN";
    }

    if (anomaly.type === "body" && anomaly.which === "length") {
      return `BODY (length ${anomaly.from} -> ${anomaly.to})`;
    }

    if (anomaly.which && anomaly.from && anomaly.to) {
      return `${anomaly.type.toUpperCase()} (${anomaly.which}: ${anomaly.from} -> ${anomaly.to})`;
    }

    return anomaly.type.toUpperCase();
  }

  private async delay(): Promise<void> {
    await new Promise((resolve) =>
      setTimeout(resolve, this.paramMiner.config.delayBetweenRequests)
    );
  }

  private completeDiscovery(startTime: number): void {
    this.paramMiner.updateState(MiningSessionState.Completed);
    this.emit("complete");

    const totalTime = Date.now() - startTime;
    this.emitLog(`Discovery complete in ${totalTime}ms`);
  }

  private async narrowDownWordlist(chunk: Parameter[]): Promise<Finding[]> {
    const findings: Finding[] = [];
    const chunksToProcess: Parameter[][] = [chunk];

    this.emitDebug(
      `Starting narrowDownWordlist with ${chunk.length} parameters`
    );

    while (chunksToProcess.length > 0) {
      const currentChunk = chunksToProcess.pop();
      if (!currentChunk || currentChunk.length === 0) continue;

      if (!(await this.paramMiner.stateManager.continueOrWait())) {
        this.emitDebug("Narrowing canceled");
        return findings;
      }

      this.emitDebug(`Processing chunk of ${currentChunk.length} parameters`);
      const startTime = Date.now();

      const { request, response } =
        await this.paramMiner.requester.sendRequestWithParams(
          this.paramMiner.target,
          currentChunk,
          "narrower"
        );

      this.emit("responseReceived", 0, { request, response });

      if (!(await this.paramMiner.stateManager.continueOrWait())) {
        this.emitDebug("Narrowing canceled after request");
        return findings;
      }

      const requestTime = Date.now() - startTime;
      this.emitDebug(`Request completed in ${requestTime}ms`);

      const anomaly = this.paramMiner.anomalyDetector.hasChanges(
        response,
        currentChunk
      );

      if (anomaly) {
        this.emitDebug(`Anomaly detected: ${anomaly.type}`);

        if (currentChunk.length === 1) {
          const parameter = currentChunk[0];
          if (!parameter) continue;

          const { request, response: verifyResponse } =
            await this.paramMiner.requester.sendRequestWithParams(
              this.paramMiner.target,
              currentChunk,
              "narrower"
            );

          this.emit("responseReceived", 0, {
            request,
            response: verifyResponse,
          });

          if (!(await this.paramMiner.stateManager.continueOrWait())) {
            this.emitDebug("Narrowing canceled during verification");
            return findings;
          }

          const verifyAnomaly = this.paramMiner.anomalyDetector.hasChanges(
            verifyResponse,
            currentChunk
          );

          if (verifyAnomaly) {
            const controlRequestResponse =
              await this.paramMiner.requester.sendRequestWithParams(
                this.paramMiner.target,
                [],
                "narrower"
              );

            this.emit("responseReceived", 0, controlRequestResponse);

            if (!(await this.paramMiner.stateManager.continueOrWait())) {
              this.emitDebug("Narrowing canceled during control verification");
              return findings;
            }

            const controlAnomaly = this.paramMiner.anomalyDetector.hasChanges(
              controlRequestResponse.response,
              []
            );

            if (controlAnomaly) {
              this.emitDebug(
                `Control request also changed for ${parameter.name}: ${this.describeAnomaly(controlAnomaly)}`
              );
              continue;
            }

            this.emitDebug(
              `Parameter verified: ${parameter.name} (${this.describeAnomaly(verifyAnomaly)})`
            );
            findings.push({
              requestResponse: { request, response: verifyResponse },
              parameter,
              anomalyType: verifyAnomaly.type,
              anomaly: verifyAnomaly,
            });
          } else {
            this.emitDebug(`Parameter verification failed: ${parameter.name}`);
          }
        } else {
          const mid = Math.floor(currentChunk.length / 2);
          const firstHalf = currentChunk.slice(0, mid);
          const secondHalf = currentChunk.slice(mid);

          this.emitDebug(
            `Splitting chunk into ${firstHalf.length} and ${secondHalf.length} parameters`
          );
          chunksToProcess.push(secondHalf);
          chunksToProcess.push(firstHalf);
        }
      } else {
        this.emitDebug(
          `No anomaly detected for chunk of ${currentChunk.length} parameters`
        );
      }

      await new Promise((resolve) =>
        setTimeout(resolve, this.paramMiner.config.delayBetweenRequests)
      );
    }

    this.emitDebug(`Narrowing complete - found ${findings.length} parameters`);
    return findings;
  }

  private getNextWordlistChunk(): Parameter[] {
    if (!this.paramMiner) {
      throw new Error("ParamMiner is not initialized");
    }

    const wordlist = Array.from(this.paramMiner.wordlist ?? []);
    const attackType = this.paramMiner.config.attackType;
    const maxSize = this.paramMiner.maxSize;

    switch (attackType) {
      case "headers":
        return this.getNextHeaderChunk(wordlist, maxSize);
      case "query":
        return this.getNextQueryChunk(wordlist, maxSize);
      case "body":
        return this.getNextBodyChunk(wordlist, maxSize);
      default:
        throw new Error(`Unknown attack type: ${attackType}`);
    }
  }

  private getNextHeaderChunk(
    wordlist: string[],
    maxSize: number | undefined
  ): Parameter[] {
    let chunkSize = Math.min(
      maxSize ?? ParamDiscovery.DEFAULT_HEADER_CHUNK_SIZE,
      wordlist.length - this.lastWordlistIndex
    );

    if (this.paramMiner.config.maxParametersAmount) {
      chunkSize = Math.min(chunkSize, this.paramMiner.config.maxParametersAmount);
    }

    const chunk = wordlist
      .slice(this.lastWordlistIndex, this.lastWordlistIndex + chunkSize)
      .map((word) => ({
        name: word,
        value: this.obtainParameterValue(),
      }));

    this.lastWordlistIndex += chunkSize;
    return chunk;
  }

  private getNextQueryChunk(
    wordlist: string[],
    maxSize: number | undefined
  ): Parameter[] {
    const parameterChunk: Parameter[] = [];
    let currentSize = this.paramMiner.target.url.length;

    const remainingWords = wordlist.length - this.lastWordlistIndex;
    let maxChunkSize = remainingWords;

    if (this.paramMiner.config.maxParametersAmount) {
      maxChunkSize = Math.min(maxChunkSize, this.paramMiner.config.maxParametersAmount);
    }

    while (this.lastWordlistIndex < wordlist.length && parameterChunk.length < maxChunkSize) {
      const word = wordlist[this.lastWordlistIndex];
      if (!word) {
        this.lastWordlistIndex++;
        continue;
      }

      const value = this.obtainParameterValue();
      const encodedWord = encodeURIComponent(word);
      const encodedValue = encodeURIComponent(value);
      const paramSize = 2 + encodedWord.length + encodedValue.length;

      if (maxSize && currentSize + paramSize > maxSize) {
        break;
      }

      parameterChunk.push({ name: word, value });
      currentSize += paramSize;
      this.lastWordlistIndex++;
    }

    return parameterChunk;
  }

  private getNextBodyChunk(
    wordlist: string[],
    maxSize: number | undefined
  ): Parameter[] {
    const parameterChunk: Parameter[] = [];
    let currentSize = 2;

    const remainingWords = wordlist.length - this.lastWordlistIndex;
    let maxChunkSize = remainingWords;

    if (this.paramMiner.config.maxParametersAmount) {
      maxChunkSize = Math.min(maxChunkSize, this.paramMiner.config.maxParametersAmount);
    }

    while (this.lastWordlistIndex < wordlist.length && parameterChunk.length < maxChunkSize) {
      const word = wordlist[this.lastWordlistIndex];
      if (!word) {
        this.lastWordlistIndex++;
        continue;
      }

      const value = this.obtainParameterValue();
      const encodedWord = encodeURIComponent(word);
      const encodedValue = encodeURIComponent(value);

      let paramSize = 6 + encodedWord.length + encodedValue.length;

      if (this.paramMiner.requester.bodyType === "multipart") {
        const boundary =
          this.paramMiner.requester.multipartBoundary.length || 40;

        paramSize = 46 + boundary + encodedWord.length + encodedValue.length;
      }

      if (maxSize && currentSize + paramSize > maxSize) {
        break;
      }

      parameterChunk.push({ name: word, value });
      currentSize += paramSize;
      this.lastWordlistIndex++;
    }

    return parameterChunk;
  }

  private obtainParameterValue(): string {
    if (this.paramMiner.config.customValue) {
      return this.paramMiner.config.customValue + randomString(DEFAULT_RANDOM_PARAMETER_VALUE_LENGTH);
    }

    return randomString(DEFAULT_RANDOM_PARAMETER_VALUE_LENGTH);
  }

  private hasMoreParameters(): boolean {
    this.emit(
      "debug",
      "hasMoreParameters called with " +
        this.lastWordlistIndex +
        " and " +
        this.paramMiner.wordlist.size
    );
    return this.lastWordlistIndex < this.paramMiner.wordlist.size;
  }

  public cancel(): void {
    this.paramMiner.updateState(MiningSessionState.Canceled);
  }

  public pause(): void {
    this.paramMiner.updateState(MiningSessionState.Paused);
  }

  public resume(): void {
    const phase = this.paramMiner.stateManager.getPhase();
    const newState =
      phase === MiningSessionPhase.Learning
        ? MiningSessionState.Learning
        : MiningSessionState.Running;
    this.paramMiner.updateState(newState, phase);
  }
}
