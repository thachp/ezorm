import { randomUUID } from "node:crypto";
import { getNextNodeClient } from "@ezorm/next/node";
import {
  TodoModel,
  type TodoMutationResult,
  type TodoRecord
} from "@ezorm/example-todo-domain";
import type { OrmClient, Repository } from "@ezorm/orm";

const todoSchemaSetup = new Map<string, Promise<void>>();

export type { TodoMutationResult, TodoRecord } from "@ezorm/example-todo-domain";

export function todoDatabaseUrl(): string {
  return process.env.TODO_DATABASE_URL ?? "sqlite::memory:";
}

export async function listTodos(): Promise<TodoRecord[]> {
  return (await getTodoRepository()).findMany({
    orderBy: { field: "title", direction: "asc" }
  });
}

export async function createTodo(title: string): Promise<TodoMutationResult> {
  return {
    todo: await (await getTodoRepository()).create({
      id: randomUUID(),
      title: title.trim(),
      completed: false
    })
  };
}

export async function completeTodo(id: string): Promise<TodoMutationResult> {
  const repository = await getTodoRepository();
  const todo = await requireTodo(repository, id);
  return {
    todo: await repository.update(todo.id, { completed: true })
  };
}

export async function reopenTodo(id: string): Promise<TodoMutationResult> {
  const repository = await getTodoRepository();
  const todo = await requireTodo(repository, id);
  return {
    todo: await repository.update(todo.id, { completed: false })
  };
}

async function getTodoRepository(): Promise<Repository<TodoRecord>> {
  const client = await getInitializedTodoClient();
  return client.repository(TodoModel);
}

async function getInitializedTodoClient(): Promise<OrmClient> {
  const databaseUrl = todoDatabaseUrl();
  const cacheKey = `todo-demo:${databaseUrl}`;
  const client = await getNextNodeClient({
    cacheKey,
    connect: { databaseUrl }
  });

  let setup = todoSchemaSetup.get(cacheKey);
  if (!setup) {
    setup = client.pushSchema([TodoModel]).then(() => undefined);
    todoSchemaSetup.set(cacheKey, setup);
  }

  try {
    await setup;
  } catch (error) {
    todoSchemaSetup.delete(cacheKey);
    throw error;
  }

  return client;
}

async function requireTodo(
  repository: Repository<TodoRecord>,
  id: string
): Promise<TodoRecord> {
  const todo = await repository.findById(id);
  if (!todo) {
    throw new Error(`Todo ${id} does not exist`);
  }
  return todo;
}
