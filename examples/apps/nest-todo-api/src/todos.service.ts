import { randomUUID } from "node:crypto";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
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
    await this.client.pushSchema([TodoModel]);
  }

  async listTodos(): Promise<TodoRecord[]> {
    return this.repository.findMany({
      orderBy: { field: "title", direction: "asc" }
    });
  }

  async createTodo(input: { title: string }): Promise<TodoMutationResult> {
    return {
      todo: await this.repository.create({
        id: randomUUID(),
        title: input.title.trim(),
        completed: false
      })
    };
  }

  async completeTodo(id: string): Promise<TodoMutationResult> {
    const todo = await this.requireTodo(id);
    return {
      todo: await this.repository.update(todo.id, { completed: true })
    };
  }

  async reopenTodo(id: string): Promise<TodoMutationResult> {
    const todo = await this.requireTodo(id);
    return {
      todo: await this.repository.update(todo.id, { completed: false })
    };
  }

  private async requireTodo(id: string): Promise<TodoRecord> {
    const todo = await this.repository.findById(id);
    if (!todo) {
      throw new Error(`Todo ${id} does not exist`);
    }
    return todo;
  }
}
