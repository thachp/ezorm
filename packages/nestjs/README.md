# @ezorm/nestjs

`@ezorm/nestjs` is the Nest DI adapter for Ezorm's ORM-first workflow.

It provides:

- `EzormModule.forRoot({ client })`
- `EzormModule.forRoot({ connect })`
- `EzormModule.forRootAsync({ useFactory, inject? })`
- `EzormModule.forFeature([ModelA, ModelB])`
- `InjectEzormClient()`
- `InjectEzormRepository(Model)`

## Example

```ts
import { Injectable, Module, OnModuleInit } from "@nestjs/common";
import { Field, Model, PrimaryKey } from "@ezorm/core";
import {
  EzormModule,
  InjectEzormClient,
  InjectEzormRepository
} from "@ezorm/nestjs";
import type { OrmClient, Repository } from "@ezorm/orm";

@Model({ table: "todos" })
class Todo {
  @PrimaryKey()
  @Field.string()
  id!: string;

  @Field.string()
  title!: string;
}

@Injectable()
class TodosService implements OnModuleInit {
  constructor(
    @InjectEzormClient() private readonly client: OrmClient,
    @InjectEzormRepository(Todo) private readonly repository: Repository<Todo>
  ) {}

  async onModuleInit(): Promise<void> {
    await this.client.pushSchema([Todo]);
  }
}

@Module({
  imports: [
    EzormModule.forRoot({
      connect: { databaseUrl: "sqlite::memory:" }
    }),
    EzormModule.forFeature([Todo])
  ],
  providers: [TodosService]
})
export class AppModule {}
```

When `@ezorm/nestjs` creates the client from `connect`, it closes that client on Nest shutdown. When you pass `client`, lifecycle ownership stays with the caller.
