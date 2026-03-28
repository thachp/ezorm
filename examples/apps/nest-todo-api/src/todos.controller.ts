import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post
} from "@nestjs/common";
import type { QueryBus } from "@sqlmodel/cqrs";
import {
  listTodosQuery,
  type TodoDemoServices,
  type TodoListItem
} from "@sqlmodel/example-todo-domain";
import { CreateTodoDto } from "./create-todo.dto";
import { requireTodoId } from "./id";
import { TODO_DEMO_SERVICES } from "./tokens";

@Controller("todos")
export class TodosController {
  constructor(
    @Inject("SQLMODEL_QUERY_BUS") private readonly queryBus: QueryBus,
    @Inject(TODO_DEMO_SERVICES) private readonly services: TodoDemoServices
  ) {}

  @Get()
  async listTodos(): Promise<TodoListItem[]> {
    return this.queryBus.execute(listTodosQuery, undefined);
  }

  @Post()
  async createTodo(@Body() body: CreateTodoDto) {
    return this.services.createTodo({ title: body.title });
  }

  @Post(":id/complete")
  async completeTodo(@Param("id") id: string) {
    return this.services.completeTodo(requireTodoId(id));
  }

  @Post(":id/reopen")
  async reopenTodo(@Param("id") id: string) {
    return this.services.reopenTodo(requireTodoId(id));
  }
}
