import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeTodoFromDomain: vi.fn(),
  createTodoFromDomain: vi.fn(),
  listTodosFromDomain: vi.fn(),
  pushTodoSchema: vi.fn(),
  reopenTodoFromDomain: vi.fn()
}));

vi.mock("@ezorm/example-todo-domain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ezorm/example-todo-domain")>();

  return {
    ...actual,
    completeTodo: mocks.completeTodoFromDomain,
    createTodo: mocks.createTodoFromDomain,
    listTodos: mocks.listTodosFromDomain,
    pushTodoSchema: mocks.pushTodoSchema,
    reopenTodo: mocks.reopenTodoFromDomain
  };
});

import type { OrmClient, Repository } from "@ezorm/orm";
import type { TodoRecord } from "@ezorm/example-todo-domain";
import { TodosService } from "./todos.service";

describe("@ezorm/example-nest-todo-api TodosService", () => {
  let client: OrmClient;
  let repository: Repository<TodoRecord>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = {} as OrmClient;
    repository = {} as Repository<TodoRecord>;
  });

  it("pushes schema through the shared todo-domain helper on startup", async () => {
    mocks.pushTodoSchema.mockResolvedValue(undefined);

    const service = new TodosService(client, repository);
    await service.onModuleInit();

    expect(mocks.pushTodoSchema).toHaveBeenCalledWith(client);
  });

  it("delegates repository CRUD behavior to the shared todo-domain helpers", async () => {
    const rows = [{ id: "todo-1", title: "Drive ORM demo", completed: false }];
    const created = { todo: rows[0] };
    const completed = { todo: { ...rows[0], completed: true } };
    const reopened = { todo: rows[0] };

    mocks.listTodosFromDomain.mockResolvedValue(rows);
    mocks.createTodoFromDomain.mockResolvedValue(created);
    mocks.completeTodoFromDomain.mockResolvedValue(completed);
    mocks.reopenTodoFromDomain.mockResolvedValue(reopened);

    const service = new TodosService(client, repository);

    await expect(service.listTodos()).resolves.toEqual(rows);
    await expect(service.createTodo({ title: "Drive ORM demo" })).resolves.toEqual(created);
    await expect(service.completeTodo("todo-1")).resolves.toEqual(completed);
    await expect(service.reopenTodo("todo-1")).resolves.toEqual(reopened);

    expect(mocks.listTodosFromDomain).toHaveBeenCalledWith(repository);
    expect(mocks.createTodoFromDomain).toHaveBeenCalledWith(repository, {
      title: "Drive ORM demo"
    });
    expect(mocks.completeTodoFromDomain).toHaveBeenCalledWith(repository, "todo-1");
    expect(mocks.reopenTodoFromDomain).toHaveBeenCalledWith(repository, "todo-1");
  });
});
