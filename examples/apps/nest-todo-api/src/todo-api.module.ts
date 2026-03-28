import { Module, type DynamicModule } from "@nestjs/common";
import type { TodoDemoServices } from "@sqlmodel/example-todo-domain";
import { SqlModelModule } from "@sqlmodel/nestjs";
import { ProjectorsController } from "./projectors.controller";
import { TODO_DEMO_SERVICES } from "./tokens";
import { TodosController } from "./todos.controller";

@Module({})
export class TodoApiModule {
  static register(services: TodoDemoServices): DynamicModule {
    return {
      module: TodoApiModule,
      imports: [
        SqlModelModule.forRoot({
          eventStore: services.eventStore,
          commandBus: services.commandBus,
          queryBus: services.queryBus,
          projectors: services.projectors
        })
      ],
      controllers: [ProjectorsController, TodosController],
      providers: [
        {
          provide: TODO_DEMO_SERVICES,
          useValue: services
        }
      ]
    };
  }
}
