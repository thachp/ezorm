import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface EnsureSqlModelProxyOptions {
  databaseUrl: string;
  host?: string;
  port?: number;
  startupTimeoutMs?: number;
  binaryPath?: string;
}

export interface SqlModelProxyHandle {
  endpoint: string;
  close(): Promise<void>;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const BINARY_PACKAGE_BY_TARGET: Record<string, string> = {
  "aarch64-apple-darwin": "@sqlmodel/proxy-bin-aarch64-apple-darwin",
  "x86_64-apple-darwin": "@sqlmodel/proxy-bin-x86_64-apple-darwin",
  "aarch64-unknown-linux-gnu": "@sqlmodel/proxy-bin-aarch64-unknown-linux-gnu",
  "x86_64-unknown-linux-gnu": "@sqlmodel/proxy-bin-x86_64-unknown-linux-gnu",
  "aarch64-pc-windows-msvc": "@sqlmodel/proxy-bin-aarch64-pc-windows-msvc",
  "x86_64-pc-windows-msvc": "@sqlmodel/proxy-bin-x86_64-pc-windows-msvc"
};

interface ManagedProxy {
  endpoint: string;
  close(): Promise<void>;
}

type ManagedProxyChildProcess = ReturnType<typeof spawn>;

const activeProxyPromises = new Map<string, Promise<ManagedProxy>>();
const activeChildren = new Set<ManagedProxyChildProcess>();
let shutdownHooksInstalled = false;

export async function ensureSqlModelProxy(
  options: EnsureSqlModelProxyOptions
): Promise<SqlModelProxyHandle> {
  const databaseUrl = options.databaseUrl.trim();
  if (!databaseUrl) {
    throw new Error("databaseUrl is required to start the sqlmodel proxy");
  }

  const host = options.host ?? DEFAULT_HOST;
  const key = JSON.stringify({
    binaryPath: options.binaryPath ?? null,
    databaseUrl,
    host,
    port: options.port ?? null
  });

  let managedPromise = activeProxyPromises.get(key);
  if (!managedPromise) {
    managedPromise = startManagedProxy(
      {
        ...options,
        databaseUrl,
        host
      },
      key
    );
    activeProxyPromises.set(key, managedPromise);
    managedPromise.catch(() => {
      if (activeProxyPromises.get(key) === managedPromise) {
        activeProxyPromises.delete(key);
      }
    });
  }

  const managed = await managedPromise;
  return {
    endpoint: managed.endpoint,
    close: () => managed.close()
  };
}

export function detectProxyTargetTriple(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch
): string {
  const supportedTargets: Record<string, string> = {
    "darwin:arm64": "aarch64-apple-darwin",
    "darwin:x64": "x86_64-apple-darwin",
    "linux:arm64": "aarch64-unknown-linux-gnu",
    "linux:x64": "x86_64-unknown-linux-gnu",
    "win32:arm64": "aarch64-pc-windows-msvc",
    "win32:x64": "x86_64-pc-windows-msvc"
  };
  const targetTriple = supportedTargets[`${platform}:${arch}`];

  if (!targetTriple) {
    throw new Error(`Unsupported proxy target for sqlmodel: ${platform}/${arch}.`);
  }

  return targetTriple;
}

export function resolvePackagedProxyBinary(
  binaryPath?: string,
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
  requireImpl: NodeRequire = createRequire(import.meta.url)
): string {
  if (binaryPath?.trim()) {
    return binaryPath;
  }

  let targetTriple: string;
  try {
    targetTriple = detectProxyTargetTriple(platform, arch);
  } catch (error) {
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        "Install a compatible prebuilt @sqlmodel/proxy-bin-* package or pass binaryPath."
      ].join(" ")
    );
  }

  const packageName = BINARY_PACKAGE_BY_TARGET[targetTriple];
  const executableName = platform === "win32" ? "sqlmodel_proxy.exe" : "sqlmodel_proxy";
  let lastError: unknown;

  try {
    const manifestPath = requireImpl.resolve(`${packageName}/package.json`);
    const candidate = resolve(dirname(manifestPath), "bin", executableName);
    if (existsSync(candidate)) {
      return candidate;
    }
    lastError = new Error(`Binary not found at ${candidate}`);
  } catch (error) {
    lastError = error;
  }

  for (const candidate of localDevelopmentCandidates(executableName)) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    [
      `Unable to resolve sqlmodel proxy binary for ${targetTriple}.`,
      `Install ${packageName} or pass binaryPath.`,
      lastError instanceof Error ? lastError.message : ""
    ]
      .filter(Boolean)
      .join(" ")
  );
}

async function startManagedProxy(
  options: EnsureSqlModelProxyOptions & Required<Pick<EnsureSqlModelProxyOptions, "databaseUrl" | "host">>,
  key: string
): Promise<ManagedProxy> {
  installShutdownHooks();

  const port = options.port ?? (await findFreePort(options.host));
  const endpoint = `http://${formatEndpointHost(normalizeEndpointHost(options.host))}:${port}`;
  const binaryPath = resolvePackagedProxyBinary(options.binaryPath);
  const child = spawn(binaryPath, [], {
    env: {
      ...process.env,
      DATABASE_URL: options.databaseUrl,
      HOST: options.host,
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  activeChildren.add(child);

  let output = "";
  let startupError: Error | undefined;
  const recordOutput = (chunk: string | Buffer) => {
    output = `${output}${chunk.toString()}`.slice(-4_000);
  };

  child.stdout.on("data", recordOutput);
  child.stderr.on("data", recordOutput);
  child.once("error", (error) => {
    startupError = error;
  });
  child.once("exit", () => {
    activeChildren.delete(child);
    if (activeProxyPromises.get(key)) {
      activeProxyPromises.delete(key);
    }
  });

  let closePromise: Promise<void> | undefined;
  const close = async () => {
    if (!closePromise) {
      closePromise = terminateChild(child).finally(() => {
        activeChildren.delete(child);
        if (activeProxyPromises.get(key)) {
          activeProxyPromises.delete(key);
        }
      });
    }
    return closePromise;
  };

  try {
    await waitForHealth(
      endpoint,
      options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      child,
      () => startupError,
      () => output
    );
  } catch (error) {
    await close();
    throw error;
  }

  return {
    endpoint,
    close
  };
}

function localDevelopmentCandidates(executableName: string): string[] {
  const here = dirname(fileURLToPath(import.meta.url));

  return [
    resolve(here, "../../../target/release", executableName),
    resolve(here, "../../../target/debug", executableName)
  ];
}

async function findFreePort(host: string): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to determine a free port for sqlmodel proxy"));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(address.port);
      });
    });
  });
}

async function waitForHealth(
  endpoint: string,
  timeoutMs: number,
  child: ManagedProxyChildProcess,
  getStartupError: () => Error | undefined,
  getOutput: () => string
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const startupError = getStartupError();
    if (startupError) {
      throw new Error(
        [
          "sqlmodel proxy failed to start.",
          startupError.message,
          formatOutput(getOutput())
        ]
          .filter(Boolean)
          .join(" ")
      );
    }

    if (child.exitCode !== null) {
      throw new Error(
        [
          "sqlmodel proxy exited before becoming healthy.",
          formatOutput(getOutput())
        ]
          .filter(Boolean)
          .join(" ")
      );
    }

    try {
      const response = await fetch(`${endpoint}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Poll until the process accepts requests or the timeout elapses.
    }

    await delay(50);
  }

  throw new Error(
    [
      `Timed out waiting for sqlmodel proxy healthcheck at ${endpoint}/healthz.`,
      formatOutput(getOutput())
    ]
      .filter(Boolean)
      .join(" ")
  );
}

async function terminateChild(child: ManagedProxyChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolveClose) => {
    const forceKillTimer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 3_000);

    child.once("exit", () => {
      clearTimeout(forceKillTimer);
      resolveClose();
    });

    child.kill("SIGTERM");
  });
}

function installShutdownHooks(): void {
  if (shutdownHooksInstalled) {
    return;
  }

  shutdownHooksInstalled = true;

  process.once("exit", () => {
    for (const child of activeChildren) {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
      }
    }
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void Promise.all([...activeChildren].map((child) => terminateChild(child))).finally(() => {
        process.kill(process.pid, signal);
      });
    });
  }
}

function normalizeEndpointHost(host: string): string {
  return host === "0.0.0.0" || host === "::" ? DEFAULT_HOST : host;
}

function formatEndpointHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function formatOutput(output: string): string {
  const trimmed = output.trim();
  return trimmed ? `Proxy output: ${trimmed}` : "";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}
