import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post
} from "@nestjs/common";
import {
  type TodoRecord,
  type TodoDemoServices,
  type TodoMutationResult
} from "@sqlmodel/example-todo-domain";
import type { Repository } from "@sqlmodel/orm";
import {
  type TodoDemoServices,
  type TodoRecord
} from "@sqlmodel/example-todo-domain";
import { CreateTodoDto } from "./create-todo.dto";
import { requireTodoId } from "./id";
import { TODO_DEMO_SERVICES, TODO_REPOSITORY } from "./tokens";

@Controller("todos")
export class TodosController {
  constructor(
    @Inject(TODO_REPOSITORY) private readonly repository: Repository<TodoRecord>,
    @Inject(TODO_DEMO_SERVICES) private readonly services: TodoDemoServices
  ) {}

  @Get()
  async listTodos(): Promise<TodoRecord[]> {
    return this.repository.findMany({
      orderBy: { field: "title", direction: "asc" }
    });
  }

  @Post()
  async createTodo(@Body() body: CreateTodoDto): Promise<TodoMutationResult> {
    return this.services.createTodo({ title: body.title });
  }

  @Post(":id/complete")
  async completeTodo(@Param("id") id: string): Promise<TodoMutationResult> {
    return this.services.completeTodo(requireTodoId(id));
  }

  @Post(":id/reopen")
  async reopenTodo(@Param("id") id: string): Promise<TodoMutationResult> {
    return this.services.reopenTodo(requireTodoId(id));
  }
}
