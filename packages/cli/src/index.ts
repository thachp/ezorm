import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type CliCommand =
  | ["migrate", "generate", string?]
  | ["migrate", "apply"]
  | ["migrate", "status"]
  | ["db", "pull"]
  | ["db", "push"];

const HELP_TEXT = [
  "Usage:",
  "  ezorm migrate generate [name]",
  "  ezorm migrate apply",
  "  ezorm migrate status",
  "  ezorm db pull",
  "  ezorm db push"
].join("\n");

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
  if (scope === "db" && action === "pull") {
    return ["db", "pull"];
  }
  if (scope === "db" && action === "push") {
    return ["db", "push"];
  }

  throw new Error(`Unknown command: ${argv.join(" ")}`);
}

export function runCli(argv: string[]): string {
  const command = parseCliCommand(argv);
  return `Queued ${command.join(" ")}`.trim();
}

export function formatCliHelp(): string {
  return HELP_TEXT;
}

export function main(
  argv: string[] = process.argv.slice(2),
  io: Pick<Console, "log" | "error"> = console
): number {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    io.log(formatCliHelp());
    return 0;
  }

  try {
    io.log(runCli(argv));
    return 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    io.error("");
    io.error(formatCliHelp());
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
  process.exitCode = main();
}
