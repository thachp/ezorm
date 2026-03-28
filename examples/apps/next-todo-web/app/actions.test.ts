import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeTodo: vi.fn(),
  createTodo: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
  revalidatePath: vi.fn(),
  reopenTodo: vi.fn()
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect
}));

vi.mock("../lib/todo-api", () => ({
  completeTodo: mocks.completeTodo,
  createTodo: mocks.createTodo,
  reopenTodo: mocks.reopenTodo
}));

import {
  completeTodoAction,
  createTodoAction
} from "./actions";

describe("@sqlmodel/example-next-todo-web actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates todos through the API and redirects with status", async () => {
    mocks.createTodo.mockResolvedValue({ todo: { id: "todo-1" } });

    const formData = new FormData();
    formData.set("title", "Review schema");

    await expect(createTodoAction(formData)).rejects.toThrow("REDIRECT:/?status=Todo%20created");
    expect(mocks.createTodo).toHaveBeenCalledWith("Review schema");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("completes todos through the API and redirects with status", async () => {
    mocks.completeTodo.mockResolvedValue({ todo: { id: "todo-1" } });

    const formData = new FormData();
    formData.set("id", "todo-1");

    await expect(completeTodoAction(formData)).rejects.toThrow(
      "REDIRECT:/?status=Todo%20completed"
    );
    expect(mocks.completeTodo).toHaveBeenCalledWith("todo-1");
  });
});
