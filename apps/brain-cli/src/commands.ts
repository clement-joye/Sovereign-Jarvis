export interface ControlApiRequestOptions {
  method?: string;
  body?: unknown;
}

export type ControlApiRequest = (
  path: string,
  options?: ControlApiRequestOptions
) => Promise<unknown>;

export interface CommandDependencies {
  request: ControlApiRequest;
  now?: () => number;
}

interface CommandHandler {
  matches(argv: string[]): boolean;
  execute(
    argv: string[],
    dependencies: Required<CommandDependencies>
  ): Promise<Record<string, unknown>>;
}

const usage =
  "brainctl status|health|jobs list|dead-letter list|schedules list|schedules show <id>|schedules run <id>|schedules disable <id> [version]|sessions list|sessions close <id>|workspaces list|workspaces show <id>|retention run [--dry-run]";

const commands: CommandHandler[] = [
  simpleCommand(([group]) => !group || group === "status", "status", "/v1/admin/status"),
  simpleCommand(([group]) => group === "health", "health", "/health"),
  simpleCommand(matches("jobs", "list"), "jobs list", "/v1/jobs"),
  simpleCommand(matches("dead-letter", "list"), "dead-letter list", "/v1/admin/dead-letter"),
  simpleCommand(matches("schedules", "list"), "schedules list", "/v1/schedules"),
  parameterizedCommand(
    matches("schedules", "show"),
    "schedules show",
    (value) => `/v1/schedules/${value}`
  ),
  parameterizedCommand(matches("schedules", "run"), "schedules run", (value, dependencies) => ({
    path: `/v1/schedules/${value}/run`,
    options: { method: "POST", body: { requestId: `brainctl-${dependencies.now()}` } }
  })),
  parameterizedCommand(
    matches("schedules", "disable"),
    "schedules disable",
    (value, dependencies, argv) => ({
      path: `/v1/schedules/${value}/disable`,
      options: { method: "POST", body: { expectedVersion: Number(argv[3] ?? "1") } }
    })
  ),
  simpleCommand(matches("sessions", "list"), "sessions list", "/v1/sessions"),
  parameterizedCommand(matches("sessions", "close"), "sessions close", (value) => ({
    path: `/v1/sessions/${value}/close`,
    options: { method: "POST" }
  })),
  {
    matches: ([group, subcommand]) =>
      group === "workspaces" && (subcommand === undefined || subcommand === "list"),
    async execute(argv, dependencies) {
      const statusFlag = argv.find((arg) => arg.startsWith("--status="));
      const status = statusFlag ? statusFlag.slice("--status=".length) : undefined;
      const path = status
        ? `/v1/workspaces?status=${encodeURIComponent(status)}`
        : "/v1/workspaces";
      return success("workspaces list", await dependencies.request(path));
    }
  },
  parameterizedCommand(
    matches("workspaces", "show"),
    "workspaces show",
    (value) => `/v1/workspaces/${value}`
  ),
  {
    matches: ([group, command]) => group === "retention" && command === "run",
    async execute(argv, dependencies) {
      return success(
        "retention run",
        await dependencies.request("/v1/admin/retention/run", {
          method: "POST",
          body: { dryRun: argv.includes("--dry-run"), limit: 100 }
        })
      );
    }
  }
];

export async function dispatchCliCommand(
  argv: string[],
  dependencies: CommandDependencies
): Promise<Record<string, unknown>> {
  const handler = commands.find((command) => command.matches(argv));
  if (handler === undefined) {
    return { command: argv.join(" "), status: "invalid", usage };
  }
  return handler.execute(argv, { ...dependencies, now: dependencies.now ?? Date.now });
}

function matches(group: string, command: string): (argv: string[]) => boolean {
  return ([actualGroup, actualCommand]) => actualGroup === group && actualCommand === command;
}

function simpleCommand(
  matchesCommand: (argv: string[]) => boolean,
  command: string,
  path: string
): CommandHandler {
  return {
    matches: matchesCommand,
    async execute(_argv, dependencies) {
      return success(command, await dependencies.request(path));
    }
  };
}

function parameterizedCommand(
  matchesCommand: (argv: string[]) => boolean,
  command: string,
  requestFor: (
    value: string,
    dependencies: Required<CommandDependencies>,
    argv: string[]
  ) => string | { path: string; options: ControlApiRequestOptions }
): CommandHandler {
  return {
    matches: (argv) => matchesCommand(argv) && argv[2] !== undefined,
    async execute(argv, dependencies) {
      const request = requestFor(argv[2]!, dependencies, argv);
      const { path, options } = typeof request === "string" ? { path: request } : request;
      return success(command, await dependencies.request(path, options));
    }
  };
}

function success(command: string, result: unknown): Record<string, unknown> {
  return { command, status: "ok", result };
}
