import { getNextNodeClient } from "@ezorm/next/node";
import {
  completeTodo as completeTodoWithRepository,
  createTodo as createTodoWithRepository,
  listTodos as listTodosWithRepository,
  pushTodoSchema,
  reopenTodo as reopenTodoWithRepository,
  TodoModel,
  type TodoMutationResult,
  type TodoRecord
} from "@ezorm/example-todo-domain";
import type { OrmClient } from "@ezorm/orm";

const todoSchemaSetup = new Map<string, Promise<void>>();

export type { TodoMutationResult, TodoRecord } from "@ezorm/example-todo-domain";

export function todoDatabaseUrl(): string {
  return process.env.TODO_DATABASE_URL ?? "sqlite::memory:";
}

export async function listTodos(): Promise<TodoRecord[]> {
  return listTodosWithRepository(await getTodoRepository());
}

export async function createTodo(title: string): Promise<TodoMutationResult> {
  return createTodoWithRepository(await getTodoRepository(), { title });
}

export async function completeTodo(id: string): Promise<TodoMutationResult> {
  return completeTodoWithRepository(await getTodoRepository(), id);
}

export async function reopenTodo(id: string): Promise<TodoMutationResult> {
  return reopenTodoWithRepository(await getTodoRepository(), id);
}

async function getTodoRepository() {
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
    setup = pushTodoSchema(client);
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
