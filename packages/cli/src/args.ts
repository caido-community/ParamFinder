import {
  AnomalyType,
  type AttackType,
  type ParameterValueType,
} from "@paramfinder/engine";
import {
  Command,
  CommanderError,
  InvalidArgumentError,
  Option,
} from "commander";

export type OutputMode = "human" | "json" | "json-stream";

export interface CliOptions {
  url: string;
  method?: string;
  headers: string[];
  attackType?: AttackType;
  data?: string;
  jsonBody?: string;
  jsonPath?: string;
  wordlistPath?: string;
  words: string[];
  useDefaultWords: boolean;
  delayMs?: number;
  timeoutMs?: number;
  maxParametersAmount?: number;
  learnRequestsCount: number;
  autoDetectMaxSize: boolean;
  maxQuerySize?: number;
  maxBodySize?: number;
  maxHeaderSize?: number;
  updateContentLength?: boolean;
  addCacheBusterParameter: boolean;
  wafDetection: boolean;
  additionalChecks: boolean;
  autopilotEnabled: boolean;
  customValue?: string;
  customValueType: ParameterValueType;
  ignoreAnomalyTypes: AnomalyType[];
  outputMode: OutputMode;
  quiet: boolean;
  verbose: boolean;
  help: boolean;
}

interface ParsedCliFlags {
  method?: string;
  header?: string[];
  attack?: AttackType;
  data?: string;
  jsonBody?: string;
  jsonPath?: string;
  wordlist?: string;
  word?: string[];
  defaultWords?: boolean;
  delay?: number;
  timeout?: number;
  maxParams?: number;
  learnRequests?: number;
  autoDetectMaxSize?: boolean;
  maxQuerySize?: number;
  maxBodySize?: number;
  maxHeaderSize?: number;
  updateContentLength?: boolean;
  cacheBuster?: boolean;
  wafDetection?: boolean;
  additionalChecks?: boolean;
  autopilot?: boolean;
  customValue?: string;
  customValueType?: ParameterValueType;
  ignoreAnomaly?: AnomalyType[];
  json?: boolean;
  jsonStream?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  help?: boolean;
}

const ATTACK_TYPES = ["query", "body", "headers"] as const;
const PARAMETER_VALUE_TYPES = ["string", "integer"] as const;
const ANOMALY_TYPES = Object.values(AnomalyType);

export function parseCliArgs(argv: string[]): CliOptions {
  const command = createCliCommand();
  try {
    command.parse(argv, { from: "user" });
  } catch (error) {
    throw normalizeParseError(error);
  }

  const flags = command.opts<ParsedCliFlags>();
  const [url] = command.processedArgs as [string?];
  if (flags.data && flags.jsonBody) {
    throw new Error("Use either --data or --json-body, not both");
  }
  if (!url && !flags.help) {
    throw new Error("A target URL is required");
  }
  if (flags.customValue && flags.customValueType === "integer") {
    throw new Error(
      "Use either --custom-value or --custom-value-type integer, not both",
    );
  }

  return {
    url: url ?? "",
    method: flags.method,
    headers: flags.header ?? [],
    attackType: flags.attack,
    data: flags.data,
    jsonBody: flags.jsonBody,
    jsonPath: flags.jsonPath,
    wordlistPath: flags.wordlist,
    words: flags.word ?? [],
    useDefaultWords: flags.defaultWords ?? true,
    delayMs: flags.delay,
    timeoutMs: flags.timeout,
    maxParametersAmount: flags.maxParams,
    learnRequestsCount: flags.learnRequests ?? 6,
    autoDetectMaxSize: flags.autoDetectMaxSize ?? true,
    maxQuerySize: flags.maxQuerySize,
    maxBodySize: flags.maxBodySize,
    maxHeaderSize: flags.maxHeaderSize,
    updateContentLength: flags.updateContentLength,
    addCacheBusterParameter: flags.cacheBuster ?? true,
    wafDetection: flags.wafDetection ?? true,
    additionalChecks: flags.additionalChecks ?? true,
    autopilotEnabled: flags.autopilot ?? true,
    customValue: flags.customValue,
    customValueType: flags.customValueType ?? "string",
    ignoreAnomalyTypes: flags.ignoreAnomaly ?? [],
    outputMode: resolveOutputMode(flags.json, flags.jsonStream),
    quiet: flags.quiet ?? false,
    verbose: flags.verbose ?? false,
    help: flags.help ?? false,
  };
}

export function getCliHelpText(): string {
  return createCliCommand().helpInformation();
}

function createCliCommand(): Command {
  return new Command()
    .name("paramfinder")
    .description(
      "Discover likely HTTP parameters by comparing responses to crafted requests.",
    )
    .usage("<url> [options]")
    .helpOption(false)
    .argument("[url]", "Target URL to scan")
    .option("-X, --method <method>", "HTTP method to send")
    .option("-H, --header <header>", "Add a request header", collectValues)
    .addOption(
      new Option("--attack <type>", "Where to inject candidate names").choices([
        ...ATTACK_TYPES,
      ]),
    )
    .option("-d, --data <body>", "Send a URL-encoded body")
    .option("--json-body <json>", "Send a JSON body")
    .option("--json-path <path>", "JSON path used for injected body fields")
    .option("--wordlist <path>", "Load candidate names from a file")
    .option("--word <value>", "Add one candidate name", collectValues)
    .option("--no-default-words", "Skip the bundled candidate names")
    .option("--auto-detect-max-size", "Auto-detect request size budget")
    .option("--no-auto-detect-max-size", "Disable size auto-detection")
    .option(
      "--cache-buster",
      "Enable cache-buster query parameters for header attacks",
    )
    .option(
      "--no-cache-buster",
      "Disable cache-buster query parameters for header attacks",
    )
    .option("--waf-detection", "Probe for WAF-style interference")
    .option("--no-waf-detection", "Disable WAF detection")
    .option("--additional-checks", "Run special-character handling checks")
    .option("--no-additional-checks", "Skip special-character handling checks")
    .option("--autopilot", "Auto-adjust query size after 414 responses")
    .option("--no-autopilot", "Disable query autopilot")
    .option(
      "--update-content-length",
      "Force Content-Length updates during body attacks",
    )
    .option(
      "--no-update-content-length",
      "Disable Content-Length updates during body attacks",
    )
    .option("--delay <ms>", "Wait between requests", (value) =>
      parseIntegerArg(value, "--delay"),
    )
    .option("--timeout <ms>", "Stop the scan after this long", (value) =>
      parseIntegerArg(value, "--timeout"),
    )
    .option(
      "--max-params <count>",
      "Cap candidates per discovery request",
      (value) => parseIntegerArg(value, "--max-params"),
    )
    .option(
      "--learn-requests <count>",
      "Baseline requests to sample first",
      (value) => parseIntegerArg(value, "--learn-requests"),
    )
    .option(
      "--max-query-size <count>",
      "Set a query-string size budget",
      (value) => parseIntegerArg(value, "--max-query-size"),
    )
    .option(
      "--max-body-size <count>",
      "Set a request body size budget",
      (value) => parseIntegerArg(value, "--max-body-size"),
    )
    .option("--max-header-size <count>", "Set a header count budget", (value) =>
      parseIntegerArg(value, "--max-header-size"),
    )
    .option("--custom-value <prefix>", "Prefix generated parameter values")
    .addOption(
      new Option(
        "--custom-value-type <type>",
        "Generate values as strings or integers",
      ).choices([...PARAMETER_VALUE_TYPES]),
    )
    .option(
      "--ignore-anomaly <type>",
      "Ignore one anomaly type",
      parseAnomalyType,
    )
    .option("--json", "Print one final JSON object")
    .option("--json-stream", "Stream NDJSON events plus final result")
    .option("--quiet", "Hide non-essential human output")
    .option("--verbose", "Include debug log events")
    .option("-h, --help", "Show this help text")
    .exitOverride();
}

function collectValues(value: string, previous?: string[]): string[] {
  return [...(previous ?? []), value];
}

function parseAnomalyType(
  value: string,
  previous?: AnomalyType[],
): AnomalyType[] {
  if (!ANOMALY_TYPES.includes(value as AnomalyType)) {
    throw new InvalidArgumentError(`Unsupported anomaly type: ${value}`);
  }

  return [...(previous ?? []), value as AnomalyType];
}

function parseIntegerArg(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new InvalidArgumentError(
      `Expected an integer for ${flagName}, received: ${value}`,
    );
  }

  return parsed;
}

function resolveOutputMode(json?: boolean, jsonStream?: boolean): OutputMode {
  if (json && jsonStream) {
    throw new Error("Use either --json or --json-stream, not both");
  }
  if (jsonStream) {
    return "json-stream";
  }
  if (json) {
    return "json";
  }

  return "human";
}

function normalizeParseError(error: unknown): Error {
  if (error instanceof CommanderError) {
    return new Error(stripCommanderPrefix(error.message), { cause: error });
  }
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

function stripCommanderPrefix(message: string): string {
  return message.startsWith("error: ")
    ? message.slice("error: ".length)
    : message;
}
