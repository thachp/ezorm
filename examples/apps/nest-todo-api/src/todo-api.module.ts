import { Module, type DynamicModule } from "@nestjs/common";
import { TodoModel, type TodoDemoServices } from "@sqlmodel/example-todo-domain";
import { SqlModelModule } from "@sqlmodel/nestjs";
import { TODO_DEMO_SERVICES, TODO_REPOSITORY } from "./tokens";
import { TodosController } from "./todos.controller";

@Module({})
export class TodoApiModule {
  static register(services: TodoDemoServices): DynamicModule {
    return {
      module: TodoApiModule,
      imports: [
        SqlModelModule.forRoot({
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
