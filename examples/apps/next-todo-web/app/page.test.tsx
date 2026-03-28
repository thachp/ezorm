import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TodoListItem } from "../lib/todo-api";

const mocks = vi.hoisted(() => ({
  completeTodo: vi.fn(),
  createTodo: vi.fn(),
  fetchTodos: vi.fn<() => Promise<TodoListItem[]>>(),
  redirect: vi.fn(),
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
  fetchTodos: mocks.fetchTodos,
  reopenTodo: mocks.reopenTodo
}));

import Page from "./page";

describe("@ezorm/example-next-todo-web page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders todos returned by the API", async () => {
    mocks.fetchTodos.mockResolvedValue([
      {
        id: "todo-1",
        title: "Drive ORM demo",
        completed: false
      }
    ]);

    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Drive ORM demo");
    expect(html).toContain("Todo list");
  });

  it("renders load failures as error banners", async () => {
    mocks.fetchTodos.mockRejectedValue(new Error("API offline"));

    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("API offline");
  });
});
