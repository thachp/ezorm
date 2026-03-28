import {
  Global,
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type InjectionToken,
  type OnApplicationShutdown,
  type Provider,
  type Type
} from "@nestjs/common";
import type { ModelClass, OrmClient, Repository } from "@ezorm/orm";
import { createNodeRuntime, type NodeRuntimeConnectOptions } from "@ezorm/runtime-node";

export const EZORM_CLIENT = "EZORM_CLIENT";

const EZORM_CLIENT_OWNED = "EZORM_CLIENT_OWNED";
const EZORM_ROOT_OPTIONS = "EZORM_ROOT_OPTIONS";
const repositoryTokenByModel = new WeakMap<object, symbol>();

export interface EzormRootClientOptions {
  client: OrmClient;
}

export interface EzormRootConnectOptions {
  connect: NodeRuntimeConnectOptions;
}

export type EzormModuleOptions = EzormRootClientOptions | EzormRootConnectOptions;

export interface EzormModuleAsyncOptions {
  imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule>>;
  inject?: InjectionToken[];
  useFactory: (...args: any[]) => EzormModuleOptions | Promise<EzormModuleOptions>;
}

@Injectable()
class EzormClientLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(EZORM_CLIENT) private readonly client: OrmClient,
    @Inject(EZORM_CLIENT_OWNED) private readonly owned: boolean
  ) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.owned) {
      await this.client.close();
    }
  }
}

@Global()
@Module({})
export class EzormModule {
  static forRoot(options: EzormModuleOptions): DynamicModule {
    return {
      module: EzormModule,
      providers: createRootProviders(options),
      exports: [EZORM_CLIENT]
    };
  }

  static forRootAsync(options: EzormModuleAsyncOptions): DynamicModule {
    return {
      module: EzormModule,
      imports: options.imports,
      providers: createAsyncRootProviders(options),
      exports: [EZORM_CLIENT]
    };
  }

  static forFeature(models: ModelClass<any>[]): DynamicModule {
    const repositoryProviders = models.map((model) => ({
      provide: getEzormRepositoryToken(model),
      useFactory: (client: OrmClient): Repository<Record<string, unknown>> => client.repository(model),
      inject: [EZORM_CLIENT]
    }));

    return {
      module: EzormModule,
      providers: repositoryProviders,
      exports: repositoryProviders
    };
  }
}

export function getEzormRepositoryToken<T extends object>(model: ModelClass<T>): symbol {
  let token = repositoryTokenByModel.get(model);
  if (!token) {
    token = Symbol(`EZORM_REPOSITORY:${model.name || "anonymous"}`);
    repositoryTokenByModel.set(model, token);
  }
  return token;
}

export function InjectEzormClient(): ParameterDecorator & PropertyDecorator {
  return Inject(EZORM_CLIENT);
}

export function InjectEzormRepository<T extends object>(
  model: ModelClass<T>
): ParameterDecorator & PropertyDecorator {
  return Inject(getEzormRepositoryToken(model));
}

function createRootProviders(options: EzormModuleOptions): Provider[] {
  return [
    {
      provide: EZORM_CLIENT,
      useFactory: async (): Promise<OrmClient> => createClient(options)
    },
    {
      provide: EZORM_CLIENT_OWNED,
      useValue: ownsClient(options)
    },
    EzormClientLifecycle
  ];
}

function createAsyncRootProviders(options: EzormModuleAsyncOptions): Provider[] {
  return [
    {
      provide: EZORM_ROOT_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject ?? []
    },
    {
      provide: EZORM_CLIENT,
      useFactory: async (resolvedOptions: EzormModuleOptions): Promise<OrmClient> =>
        createClient(resolvedOptions),
      inject: [EZORM_ROOT_OPTIONS]
    },
    {
      provide: EZORM_CLIENT_OWNED,
      useFactory: (resolvedOptions: EzormModuleOptions): boolean => ownsClient(resolvedOptions),
      inject: [EZORM_ROOT_OPTIONS]
    },
    EzormClientLifecycle
  ];
}

async function createClient(options: EzormModuleOptions): Promise<OrmClient> {
  if ("client" in options) {
    return options.client;
  }

  return createNodeRuntime({
    connect: options.connect
  });
}

function ownsClient(options: EzormModuleOptions): boolean {
  return !("client" in options);
}
