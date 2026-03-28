import { describe, expect, it } from "vitest";
import {
  completeTodo,
  createTodo,
  createTodoDemoServices,
  listTodos,
  pushTodoSchema,
  reopenTodo,
  TodoModel
} from "./index";
import { createOrmClient } from "@ezorm/orm";

describe("@ezorm/example-todo-domain", () => {
  it("exposes a plain todo model for ORM usage", () => {
    expect(TodoModel.name).toBe("TodoModel");
  });

  it("persists and updates todo rows through the shared repository CRUD helpers", async () => {
    const client = await createOrmClient({ databaseUrl: "sqlite::memory:" });
    const repository = client.repository(TodoModel);

    await pushTodoSchema(client);

    const created = await createTodo(repository, { id: "todo-1", title: "Ship examples" });
    const completed = await completeTodo(repository, "todo-1");
    const reopened = await reopenTodo(repository, "todo-1");

    expect(created.todo).toMatchObject({ id: "todo-1", completed: false });
    expect(completed.todo).toMatchObject({ id: "todo-1", completed: true });
    expect(reopened.todo).toMatchObject({ id: "todo-1", completed: false });
    await expect(listTodos(repository)).resolves.toEqual([
      {
        id: "todo-1",
        title: "Ship examples",
        completed: false
      }
    ]);

    await client.close();
  });

  it("keeps the convenience services wrapper over the shared CRUD helpers", async () => {
    const services = await createTodoDemoServices();

    const created = await services.createTodo({ id: "todo-1", title: "Ship examples" });
    const completed = await services.completeTodo("todo-1");

    expect(created.todo).toMatchObject({ id: "todo-1", completed: false });
    expect(completed.todo).toMatchObject({ id: "todo-1", completed: true });
    await expect(services.listTodos()).resolves.toEqual([
      {
        id: "todo-1",
        title: "Ship examples",
        completed: true
      }
    ]);
    await services.close();
  });
});
