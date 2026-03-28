import { Inject, Injectable, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrmClient, Repository } from "@ezorm/orm";

const mocks = vi.hoisted(() => ({
  createNodeRuntime: vi.fn()
}));

vi.mock("@ezorm/runtime-node", () => ({
  createNodeRuntime: mocks.createNodeRuntime
}));

import {
  EZORM_CLIENT,
  EzormModule,
  InjectEzormClient,
  InjectEzormRepository,
  getEzormRepositoryToken
} from "./index";

class TodoModel {
  id!: string;
}

@Injectable()
class RepositoryConsumer {
  constructor(
    @InjectEzormClient() readonly client: OrmClient,
    @InjectEzormRepository(TodoModel) readonly repository: Repository<{ id: string }>
  ) {}
}

@Injectable()
class TokenConsumer {
  constructor(
    @Inject(EZORM_CLIENT) readonly client: OrmClient,
    @Inject(getEzormRepositoryToken(TodoModel))
    readonly repository: Repository<{ id: string }>
  ) {}
}

describe("@ezorm/nestjs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses an externally supplied client with forRoot", async () => {
    const repository = { kind: "external-repository" } as unknown as Repository<{ id: string }>;
    const client = createFakeClient(repository);

    @Module({
      imports: [EzormModule.forRoot({ client }), EzormModule.forFeature([TodoModel])],
      providers: [RepositoryConsumer]
    })
    class TestModule {}

    const app = await NestFactory.createApplicationContext(TestModule, { logger: false });

    try {
      const consumer = app.get(RepositoryConsumer);
      expect(consumer.client).toBe(client);
      expect(consumer.repository).toBe(repository);
      expect(mocks.createNodeRuntime).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }

    expect(client.close).not.toHaveBeenCalled();
  });

  it("creates a client through createNodeRuntime when connect options are supplied", async () => {
    const repository = { kind: "connected-repository" } as unknown as Repository<{ id: string }>;
    const client = createFakeClient(repository);
    mocks.createNodeRuntime.mockResolvedValue(client);

    @Module({
      imports: [
        EzormModule.forRoot({
          connect: { databaseUrl: "sqlite::memory:" }
        }),
        EzormModule.forFeature([TodoModel])
      ],
      providers: [RepositoryConsumer]
    })
    class TestModule {}

    const app = await NestFactory.createApplicationContext(TestModule, { logger: false });

    try {
      const consumer = app.get(RepositoryConsumer);
      expect(consumer.client).toBe(client);
      expect(consumer.repository).toBe(repository);
      expect(mocks.createNodeRuntime).toHaveBeenCalledWith({
        connect: { databaseUrl: "sqlite::memory:" }
      });
    } finally {
      await app.close();
    }

    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it("supports forRootAsync factories", async () => {
    const repository = { kind: "async-repository" } as unknown as Repository<{ id: string }>;
    const client = createFakeClient(repository);

    @Module({
      imports: [
        EzormModule.forRootAsync({
          useFactory: async () => ({ client })
        }),
        EzormModule.forFeature([TodoModel])
      ],
      providers: [RepositoryConsumer]
    })
    class TestModule {}

    const app = await NestFactory.createApplicationContext(TestModule, { logger: false });

    try {
      const consumer = app.get(RepositoryConsumer);
      expect(consumer.client).toBe(client);
      expect(consumer.repository).toBe(repository);
    } finally {
      await app.close();
    }
  });

  it("resolves repository providers through the exported repository token helper", async () => {
    const repository = { kind: "token-repository" } as unknown as Repository<{ id: string }>;
    const client = createFakeClient(repository);

    @Module({
      imports: [EzormModule.forRoot({ client }), EzormModule.forFeature([TodoModel])],
      providers: [TokenConsumer]
    })
    class TestModule {}

    const app = await NestFactory.createApplicationContext(TestModule, { logger: false });

    try {
      const consumer = app.get(TokenConsumer);
      expect(consumer.client).toBe(client);
      expect(consumer.repository).toBe(repository);
    } finally {
      await app.close();
    }
  });
});

function createFakeClient(repository: Repository<{ id: string }>): OrmClient {
  return {
    repository: vi.fn(() => repository),
    query: vi.fn(),
    load: vi.fn(),
    loadMany: vi.fn(),
    pushSchema: vi.fn(),
    pullSchema: vi.fn(),
    close: vi.fn(async () => undefined)
  } as unknown as OrmClient;
}
