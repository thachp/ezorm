import type { ModelClass, OrmClient, Repository } from "@ezorm/orm";

export interface EzormNestModuleOptions {
  client: OrmClient;
  repositories?: EzormRepositoryProvider[];
}

export interface EzormRepositoryProvider<T extends object = Record<string, unknown>> {
  provide: string;
  model: ModelClass<T>;
}

export interface NestProviderDescriptor<T = unknown> {
  provide: string;
  useValue?: T;
  useFactory?: (...args: any[]) => T;
  inject?: string[];
}

export function createEzormProviders(
  options: EzormNestModuleOptions
): NestProviderDescriptor[] {
  return [
    { provide: "EZORM_ORM_CLIENT", useValue: options.client },
    ...(options.repositories ?? []).map((repository) => ({
      provide: repository.provide,
      useFactory: (client: OrmClient): Repository<Record<string, unknown>> =>
        client.repository(repository.model),
      inject: ["EZORM_ORM_CLIENT"]
    }))
  ];
}

export class EzormModule {
  static forRoot(options: EzormNestModuleOptions) {
    return {
      module: EzormModule,
      providers: createEzormProviders(options),
      exports: createEzormProviders(options)
    };
  }
}
