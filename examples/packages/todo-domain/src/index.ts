import { randomUUID } from "node:crypto";
import { Field, Model, PrimaryKey } from "@ezorm/core";
import { createOrmClient, type OrmClient, type Repository } from "@ezorm/orm";

export interface TodoRecord {
  id: string;
  title: string;
  completed: boolean;
}

export interface TodoMutationResult {
  todo: TodoRecord;
}

export interface TodoCreateInput {
  id?: string;
  title: string;
}

export interface TodoDemoServices {
  client: OrmClient;
  repository: Repository<TodoRecord>;
  listTodos(): Promise<TodoRecord[]>;
  createTodo(input: TodoCreateInput): Promise<TodoMutationResult>;
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

export async function pushTodoSchema(client: Pick<OrmClient, "pushSchema">): Promise<void> {
  await client.pushSchema([TodoModel]);
}

export async function listTodos(repository: Repository<TodoRecord>): Promise<TodoRecord[]> {
  return repository.findMany({
    orderBy: { field: "title", direction: "asc" }
  });
}

export async function createTodo(
  repository: Repository<TodoRecord>,
  input: TodoCreateInput
): Promise<TodoMutationResult> {
  const todo = await repository.create({
    id: input.id ?? randomUUID(),
    title: input.title.trim(),
    completed: false
  });
  return { todo };
}

export async function completeTodo(
  repository: Repository<TodoRecord>,
  id: string
): Promise<TodoMutationResult> {
  const todo = await requireTodo(repository, id);
  return {
    todo: await repository.update(id, { completed: true })
  };
}

export async function reopenTodo(
  repository: Repository<TodoRecord>,
  id: string
): Promise<TodoMutationResult> {
  const todo = await requireTodo(repository, id);
  return {
    todo: await repository.update(id, { completed: false })
  };
}

export async function createTodoDemoServices(options?: {
  client?: OrmClient;
  databaseUrl?: string;
}): Promise<TodoDemoServices> {
  const client = options?.client ?? (await createOrmClient({
    databaseUrl: options?.databaseUrl ?? "sqlite::memory:"
  }));
  const repository = client.repository(TodoModel);

  await pushTodoSchema(client);

  return {
    client,
    repository,
    listTodos: () => listTodos(repository),
    createTodo: (input) => createTodo(repository, input),
    completeTodo: (id) => completeTodo(repository, id),
    reopenTodo: (id) => reopenTodo(repository, id),
    close: () => client.close()
  };
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
