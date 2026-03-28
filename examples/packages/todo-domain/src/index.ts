import { randomUUID } from "node:crypto";
import { Field, Model, PrimaryKey } from "@sqlmodel/core";
import { createOrmClient, type OrmClient, type Repository } from "@sqlmodel/orm";

export interface TodoRecord {
  id: string;
  title: string;
  completed: boolean;
}

export interface TodoMutationResult {
  todo: TodoRecord;
}

export interface TodoDemoServices {
  client: OrmClient;
  repository: Repository<TodoRecord>;
  listTodos(): Promise<TodoRecord[]>;
  createTodo(input: { id?: string; title: string }): Promise<TodoMutationResult>;
  completeTodo(id: string): Promise<TodoMutationResult>;
  reopenTodo(id: string): Promise<TodoMutationResult>;
  close(): Promise<void>;
}

@Model({ table: "todos" })
export class TodoModel {
  @PrimaryKey()
  @Field.string()
  id!: string;

  @Field.string()
  title!: string;

  @Field.boolean({ defaultValue: false })
  completed!: boolean;
}

export async function createTodoDemoServices(options?: {
  client?: OrmClient;
  databaseUrl?: string;
}): Promise<TodoDemoServices> {
  const client = options?.client ?? (await createOrmClient({
    databaseUrl: options?.databaseUrl ?? "sqlite::memory:"
  }));
  const repository = client.repository(TodoModel);

  await client.pushSchema([TodoModel]);

  async function createTodo(input: { id?: string; title: string }): Promise<TodoMutationResult> {
    const todo = await repository.create({
      id: input.id ?? randomUUID(),
      title: input.title.trim(),
      completed: false
    });
    return { todo };
  }

  async function completeTodo(id: string): Promise<TodoMutationResult> {
    const todo = await repository.findById(id);
    if (!todo) {
      throw new Error(`Todo ${id} does not exist`);
    }
    return {
      todo: await repository.update(id, { completed: true })
    };
  }

  async function reopenTodo(id: string): Promise<TodoMutationResult> {
    const todo = await repository.findById(id);
    if (!todo) {
      throw new Error(`Todo ${id} does not exist`);
    }
    return {
      todo: await repository.update(id, { completed: false })
    };
  }

  async function listTodos(): Promise<TodoRecord[]> {
    return repository.findMany({
      orderBy: { field: "title", direction: "asc" }
    });
  }

  return {
    client,
    repository,
    listTodos,
    createTodo,
    completeTodo,
    reopenTodo,
    close: () => client.close()
  };
}
