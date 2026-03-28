import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TodoRecord } from "../lib/todo-store";

const mocks = vi.hoisted(() => ({
  completeTodo: vi.fn(),
  createTodo: vi.fn(),
  listTodos: vi.fn<() => Promise<TodoRecord[]>>(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  reopenTodo: vi.fn(),
  todoDatabaseUrl: vi.fn(() => "sqlite::memory:")
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect
}));

vi.mock("../lib/todo-store", () => ({
  completeTodo: mocks.completeTodo,
  createTodo: mocks.createTodo,
  listTodos: mocks.listTodos,
  reopenTodo: mocks.reopenTodo,
  todoDatabaseUrl: mocks.todoDatabaseUrl
}));

import Page from "./page";

describe("@ezorm/example-next-todo-web page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders todos returned by the API", async () => {
    mocks.listTodos.mockResolvedValue([
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
    mocks.listTodos.mockRejectedValue(new Error("Database offline"));

    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Database offline");
  });
});
