export type CliCommand =
  | ["migrate", "generate", string?]
  | ["migrate", "apply"]
  | ["migrate", "status"]
  | ["projector", "replay", string?]
  | ["projector", "reset", string?]
  | ["db", "pull"];

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
  if (scope === "projector" && action === "replay") {
    return ["projector", "replay", argument];
  }
  if (scope === "projector" && action === "reset") {
    return ["projector", "reset", argument];
  }
  if (scope === "db" && action === "pull") {
    return ["db", "pull"];
  }

  throw new Error(`Unknown command: ${argv.join(" ")}`);
}

export function runCli(argv: string[]): string {
  const command = parseCliCommand(argv);
  return `Queued ${command.join(" ")}`.trim();
}

if (process.argv[1]?.endsWith("index.ts")) {
  console.log(runCli(process.argv.slice(2)));
}
