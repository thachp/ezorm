import type { ModelClass, OrmClient, Repository } from "@sqlmodel/orm";

export interface SqlModelNestModuleOptions {
  client: OrmClient;
  repositories?: SqlModelRepositoryProvider[];
}

export interface SqlModelRepositoryProvider<T extends object = Record<string, unknown>> {
  provide: string;
  model: ModelClass<T>;
}

export interface NestProviderDescriptor<T = unknown> {
  provide: string;
  useValue?: T;
  useFactory?: (...args: any[]) => T;
  inject?: string[];
}

export function createSqlModelProviders(
  options: SqlModelNestModuleOptions
): NestProviderDescriptor[] {
  return [
    { provide: "SQLMODEL_ORM_CLIENT", useValue: options.client },
    ...(options.repositories ?? []).map((repository) => ({
      provide: repository.provide,
      useFactory: (client: OrmClient): Repository<Record<string, unknown>> =>
        client.repository(repository.model),
      inject: ["SQLMODEL_ORM_CLIENT"]
    }))
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
