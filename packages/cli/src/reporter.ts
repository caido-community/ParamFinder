import {
  type AttackType,
  EnginePhase,
  EngineState,
  type LoggerLevel,
  type RequestContext,
  type ScanEvent,
  type ScanSummary,
} from "@paramfinder/engine";

import type { OutputMode } from "./args";

const RESET = "\u001B[0m";
const SPINNER_FRAMES = ["-", "\\", "|", "/"];

interface CliRunResult {
  url: string;
  method: string;
  attackType: AttackType;
  durationMs: number;
  summary: ScanSummary;
}

interface CliRunStart {
  url: string;
  method: string;
  attackType: AttackType;
  wordCount: number;
  delayMs?: number;
  timeoutMs?: number;
}

interface Reporter {
  start(run: CliRunStart): void;
  handle(event: ScanEvent): void;
  complete(result: CliRunResult): void;
  error(message: string): void;
}

export function createReporter(
  mode: OutputMode,
  options?: { quiet?: boolean; verbose?: boolean },
): Reporter {
  if (mode === "json") {
    return new JsonReporter();
  }

  if (mode === "json-stream") {
    return new JsonStreamReporter();
  }

  return new HumanReporter({
    quiet: options?.quiet ?? false,
    verbose: options?.verbose ?? false,
  });
}

class HumanReporter implements Reporter {
  private readonly quiet: boolean;
  private readonly verbose: boolean;
  private readonly isTty = Boolean(process.stderr.isTTY);
  private readonly useColor = shouldUseColor(process.stderr.isTTY);
  private lastStatusLength = 0;
  private currentState = EngineState.Pending;
  private currentPhase = EnginePhase.Idle;
  private spinnerIndex = 0;

  constructor(options: { quiet: boolean; verbose: boolean }) {
    this.quiet = options.quiet;
    this.verbose = options.verbose;
  }

  public start(run: CliRunStart): void {
    if (this.quiet) {
      return;
    }

    const tuning: string[] = [];
    if ((run.delayMs ?? 0) > 0) {
      tuning.push(`delay ${formatDuration(run.delayMs ?? 0)}`);
    }
    if (run.timeoutMs !== undefined) {
      tuning.push(`timeout ${formatDuration(run.timeoutMs)}`);
    }

    this.writeLine(
      `${this.bold(this.color("36", "ParamFinder"))} ${this.muted("parameter discovery")}`,
    );
    this.writeLine(
      `${this.label("Target")} ${this.bold(run.method)} ${run.url}`,
    );
    this.writeLine(
      `${this.label("Mode")} ${describeAttackType(run.attackType)}`,
    );
    this.writeLine(
      `${this.label("Candidates")} ${formatCount(run.wordCount, "name")}`,
    );
    if (tuning.length > 0) {
      this.writeLine(`${this.label("Tuning")} ${tuning.join(" | ")}`);
    }
    this.writeLine("");
  }

  public handle(event: ScanEvent): void {
    switch (event.type) {
      case "state":
        this.currentState = event.state;
        this.currentPhase = event.phase;
        this.renderStatus(event.progress);
        return;
      case "progress":
        this.renderStatus(event.progress);
        return;
      case "request":
        this.renderStatus(event.progress);
        return;
      case "log":
        if (event.level === "debug" && !this.verbose) {
          return;
        }
        if (event.level === "info" && this.quiet) {
          return;
        }
        this.writeLine(
          `${formatLevelBadge(event.level, this.useColor)} ${normalizeLogMessage(event.message)}`,
        );
        this.renderStatus(event.progress);
        return;
      case "finding":
        this.writeFinding(event.finding);
        this.renderStatus(event.progress);
        return;
      case "summary":
        this.renderStatus(event.progress);
        return;
    }
  }

  public complete(result: CliRunResult): void {
    this.clearStatus();
    const { summary } = result;
    this.writeLine("");
    this.writeLine(
      this.bold(
        colorize(
          this.useColor,
          getOutcomeColor(summary.state),
          getOutcomeHeading(summary.state),
        ),
      ),
    );
    this.writeLine(
      `${this.label("Target")} ${this.bold(result.method)} ${result.url}`,
    );
    this.writeLine(
      `${this.label("Mode")} ${describeAttackType(result.attackType)}`,
    );
    this.writeLine(
      `${this.label("Progress")} tested ${summary.parametersSent}/${summary.totalParametersAmount} names in ${formatCount(summary.requestsSent, "request")}`,
    );
    this.writeLine(
      `${this.label("Duration")} ${formatDuration(result.durationMs)}`,
    );
    if (summary.state === EngineState.Error) {
      this.writeLine(`${this.label("Reason")} ${summary.failureReason}`);
    }

    if (summary.findings.length === 0) {
      this.writeLine(
        `${this.label("Result")} ${
          summary.state === EngineState.Completed
            ? "No suspicious parameters stood out."
            : summary.state === EngineState.Error
              ? "Scan stopped because requests to the target started failing."
              : "No confirmed parameters were found before the scan stopped."
        }`,
      );
      return;
    }

    this.writeLine(
      `${this.label("Findings")} ${formatCount(summary.findings.length, "potential parameter")}`,
    );
  }

  public error(message: string): void {
    this.clearStatus();
    process.stderr.write(
      `${this.bold(colorize(this.useColor, "31", "Error"))}: ${message}\n`,
    );
  }

  private renderStatus(progress: ScanEvent["progress"]): void {
    if (this.quiet || !this.isTty) {
      return;
    }

    const spinner = this.color(
      "36",
      SPINNER_FRAMES[this.spinnerIndex % SPINNER_FRAMES.length] ?? "-",
    );
    this.spinnerIndex += 1;
    const text =
      `${spinner} ${this.bold(formatPhase(this.currentPhase))}: ${colorize(this.useColor, getStateColor(this.currentState), formatState(this.currentState))} ` +
      `| tested ${this.bold(`${progress.parametersSent}/${progress.totalParametersAmount}`)} ` +
      `| requests ${this.bold(String(progress.requestsSent))} ` +
      `| findings ${this.bold(String(progress.findingsCount))}`;

    const padded = text.padEnd(this.lastStatusLength, " ");
    process.stderr.write(`\r${padded}`);
    this.lastStatusLength = text.length;
  }

  private clearStatus(): void {
    if (!this.isTty || this.lastStatusLength === 0) {
      return;
    }

    process.stderr.write(`\r${" ".repeat(this.lastStatusLength)}\r`);
    this.lastStatusLength = 0;
  }

  private writeLine(message: string): void {
    this.clearStatus();
    process.stderr.write(`${message}\n`);
  }

  private writeFinding(finding: ScanSummary["findings"][number]): void {
    this.writeLine(
      `${this.bold(finding.parameter)} -> ${describeFindingForUser(finding)}`,
    );
    this.writeLine(
      `  ${this.muted(`${formatContext(finding.context)} | HTTP ${finding.responseStatus} | ${formatDuration(finding.responseTime)}`)}`,
    );
  }

  private label(text: string): string {
    return this.muted(`${`${text}:`.padEnd(12, " ")}`);
  }

  private muted(text: string): string {
    return colorize(this.useColor, "90", text);
  }

  private bold(text: string): string {
    return colorize(this.useColor, "1", text);
  }

  private color(code: string, text: string): string {
    return colorize(this.useColor, code, text);
  }
}

class JsonReporter implements Reporter {
  public start(_run: CliRunStart): void {}

  public handle(_event: ScanEvent): void {}

  public complete(result: CliRunResult): void {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }

  public error(message: string): void {
    process.stderr.write(`Error: ${message}\n`);
  }
}

class JsonStreamReporter implements Reporter {
  public start(_run: CliRunStart): void {}

  public handle(event: ScanEvent): void {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  }

  public complete(result: CliRunResult): void {
    process.stdout.write(`${JSON.stringify({ type: "result", result })}\n`);
  }

  public error(message: string): void {
    process.stderr.write(`Error: ${message}\n`);
  }
}

function shouldUseColor(isTty: boolean | undefined): boolean {
  if (process.env.NO_COLOR) {
    return false;
  }
  if (process.env.FORCE_COLOR === "0") {
    return false;
  }
  if (process.env.FORCE_COLOR) {
    return true;
  }
  return Boolean(isTty);
}

function colorize(enabled: boolean, code: string, text: string): string {
  if (!enabled) {
    return text;
  }
  return `\u001B[${code}m${text}${RESET}`;
}

function formatCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatDuration(durationMs: number): string {
  if (durationMs >= 1000) {
    return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
  }
  return `${durationMs}ms`;
}

function describeAttackType(attackType: AttackType): string {
  switch (attackType) {
    case "query":
      return "Query parameter discovery";
    case "body":
      return "Request body parameter discovery";
    case "headers":
      return "Header name discovery";
  }
}

function formatLevelBadge(level: LoggerLevel, useColor: boolean): string {
  switch (level) {
    case "debug":
      return colorize(useColor, "90", "[debug]");
    case "info":
      return colorize(useColor, "36", "[info]");
    case "warn":
      return colorize(useColor, "33", "[warn]");
    case "error":
      return colorize(useColor, "31", "[error]");
  }
}

function normalizeLogMessage(message: string): string {
  const tagged = message.match(/^\[([A-Z_]+)\]\s*(.+)$/u);
  if (!tagged) {
    return message;
  }

  const tag = tagged[1] ?? "info";
  const rest = tagged[2] ?? message;
  return `${toTitleCase(tag.replaceAll("_", " "))}: ${rest}`;
}

function describeFindingForUser(
  finding: ScanSummary["findings"][number],
): string {
  const reason = describeFindingReason(finding.anomalyType);
  return `${reason} (${finding.anomaly})`;
}

function describeFindingReason(
  anomalyType: ScanSummary["findings"][number]["anomalyType"],
): string {
  switch (anomalyType) {
    case "body":
      return "response body changed";
    case "headers":
      return "response headers changed";
    case "status-code":
      return "status code changed";
    case "redirect":
      return "redirect target changed";
    case "similarity":
      return "response became noticeably different";
    case "reflection_count":
      return "input reflection changed";
  }

  return "response changed unexpectedly";
}

function formatContext(context: RequestContext): string {
  switch (context) {
    case "learning":
      return "baseline";
    case "discovery":
      return "discovery";
    case "narrower":
      return "narrowing";
  }
}

function formatPhase(phase: EnginePhase): string {
  switch (phase) {
    case EnginePhase.Learning:
      return "Learning baseline";
    case EnginePhase.Discovery:
      return "Testing candidates";
    case EnginePhase.Idle:
      return "Preparing";
  }
}

function formatState(state: EngineState): string {
  switch (state) {
    case EngineState.Pending:
      return "queued";
    case EngineState.Learning:
      return "running";
    case EngineState.Running:
      return "running";
    case EngineState.Paused:
      return "paused";
    case EngineState.Completed:
      return "complete";
    case EngineState.Canceled:
      return "canceled";
    case EngineState.Timeout:
      return "timed out";
    case EngineState.Error:
      return "error";
  }
}

function getStateColor(state: EngineState): string {
  switch (state) {
    case EngineState.Completed:
      return "32";
    case EngineState.Paused:
    case EngineState.Timeout:
      return "33";
    case EngineState.Canceled:
    case EngineState.Error:
      return "31";
    default:
      return "36";
  }
}

function getOutcomeHeading(state: ScanSummary["state"]): string {
  switch (state) {
    case EngineState.Completed:
      return "Scan complete";
    case EngineState.Canceled:
      return "Scan canceled";
    case EngineState.Timeout:
      return "Scan timed out";
    case EngineState.Error:
      return "Scan failed";
    default:
      return "Scan finished";
  }
}

function getOutcomeColor(state: ScanSummary["state"]): string {
  switch (state) {
    case EngineState.Completed:
      return "32";
    case EngineState.Canceled:
      return "31";
    case EngineState.Timeout:
      return "33";
    case EngineState.Error:
      return "31";
    default:
      return "36";
  }
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
