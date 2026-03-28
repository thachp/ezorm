import { Module, type DynamicModule } from "@nestjs/common";
import { TodoModel } from "@ezorm/example-todo-domain";
import { EzormModule } from "@ezorm/nestjs";
import { TodosController } from "./todos.controller";
import { TodosService } from "./todos.service";

@Module({})
export class TodoApiModule {
  static register(options?: { databaseUrl?: string }): DynamicModule {
    return {
      module: TodoApiModule,
      imports: [
        EzormModule.forRoot({
          connect: {
            databaseUrl: options?.databaseUrl ?? "sqlite::memory:"
          }
        }),
        EzormModule.forFeature([TodoModel])
      ],
      controllers: [TodosController],
      providers: [TodosService]
    };
  }
}
