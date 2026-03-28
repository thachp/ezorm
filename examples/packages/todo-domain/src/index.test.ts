import { describe, expect, it } from "vitest";
import {
  TodoAggregate,
  createTodoDemoServices
} from "./index";

describe("@sqlmodel/example-todo-domain", () => {
  it("rehydrates aggregate state from history", () => {
    const aggregate = new TodoAggregate();

    aggregate.create("todo-1", "Write docs");
    aggregate.commit(1);
    aggregate.complete();
    aggregate.commit(2);
    aggregate.reopen();
    aggregate.commit(3);

    expect(aggregate.toListItem()).toEqual({
      id: "todo-1",
      title: "Write docs",
      completed: false,
      version: 3
    });
  });

  it("updates the projection from command writes", async () => {
    const services = await createTodoDemoServices();

    const created = await services.createTodo({ id: "todo-1", title: "Ship examples" });
    const completed = await services.completeTodo("todo-1");

    expect(created.todo).toMatchObject({ id: "todo-1", completed: false, version: 1 });
    expect(completed.todo).toMatchObject({ id: "todo-1", completed: true, version: 2 });
    await expect(services.listTodos()).resolves.toEqual([
      {
        id: "todo-1",
        title: "Ship examples",
        completed: true,
        version: 2
      }
    ]);
  });

  it("rebuilds the read model from stored events", async () => {
    const services = await createTodoDemoServices();

    await services.createTodo({ id: "todo-1", title: "Write guide" });
    await services.completeTodo("todo-1");
    await services.readModelStore.reset();

    await expect(services.listTodos()).resolves.toEqual([]);

    const checkpoint = await services.rebuildTodosProjection();

    expect(checkpoint.lastSequence).toBe(2);
    await expect(services.listTodos()).resolves.toEqual([
      {
        id: "todo-1",
        title: "Write guide",
        completed: true,
        version: 2
      }
    ]);
  });
});
