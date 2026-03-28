import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import {
  type TodoMutationResult,
  type TodoRecord
} from "@ezorm/example-todo-domain";
import { CreateTodoDto } from "./create-todo.dto";
import { requireTodoId } from "./id";
import { TodosService } from "./todos.service";

@Controller("todos")
export class TodosController {
  constructor(@Inject(TodosService) private readonly todos: TodosService) {}

  @Get()
  async listTodos(): Promise<TodoRecord[]> {
    return this.todos.listTodos();
  }

  @Post()
  async createTodo(@Body() body: CreateTodoDto): Promise<TodoMutationResult> {
    return this.todos.createTodo({ title: body.title });
  }

  @Post(":id/complete")
  async completeTodo(@Param("id") id: string): Promise<TodoMutationResult> {
    return this.todos.completeTodo(requireTodoId(id));
  }

  @Post(":id/reopen")
  async reopenTodo(@Param("id") id: string): Promise<TodoMutationResult> {
    return this.todos.reopenTodo(requireTodoId(id));
  }
}
