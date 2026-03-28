import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTodoFromDomain: vi.fn(),
  getNextNodeClient: vi.fn(),
  listTodosFromDomain: vi.fn(),
  pushTodoSchema: vi.fn()
}));

vi.mock("@ezorm/next/node", () => ({
  getNextNodeClient: mocks.getNextNodeClient
}));

vi.mock("@ezorm/example-todo-domain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ezorm/example-todo-domain")>();

  return {
    ...actual,
    createTodo: mocks.createTodoFromDomain,
    listTodos: mocks.listTodosFromDomain,
    pushTodoSchema: mocks.pushTodoSchema
  };
});

import { TodoModel } from "@ezorm/example-todo-domain";
import { createTodo, listTodos } from "./todo-store";

describe("@ezorm/example-next-todo-web todo store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TODO_DATABASE_URL;
  });

  it("lists todos through a cached next node client", async () => {
    const rows = [{ id: "todo-1", title: "Drive ORM demo", completed: false }];
    const repository = { name: "repository" };
    const client = {
      repository: vi.fn(() => repository)
    };
    mocks.getNextNodeClient.mockResolvedValue(client);
    mocks.pushTodoSchema.mockResolvedValue(undefined);
    mocks.listTodosFromDomain.mockResolvedValue(rows);

    await expect(listTodos()).resolves.toEqual(rows);
    await expect(listTodos()).resolves.toEqual(rows);

    expect(mocks.getNextNodeClient).toHaveBeenCalledWith({
      cacheKey: "todo-demo:sqlite::memory:",
      connect: { databaseUrl: "sqlite::memory:" }
    });
    expect(mocks.pushTodoSchema).toHaveBeenCalledTimes(1);
    expect(mocks.pushTodoSchema).toHaveBeenCalledWith(client);
    expect(client.repository).toHaveBeenCalledTimes(2);
    expect(client.repository).toHaveBeenCalledWith(TodoModel);
    expect(mocks.listTodosFromDomain).toHaveBeenCalledTimes(2);
    expect(mocks.listTodosFromDomain).toHaveBeenCalledWith(repository);
  });

  it("creates todos through the shared todo-domain CRUD helpers", async () => {
    process.env.TODO_DATABASE_URL = "sqlite:///tmp/next-demo.db";
    const created = {
      id: "todo-1",
      title: "Drive ORM demo",
      completed: false
    };
    const repository = { name: "repository" };
    const client = {
      repository: vi.fn(() => repository)
    };
    mocks.getNextNodeClient.mockResolvedValue(client);
    mocks.pushTodoSchema.mockResolvedValue(undefined);
    mocks.createTodoFromDomain.mockResolvedValue({ todo: created });

    await expect(createTodo("Drive ORM demo")).resolves.toEqual({
      todo: created
    });

    expect(mocks.getNextNodeClient).toHaveBeenCalledWith({
      cacheKey: "todo-demo:sqlite:///tmp/next-demo.db",
      connect: { databaseUrl: "sqlite:///tmp/next-demo.db" }
    });
    expect(mocks.pushTodoSchema).toHaveBeenCalledTimes(1);
    expect(client.repository).toHaveBeenCalledWith(TodoModel);
    expect(mocks.createTodoFromDomain).toHaveBeenCalledWith(repository, {
      title: "Drive ORM demo"
    });
  });
});
