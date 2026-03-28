import { getModelMetadata } from "@ezorm/core";
import type {
  FindManyOptions,
  ModelClass,
  OrmClient,
  ProjectionQueryBuilder,
  QueryBuilder,
  Repository,
  TableSchema
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
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ProxyOrmClientOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  repository<T extends object>(model: ModelClass<T>): Repository<T> {
    const metadata = getModelMetadata(model);
    const primaryKey = metadata.fields.find((field) => field.primaryKey);

    if (!primaryKey) {
      throw new Error(`Model ${metadata.name} must declare a primary key`);
    }

    return {
      create: (input) =>
        this.post<T>("/orm/create", {
          table: metadata.table,
          input
        }),
      findById: (id) =>
        this.post<T | undefined>("/orm/find-by-id", {
          table: metadata.table,
          id
        }),
      findMany: (options?: FindManyOptions<T>) =>
        this.post<T[]>("/orm/find-many", {
          table: metadata.table,
          options
        }),
      update: (id, patch) =>
        this.post<T>("/orm/update", {
          table: metadata.table,
          id,
          patch
        }),
      delete: async (id) => {
        await this.post<void>("/orm/delete", {
          table: metadata.table,
          id,
          primaryKey: primaryKey.name
        });
      }
    };
  }

  query<T extends object>(_model: ModelClass<T>): QueryBuilder<T> {
    return new UnsupportedProxyQueryBuilder<T>();
  }

  async load<T extends object>(
    _model: ModelClass<T>,
    _entity: T,
    _relationName: string
  ): Promise<unknown> {
    throw unsupportedRelationError();
  }

  async loadMany<T extends object>(
    _model: ModelClass<T>,
    _entities: T[],
    _relationName: string
  ): Promise<T[]> {
    throw unsupportedRelationError();
  }

  async pushSchema(models: Function[]): Promise<{ statements: string[] }> {
    return this.post("/orm/schema/push", {
      models: models.map((model) => getModelMetadata(model))
    });
  }

  async pullSchema(): Promise<TableSchema[]> {
    return this.post("/orm/schema/pull", {});
  }

  async close(): Promise<void> {
    return undefined;
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(`${this.endpoint}${path}`, {
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

class UnsupportedProxyQueryBuilder<T extends object> implements QueryBuilder<T> {
  where(): QueryBuilder<T> {
    return this;
  }

  orderBy(): QueryBuilder<T> {
    return this;
  }

  limit(): QueryBuilder<T> {
    return this;
  }

  offset(): QueryBuilder<T> {
    return this;
  }

  join(): QueryBuilder<T> {
    return this;
  }

  leftJoin(): QueryBuilder<T> {
    return this;
  }

  include(): QueryBuilder<T> {
    return this;
  }

  select<Row extends object>(
    _shape: Record<Extract<keyof Row, string>, string>
  ): ProjectionQueryBuilder<Row> {
    return this as unknown as ProjectionQueryBuilder<Row>;
  }

  async all(): Promise<T[]> {
    throw unsupportedRelationError();
  }

  async first(): Promise<T | undefined> {
    throw unsupportedRelationError();
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
    "@ezorm/runtime-proxy does not support relation-aware queries or loaders yet. Use @ezorm/runtime-node for the current SQLite-backed implementation."
  );
}
