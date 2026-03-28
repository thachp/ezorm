import {
  getModelMetadata,
  validateModelInput,
  type FieldMetadata,
  type ModelMetadata,
  type RelationMetadata
} from "@ezorm/core";
import type {
  FindManyOptions,
  ModelClass,
  OrmClient,
  ProjectionQueryBuilder,
  QueryBuilder,
  Repository,
  TableSchema
} from "./index";

type SqlScalar = string | number | boolean | null;
type SortDirection = "asc" | "desc";

export interface SerializedFieldMetadata {
  name: string;
  type: string;
  nullable?: boolean;
  defaultValue?: unknown;
  primaryKey?: boolean;
}

export interface SerializedIndexMetadata {
  name?: string;
  fields: string[];
  unique?: boolean;
}

export interface SerializedRelationMetadata {
  kind: RelationMetadata["kind"];
  name: string;
  targetModel: string;
  foreignKey?: string;
  targetKey?: string;
  localKey?: string;
  throughTable?: string;
  sourceKey?: string;
  throughSourceKey?: string;
  throughTargetKey?: string;
}

export interface SerializedModelMetadata {
  name: string;
  table: string;
  fields: SerializedFieldMetadata[];
  indices: SerializedIndexMetadata[];
  relations: SerializedRelationMetadata[];
}

export interface RuntimeRepositoryExecutor {
  create(model: SerializedModelMetadata, input: Record<string, unknown>): Promise<void>;
  findById(model: SerializedModelMetadata, id: string): Promise<Record<string, unknown> | undefined>;
  findMany(
    model: SerializedModelMetadata,
    options?: FindManyOptions<Record<string, unknown>>
  ): Promise<Record<string, unknown>[]>;
  update(model: SerializedModelMetadata, id: string, input: Record<string, unknown>): Promise<void>;
  delete(model: SerializedModelMetadata, id: string): Promise<void>;
}

export interface RuntimeOrmExecutor extends RuntimeRepositoryExecutor {
  pushSchema(models: SerializedModelMetadata[]): Promise<{ statements: string[] }>;
  pullSchema(): Promise<TableSchema[]>;
  close(): Promise<void>;
}

export function serializeModelMetadata(model: Function | ModelMetadata): SerializedModelMetadata {
  const metadata = typeof model === "function" ? getModelMetadata(model) : model;

  return {
    name: metadata.name,
    table: metadata.table,
    fields: metadata.fields.map((field) => ({
      name: field.name,
      type: field.type,
      nullable: field.nullable,
      defaultValue: field.defaultValue,
      primaryKey: field.primaryKey
    })),
    indices: metadata.indices.map((index) => ({
      name: index.name,
      fields: [...index.fields],
      unique: index.unique
    })),
    relations: metadata.relations.map((relation) => ({
      kind: relation.kind,
      name: relation.name,
      targetModel: relation.target().name,
      foreignKey: "foreignKey" in relation ? relation.foreignKey : undefined,
      targetKey: "targetKey" in relation ? relation.targetKey : undefined,
      localKey: "localKey" in relation ? relation.localKey : undefined,
      throughTable: "throughTable" in relation ? relation.throughTable : undefined,
      sourceKey: "sourceKey" in relation ? relation.sourceKey : undefined,
      throughSourceKey: "throughSourceKey" in relation ? relation.throughSourceKey : undefined,
      throughTargetKey: "throughTargetKey" in relation ? relation.throughTargetKey : undefined
    }))
  };
}

export function createRuntimeOrmClient(
  executor: RuntimeOrmExecutor,
  unsupportedQueryMessage: string
): OrmClient {
  return {
    repository<T extends object>(model: ModelClass<T>): Repository<T> {
      const metadata = getModelMetadata(model);
      const serialized = serializeModelMetadata(metadata);
      const primaryKey = getPrimaryKeyField(metadata);

      return {
        async create(input) {
          const payload = normalizeInput(metadata, input);
          validateNormalizedInput(model, payload);
          await executor.create(serialized, payload);
          return payload as T;
        },

        async findById(id) {
          const row = await executor.findById(serialized, id);
          return row as T | undefined;
        },

        async findMany(options = {}) {
          const normalizedOptions = normalizeFindManyOptions(options);
          const rows = await executor.findMany(serialized, normalizedOptions);
          return rows as T[];
        },

        async update(id, patch) {
          const current = await this.findById(id);
          if (!current) {
            throw new Error(`Record ${id} does not exist`);
          }

          if (primaryKey.name in patch && String(patch[primaryKey.name as keyof T]) !== id) {
            throw new Error(`Primary key ${primaryKey.name} cannot be updated`);
          }

          const next = normalizeInput(metadata, { ...current, ...patch, [primaryKey.name]: id });
          validateNormalizedInput(model, next);
          await executor.update(serialized, id, next);
          return next as T;
        },

        async delete(id) {
          await executor.delete(serialized, id);
        }
      };
    },

    query<T extends object>(_model: ModelClass<T>): QueryBuilder<T> {
      return new UnsupportedRuntimeQueryBuilder<T>(unsupportedQueryMessage);
    },

    async load<T extends object>(
      _model: ModelClass<T>,
      _entity: T,
      _relationName: string
    ): Promise<unknown> {
      throw new Error(unsupportedQueryMessage);
    },

    async loadMany<T extends object>(
      _model: ModelClass<T>,
      _entities: T[],
      _relationName: string
    ): Promise<T[]> {
      throw new Error(unsupportedQueryMessage);
    },

    async pushSchema(models) {
      return executor.pushSchema(models.map(serializeModelMetadata));
    },

    async pullSchema() {
      return executor.pullSchema();
    },

    async close() {
      await executor.close();
    }
  };
}

class UnsupportedRuntimeQueryBuilder<T extends object> implements QueryBuilder<T> {
  constructor(private readonly message: string) {}

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
    throw new Error(this.message);
  }

  async first(): Promise<T | undefined> {
    throw new Error(this.message);
  }
}

function normalizeInput<T extends object>(metadata: ModelMetadata, input: Partial<T>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const field of metadata.fields) {
    const value = input[field.name as keyof T];
    normalized[field.name] = value === undefined ? field.defaultValue ?? undefined : value;
  }
  return normalized;
}

function validateNormalizedInput(target: Function, input: Record<string, unknown>): void {
  const issues = validateModelInput(target, input);
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => `${issue.field}: ${issue.message}`).join(", "));
  }
}

function getPrimaryKeyField(metadata: ModelMetadata): FieldMetadata {
  const primaryKeys = metadata.fields.filter((field) => field.primaryKey);
  if (primaryKeys.length !== 1) {
    throw new Error(`Model ${metadata.name} must declare exactly one primary key field`);
  }
  return primaryKeys[0];
}

function normalizeFindManyOptions<T extends object>(
  options: FindManyOptions<T>
): FindManyOptions<Record<string, unknown>> {
  const where = Object.fromEntries(
    Object.entries(options.where ?? {}).filter(([, value]) => value !== undefined)
  ) as Partial<Record<string, SqlScalar>>;
  const orderBy = options.orderBy
    ? {
        field: String(options.orderBy.field),
        direction: normalizeSortDirection(options.orderBy.direction)
      }
    : undefined;

  return {
    where,
    orderBy
  };
}

function normalizeSortDirection(direction?: SortDirection): SortDirection | undefined {
  return direction === undefined ? undefined : direction;
}
