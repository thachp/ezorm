import { Module, type DynamicModule } from "@nestjs/common";
import { TodoModel, type TodoDemoServices } from "@ezorm/example-todo-domain";
import { EzormModule } from "@ezorm/nestjs";
import { TODO_DEMO_SERVICES, TODO_REPOSITORY } from "./tokens";
import { TodosController } from "./todos.controller";

@Module({})
export class TodoApiModule {
  static register(services: TodoDemoServices): DynamicModule {
    return {
      module: TodoApiModule,
      imports: [
        EzormModule.forRoot({
          client: services.client,
          repositories: [{ provide: TODO_REPOSITORY, model: TodoModel }]
        })
      ],
      controllers: [TodosController],
      providers: [
        {
          provide: TODO_DEMO_SERVICES,
          useValue: services
        }
      ]
    };
  }
}
