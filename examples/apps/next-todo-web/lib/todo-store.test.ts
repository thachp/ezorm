import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getNextNodeClient: vi.fn()
}));

vi.mock("@ezorm/next/node", () => ({
  getNextNodeClient: mocks.getNextNodeClient
}));

import { TodoModel } from "@ezorm/example-todo-domain";
import { createTodo, listTodos } from "./todo-store";

describe("@ezorm/example-next-todo-web todo store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TODO_DATABASE_URL;
  });

  it("lists todos through a cached next node client", async () => {
    const rows = [{ id: "todo-1", title: "Drive ORM demo", completed: false }];
    const repository = {
      findMany: vi.fn(async () => rows)
    };
    const client = {
      pushSchema: vi.fn(async () => ({ statements: [] })),
      repository: vi.fn(() => repository)
    };
    mocks.getNextNodeClient.mockResolvedValue(client);

    await expect(listTodos()).resolves.toEqual(rows);

    expect(mocks.getNextNodeClient).toHaveBeenCalledWith({
      cacheKey: "todo-demo:sqlite::memory:",
      connect: { databaseUrl: "sqlite::memory:" }
    });
    expect(client.pushSchema).toHaveBeenCalledWith([TodoModel]);
    expect(client.repository).toHaveBeenCalledWith(TodoModel);
    expect(repository.findMany).toHaveBeenCalledWith({
      orderBy: { field: "title", direction: "asc" }
    });
  });

  it("creates todos through the repository returned by @ezorm/next/node", async () => {
    process.env.TODO_DATABASE_URL = "sqlite:///tmp/next-demo.db";
    const created = {
      id: "todo-1",
      title: "Drive ORM demo",
      completed: false
    };
    const repository = {
      create: vi.fn(async () => created)
    };
    const client = {
      pushSchema: vi.fn(async () => ({ statements: [] })),
      repository: vi.fn(() => repository)
    };
    mocks.getNextNodeClient.mockResolvedValue(client);

    await expect(createTodo("Drive ORM demo")).resolves.toEqual({
      todo: created
    });

    expect(mocks.getNextNodeClient).toHaveBeenCalledWith({
      cacheKey: "todo-demo:sqlite:///tmp/next-demo.db",
      connect: { databaseUrl: "sqlite:///tmp/next-demo.db" }
    });
    expect(repository.create).toHaveBeenCalledWith({
      id: expect.any(String),
      title: "Drive ORM demo",
      completed: false
    });
  });
});
