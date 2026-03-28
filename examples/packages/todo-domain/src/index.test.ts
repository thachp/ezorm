import { describe, expect, it } from "vitest";
import {
  TodoModel,
  createTodoDemoServices
} from "./index";

describe("@sqlmodel/example-todo-domain", () => {
  it("exposes a plain todo model for ORM usage", () => {
    expect(TodoModel.name).toBe("TodoModel");
  });

  it("persists and updates todo rows through the repository-backed services", async () => {
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
