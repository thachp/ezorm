import React from "react";
import {
  completeTodoAction,
  createTodoAction,
  reopenTodoAction
} from "./actions";
import { fetchTodos, type TodoListItem } from "../lib/todo-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function statusClass(kind: "error" | "status"): string {
  return kind === "error"
    ? "border-orange-300 bg-orange-50 text-orange-700"
    : "border-teal-300 bg-teal-50 text-teal-700";
}

function todoCardClass(todo: TodoListItem): string {
  return todo.completed
    ? "border-slate-200 bg-white/70 text-slate-500"
    : "border-teal-200 bg-white text-slate-900 shadow-sm";
}

export default async function Page({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const status = firstValue(params?.status);
  const error = firstValue(params?.error);

  let todos: TodoListItem[] = [];
  let loadError: string | undefined;

  try {
    todos = await fetchTodos();
  } catch (cause) {
    loadError = cause instanceof Error ? cause.message : "Unable to load todos";
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-10 md:px-10">
      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[2rem] border border-white/60 bg-[var(--panel)] p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur">
          <p className="text-sm font-medium uppercase tracking-[0.3em] text-teal-700">
            Ezorm Demo
          </p>
          <h1 className="mt-4 max-w-xl text-4xl font-semibold tracking-tight text-slate-900 md:text-5xl">
            End-to-end ORM todo flow with a Tailwind frontend.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
            The Next.js app stays HTTP-only. NestJS owns the SQL-backed repository and exposes a
            minimal CRUD-oriented REST API.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 text-sm text-slate-600">
            <span className="rounded-full border border-slate-200 bg-white/80 px-4 py-2">
              Decorated models
            </span>
            <span className="rounded-full border border-slate-200 bg-white/80 px-4 py-2">
              Repository writes
            </span>
            <span className="rounded-full border border-slate-200 bg-white/80 px-4 py-2">
              SQLite storage
            </span>
            <span className="rounded-full border border-slate-200 bg-white/80 px-4 py-2">
              Ordered reads
            </span>
          </div>
        </div>

        <div className="rounded-[2rem] border border-white/60 bg-slate-950 p-8 text-slate-100 shadow-[0_24px_60px_rgba(15,23,42,0.22)]">
          <h2 className="text-lg font-semibold">Create a todo</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Writes go straight to the ORM repository and persist rows in the backing SQL table.
          </p>
          <form action={createTodoAction} className="mt-6 space-y-4">
            <label className="block text-sm font-medium text-slate-200" htmlFor="title">
              Title
            </label>
            <input
              id="title"
              name="title"
              className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-base text-white outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-500/30"
              placeholder="Ship the repository demo"
            />
            <button
              type="submit"
              className="inline-flex items-center rounded-full bg-teal-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-teal-400"
            >
              Create todo
            </button>
          </form>
        </div>
      </section>

      {(status || error || loadError) && (
        <section className="grid gap-3">
          {status ? (
            <p className={`rounded-2xl border px-4 py-3 text-sm ${statusClass("status")}`}>
              {status}
            </p>
          ) : null}
          {error ? (
            <p className={`rounded-2xl border px-4 py-3 text-sm ${statusClass("error")}`}>
              {error}
            </p>
          ) : null}
          {loadError ? (
            <p className={`rounded-2xl border px-4 py-3 text-sm ${statusClass("error")}`}>
              {loadError}
            </p>
          ) : null}
        </section>
      )}

      <section className="grid gap-6 lg:grid-cols-[1fr_auto]">
        <div className="rounded-[2rem] border border-[var(--panel-border)] bg-[var(--panel)] p-8 backdrop-blur">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Todo list</h2>
            <p className="mt-1 text-sm text-slate-600">
              Reads come straight from the persisted `todos` table with a simple title sort.
            </p>
          </div>

          <div className="mt-6 grid gap-4">
            {todos.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center text-sm text-slate-500">
                No todos yet. Create one to insert the first row into `todos`.
              </div>
            ) : (
              todos.map((todo) => (
                <article
                  key={todo.id}
                  className={`grid gap-4 rounded-3xl border p-5 transition ${todoCardClass(todo)}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-lg font-semibold">{todo.title}</p>
                      <p className="mt-1 text-sm">
                        Repository state · {todo.completed ? "completed" : "open"}
                      </p>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                      {todo.id.slice(0, 8)}
                    </span>
                  </div>
                  <form action={todo.completed ? reopenTodoAction : completeTodoAction}>
                    <input type="hidden" name="id" value={todo.id} />
                    <button
                      type="submit"
                      className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-teal-400 hover:text-teal-700"
                    >
                      {todo.completed ? "Reopen todo" : "Complete todo"}
                    </button>
                  </form>
                </article>
              ))
            )}
          </div>
        </div>

        <aside className="rounded-[2rem] border border-white/60 bg-slate-900 p-6 text-sm text-slate-300 shadow-[0_24px_60px_rgba(15,23,42,0.16)]">
          <h2 className="text-base font-semibold text-white">Local defaults</h2>
          <dl className="mt-4 space-y-4">
            <div>
              <dt className="text-xs uppercase tracking-[0.24em] text-slate-400">API base URL</dt>
              <dd className="mt-1 break-all text-slate-200">
                {process.env.TODO_API_BASE_URL ?? "http://localhost:4000"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.24em] text-slate-400">Persistence</dt>
              <dd className="mt-1">SQLite-backed ORM client. The demo defaults to an in-memory database.</dd>
            </div>
          </dl>
        </aside>
      </section>
    </main>
  );
}
