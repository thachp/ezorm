import { Controller, Inject, Post } from "@nestjs/common";
import type { TodoDemoServices } from "@sqlmodel/example-todo-domain";
import { TODO_DEMO_SERVICES } from "./tokens";

@Controller("projectors")
export class ProjectorsController {
  constructor(
    @Inject(TODO_DEMO_SERVICES) private readonly services: TodoDemoServices
  ) {}

  @Post("todos/rebuild")
  async rebuildTodosProjection() {
    const checkpoint = await this.services.rebuildTodosProjection();
    return {
      checkpoint
    };
  }
}
