import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: (...args: unknown[]) => spawnMock(...args)
  };
});

import { ensureEzormProxy, resolvePackagedProxyBinary } from "./index";

class FakeChildProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  exitCode: number | null = null;
  killed = false;
  readonly pid = 42;

  kill = vi.fn((signal: NodeJS.Signals = "SIGTERM") => {
    this.killed = true;
    this.exitCode = signal === "SIGKILL" ? 137 : 0;
    queueMicrotask(() => {
      this.emit("exit", this.exitCode, signal);
    });
    return true;
  });
}

describe("@ezorm/proxy-node", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails fast when databaseUrl is empty", async () => {
    await expect(
      ensureEzormProxy({
        databaseUrl: "   ",
        binaryPath: "/tmp/ezorm_proxy"
      })
    ).rejects.toThrow("databaseUrl is required");
  });

  it("reuses a running proxy for the same config", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true
      })
    );

    const first = await ensureEzormProxy({
      databaseUrl: "sqlite://managed-proxy-reuse.db",
      port: 4510,
      binaryPath: "/tmp/ezorm_proxy"
    });
    const second = await ensureEzormProxy({
      databaseUrl: "sqlite://managed-proxy-reuse.db",
      port: 4510,
      binaryPath: "/tmp/ezorm_proxy"
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(second.endpoint).toBe(first.endpoint);

    await first.close();
    await second.close();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("passes explicit host and port through to the child process", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true
      })
    );

    const handle = await ensureEzormProxy({
      databaseUrl: "sqlite://managed-proxy-explicit.db",
      host: "0.0.0.0",
      port: 4610,
      binaryPath: "/tmp/ezorm_proxy"
    });

    const [, , spawnOptions] = spawnMock.mock.calls[0] as [string, string[], { env: Record<string, string> }];
    expect(handle.endpoint).toBe("http://127.0.0.1:4610");
    expect(spawnOptions.env.DATABASE_URL).toBe("sqlite://managed-proxy-explicit.db");
    expect(spawnOptions.env.HOST).toBe("0.0.0.0");
    expect(spawnOptions.env.PORT).toBe("4610");

    await handle.close();
  });

  it("forwards pool settings through environment variables", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true
      })
    );

    const handle = await ensureEzormProxy({
      databaseUrl: "postgres://localhost/ezorm",
      port: 4620,
      binaryPath: "/tmp/ezorm_proxy",
      pool: {
        minConnections: 1,
        maxConnections: 8,
        acquireTimeoutMs: 5000,
        idleTimeoutMs: 10000
      }
    });

    const [, , spawnOptions] = spawnMock.mock.calls[0] as [string, string[], { env: Record<string, string> }];
    expect(spawnOptions.env.EZORM_POOL_MIN_CONNECTIONS).toBe("1");
    expect(spawnOptions.env.EZORM_POOL_MAX_CONNECTIONS).toBe("8");
    expect(spawnOptions.env.EZORM_POOL_ACQUIRE_TIMEOUT_MS).toBe("5000");
    expect(spawnOptions.env.EZORM_POOL_IDLE_TIMEOUT_MS).toBe("10000");

    await handle.close();
  });

  it("passes mssql connection urls through unchanged", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true
      })
    );

    const handle = await ensureEzormProxy({
      databaseUrl: "sqlserver://user:pass@db.example.com/app?encrypt=true&trustServerCertificate=false",
      port: 4630,
      binaryPath: "/tmp/ezorm_proxy"
    });

    const [, , spawnOptions] = spawnMock.mock.calls[0] as [string, string[], { env: Record<string, string> }];
    expect(spawnOptions.env.DATABASE_URL).toBe(
      "sqlserver://user:pass@db.example.com/app?encrypt=true&trustServerCertificate=false"
    );

    await handle.close();
  });

  it("times out cleanly when the proxy never becomes healthy", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connection refused"))
    );

    await expect(
      ensureEzormProxy({
        databaseUrl: "sqlite://managed-proxy-timeout.db",
        port: 4710,
        startupTimeoutMs: 50,
        binaryPath: "/tmp/ezorm_proxy"
      })
    ).rejects.toThrow("Timed out waiting for ezorm proxy healthcheck");

    expect(child.kill).toHaveBeenCalled();
  });

  it("surfaces unsupported platforms with install guidance", () => {
    expect(() =>
      resolvePackagedProxyBinary(undefined, "freebsd", "x64", {
        resolve: () => ""
      } as unknown as NodeRequire)
    ).toThrow("Install a compatible prebuilt @ezorm/proxy-bin-* package or pass binaryPath.");
  });

  it("resolves a packaged binary through optional dependency metadata", () => {
    const packageRoot = mkdtempSync(resolve(tmpdir(), "ezorm-proxy-bin-"));
    const packageJsonPath = resolve(packageRoot, "package.json");
    const binaryDir = resolve(packageRoot, "bin");
    const binaryPath = resolve(binaryDir, "ezorm_proxy");

    mkdirSync(binaryDir, { recursive: true });
    writeFileSync(packageJsonPath, JSON.stringify({ name: "@ezorm/proxy-bin-aarch64-apple-darwin" }));
    writeFileSync(binaryPath, "binary");

    expect(
      resolvePackagedProxyBinary(undefined, "darwin", "arm64", {
        resolve: () => packageJsonPath
      } as unknown as NodeRequire)
    ).toBe(binaryPath);
  });
});
