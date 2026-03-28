import { Injectable, type OnModuleInit } from "@nestjs/common";
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
import type { OrmClient, Repository } from "@ezorm/orm";
import { InjectEzormClient, InjectEzormRepository } from "@ezorm/nestjs";

@Injectable()
export class TodosService implements OnModuleInit {
  constructor(
    @InjectEzormClient() private readonly client: OrmClient,
    @InjectEzormRepository(TodoModel)
    private readonly repository: Repository<TodoRecord>
  ) {}

  async onModuleInit(): Promise<void> {
    await pushTodoSchema(this.client);
  }

  async listTodos(): Promise<TodoRecord[]> {
    return listTodosWithRepository(this.repository);
  }

  async createTodo(input: { title: string }): Promise<TodoMutationResult> {
    return createTodoWithRepository(this.repository, input);
  }

  async completeTodo(id: string): Promise<TodoMutationResult> {
    return completeTodoWithRepository(this.repository, id);
  }

  async reopenTodo(id: string): Promise<TodoMutationResult> {
    return reopenTodoWithRepository(this.repository, id);
  }
}
