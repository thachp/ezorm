import type {
  ModelClass,
  OrmClient,
  QueryBuilder,
  Repository,
  TableSchema
} from "@ezorm/orm";
import {
  createRuntimeOrmClient,
  type RuntimeOrmExecutor
} from "@ezorm/orm";

export interface ProxyOrmClientOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
}

export interface ProxyRuntimeErrorBody {
  code?: string;
  message?: string;
}

export class ProxyRuntimeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ProxyRuntimeError";
  }
}

export class ProxyOrmClient implements OrmClient {
  private readonly client: OrmClient;

  constructor(options: ProxyOrmClientOptions) {
    const endpoint = options.endpoint.replace(/\/$/, "");
    const fetchImpl = options.fetchImpl ?? fetch;
    const executor: RuntimeOrmExecutor = {
      create: (model, input) => this.post(fetchImpl, endpoint, "/orm/create", { model, input }),
      findById: (model, id) =>
        this.post<Record<string, unknown> | null>(fetchImpl, endpoint, "/orm/find-by-id", {
          model,
          id
        }).then((record) => record ?? undefined),
      findMany: (model, queryOptions) =>
        this.post(fetchImpl, endpoint, "/orm/find-many", { model, options: queryOptions }),
      update: (model, id, input) =>
        this.post(fetchImpl, endpoint, "/orm/update", { model, id, input }),
      delete: (model, id) => this.post(fetchImpl, endpoint, "/orm/delete", { model, id }),
      pushSchema: (models) => this.post(fetchImpl, endpoint, "/orm/schema/push", { models }),
      pullSchema: () => this.post(fetchImpl, endpoint, "/orm/schema/pull", {}),
      close: async () => undefined
    };

    this.client = createRuntimeOrmClient(executor, unsupportedRelationError().message);
  }

  repository<T extends object>(model: ModelClass<T>): Repository<T> {
    return this.client.repository(model);
  }

  query<T extends object>(model: ModelClass<T>): QueryBuilder<T> {
    return this.client.query(model);
  }

  load<T extends object>(model: ModelClass<T>, entity: T, relationName: string): Promise<unknown> {
    return this.client.load(model, entity, relationName);
  }

  loadMany<T extends object>(
    model: ModelClass<T>,
    entities: T[],
    relationName: string
  ): Promise<T[]> {
    return this.client.loadMany(model, entities, relationName);
  }

  pushSchema(models: Function[]): Promise<{ statements: string[] }> {
    return this.client.pushSchema(models);
  }

  pullSchema(): Promise<TableSchema[]> {
    return this.client.pullSchema();
  }

  close(): Promise<void> {
    return this.client.close();
  }

  private async post<T>(
    fetchImpl: typeof fetch,
    endpoint: string,
    path: string,
    body: Record<string, unknown>
  ): Promise<T> {
    const response = await fetchImpl(`${endpoint}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw await this.toProxyError(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  private async toProxyError(response: Response): Promise<Error> {
    const rawBody = await response.text();
    const payload = parseProxyRuntimeError(rawBody);

    return new ProxyRuntimeError(
      response.status,
      payload?.code ?? "http_error",
      payload?.message ?? `Proxy runtime request failed with ${response.status}`
    );
  }
}

function parseProxyRuntimeError(rawBody: string): ProxyRuntimeErrorBody | undefined {
  if (!rawBody) {
    return undefined;
  }

  try {
    const payload = JSON.parse(rawBody) as ProxyRuntimeErrorBody;
    if (typeof payload !== "object" || payload === null) {
      return undefined;
    }
    return payload;
  } catch {
    return undefined;
  }
}

function unsupportedRelationError(): Error {
  return new Error(
    "@ezorm/runtime-proxy does not support relation-aware queries or loaders on the pooled SQL runtime yet."
  );
}
