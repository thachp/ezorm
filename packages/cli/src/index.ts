import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executeCliCommand } from "./workflow.js";

export interface EzormCliConfig {
  databaseUrl: string;
  models: Function[];
  migrationsDir?: string;
}

export type CliCommand =
  | ["migrate", "generate", string?]
  | ["migrate", "apply"]
  | ["migrate", "status"]
  | ["migrate", "resolve", "applied" | "rolled-back", string]
  | ["db", "pull"]
  | ["db", "push"];

const HELP_TEXT = [
  "Usage:",
  "  ezorm migrate generate [name]",
  "  ezorm migrate apply",
  "  ezorm migrate status",
  "  ezorm migrate resolve --applied <filename>",
  "  ezorm migrate resolve --rolled-back <filename>",
  "  ezorm db pull",
  "  ezorm db push"
].join("\n");

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function parseCliCommand(argv: string[]): CliCommand {
  const [scope, action, argument] = argv;

  if (scope === "migrate" && action === "generate") {
    return ["migrate", "generate", argument];
  }
  if (scope === "migrate" && action === "apply") {
    return ["migrate", "apply"];
  }
  if (scope === "migrate" && action === "status") {
    return ["migrate", "status"];
  }
  if (scope === "migrate" && action === "resolve") {
    const [flag, filename] = argv.slice(2);
    if (flag === "--applied" && filename) {
      return ["migrate", "resolve", "applied", filename];
    }
    if (flag === "--rolled-back" && filename) {
      return ["migrate", "resolve", "rolled-back", filename];
    }
    throw new CliUsageError("Resolve requires either --applied <filename> or --rolled-back <filename>");
  }
  if (scope === "db" && action === "pull") {
    return ["db", "pull"];
  }
  if (scope === "db" && action === "push") {
    return ["db", "push"];
  }

  throw new CliUsageError(`Unknown command: ${argv.join(" ")}`);
}

export async function runCli(
  argv: string[],
  io: Pick<Console, "log" | "error"> = console,
  options?: { cwd?: string }
): Promise<void> {
  const command = parseCliCommand(argv);
  await executeCliCommand(command, io, options);
}

export function formatCliHelp(): string {
  return HELP_TEXT;
}

export async function main(
  argv: string[] = process.argv.slice(2),
  io: Pick<Console, "log" | "error"> = console,
  options?: { cwd?: string }
): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    io.log(formatCliHelp());
    return 0;
  }

  try {
    await runCli(argv, io, options);
    return 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    if (error instanceof CliUsageError) {
      io.error("");
      io.error(formatCliHelp());
    }
    return 1;
  }
}

function isDirectExecution(executedPath?: string): boolean {
  if (!executedPath) {
    return false;
  }

  return resolve(executedPath) === fileURLToPath(import.meta.url);
}

if (isDirectExecution(process.argv[1])) {
  main().then((code) => {
    process.exitCode = code;
  });
}
