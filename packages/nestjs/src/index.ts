import type { EventStore } from "@sqlmodel-ts/events";
import type { CommandBus, ProjectorRegistry, QueryBus } from "@sqlmodel-ts/cqrs";

export interface SqlModelNestModuleOptions {
  eventStore: EventStore;
  commandBus: CommandBus;
  queryBus: QueryBus;
  projectors?: ProjectorRegistry;
}

export interface NestProviderDescriptor<T = unknown> {
  provide: string;
  useValue: T;
}

export function createSqlModelProviders(
  options: SqlModelNestModuleOptions
): NestProviderDescriptor[] {
  return [
    { provide: "SQLMODEL_EVENT_STORE", useValue: options.eventStore },
    { provide: "SQLMODEL_COMMAND_BUS", useValue: options.commandBus },
    { provide: "SQLMODEL_QUERY_BUS", useValue: options.queryBus },
    { provide: "SQLMODEL_PROJECTORS", useValue: options.projectors ?? null }
  ];
}

export class SqlModelModule {
  static forRoot(options: SqlModelNestModuleOptions) {
    return {
      module: SqlModelModule,
      providers: createSqlModelProviders(options),
      exports: createSqlModelProviders(options)
    };
  }
}

