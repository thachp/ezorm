import { DatabaseSync } from "node:sqlite";
import {
  getModelMetadata,
  validateModelInput,
  type BelongsToRelationMetadata,
  type FieldMetadata,
  type HasManyRelationMetadata,
  type ManyToManyRelationMetadata,
  type ModelMetadata
} from "@ezorm/core";

type SqlScalar = string | number | boolean | null;
type DatabaseValue = string | number | null;
type QueryOperator = "=" | "!=" | "<" | "<=" | ">" | ">=" | "like";
type SortDirection = "asc" | "desc";
type JoinType = "inner" | "left";
type MaterializationMode = "entity" | "plain";
type SupportedRelationMetadata =
  | BelongsToRelationMetadata
  | HasManyRelationMetadata
  | ManyToManyRelationMetadata;

export interface OrmClientOptions {
  databaseUrl: string;
}

export interface FindManyOptions<T extends object> {
  where?: Partial<Record<Extract<keyof T, string>, SqlScalar>>;
  orderBy?: {
    field: Extract<keyof T, string>;
    direction?: SortDirection;
  };
}

export interface Repository<T extends object> {
  create(input: T): Promise<T>;
  findById(id: string): Promise<T | undefined>;
  findMany(options?: FindManyOptions<T>): Promise<T[]>;
  update(id: string, patch: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
}

interface QueryBuilderBase<TResult extends object, TSelf> {
  where(field: string, operator: QueryOperator, value: SqlScalar): TSelf;
  orderBy(field: string, direction?: SortDirection): TSelf;
  limit(count: number): TSelf;
  offset(count: number): TSelf;
  join(relationName: string): TSelf;
  leftJoin(relationName: string): TSelf;
  all(): Promise<TResult[]>;
  first(): Promise<TResult | undefined>;
}

export interface ProjectionQueryBuilder<TResult extends object>
  extends QueryBuilderBase<TResult, ProjectionQueryBuilder<TResult>> {}

export interface EntityQueryBuilder<T extends object>
  extends QueryBuilderBase<T, EntityQueryBuilder<T>> {
  include(relationName: string): EntityQueryBuilder<T>;
  select<Row extends object>(
    shape: Record<Extract<keyof Row, string>, string>
  ): ProjectionQueryBuilder<Row>;
}

export interface QueryBuilder<T extends object> extends EntityQueryBuilder<T> {}

export interface OrmClient {
  repository<T extends object>(model: ModelClass<T>): Repository<T>;
  query<T extends object>(model: ModelClass<T>): QueryBuilder<T>;
  load<T extends object>(model: ModelClass<T>, entity: T, relationName: string): Promise<unknown>;
  loadMany<T extends object>(
    model: ModelClass<T>,
    entities: T[],
    relationName: string
  ): Promise<T[]>;
  pushSchema(models: Function[]): Promise<{ statements: string[] }>;
  pullSchema(): Promise<TableSchema[]>;
  close(): Promise<void>;
}

export interface TableSchema {
  name: string;
  columns: Array<{
    name: string;
    type: string;
    notNull: boolean;
    primaryKey: boolean;
  }>;
}

export interface ModelClass<T extends object> {
  new (): T;
}

interface SqliteOrmContext {
  database: DatabaseSync;
  ensureTable(model: Function): Promise<void>;
  loadMany<T extends object>(model: ModelClass<T>, entities: T[], relationName: string): Promise<T[]>;
}

interface BaseRelationPlan {
  relationName: string;
  kind: SupportedRelationMetadata["kind"];
  sourceMetadata: ModelMetadata;
  targetMetadata: ModelMetadata;
  sourceField: FieldMetadata;
  targetField: FieldMetadata;
}

interface DirectRelationPlan extends BaseRelationPlan {
  kind: "belongsTo" | "hasMany";
}

interface ManyToManyRelationPlan extends BaseRelationPlan {
  kind: "manyToMany";
  throughTable: string;
  throughSourceKey: string;
  throughTargetKey: string;
}

type RelationPlan = DirectRelationPlan | ManyToManyRelationPlan;

interface JoinedRelation {
  alias: string;
  throughAlias?: string;
  joinType: JoinType;
  plan: RelationPlan;
}

interface QueryCondition {
  field: string;
  operator: QueryOperator;
  value: SqlScalar;
}

interface QueryOrder {
  field: string;
  direction: SortDirection;
}

interface QueryProjection {
  alias: string;
  fieldPath: string;
}

interface ResolvedFieldReference {
  reference: string;
  field: FieldMetadata;
}

interface ResolvedProjection {
  alias: string;
  field: FieldMetadata;
  reference: string;
}

interface LazyRelationCacheEntry {
  loaded: boolean;
  promise: Promise<unknown>;
  value: unknown;
}

interface LazyEntityState<T extends object> {
  model: ModelClass<T>;
  relationCache: Map<string, LazyRelationCacheEntry>;
}

const MANY_TO_MANY_SOURCE_KEY_ALIAS = "__ezorm_source_key";
const ENTITY_STATE = Symbol("ezorm.entity.state");

export async function createOrmClient(options: OrmClientOptions): Promise<OrmClient> {
  const database = new DatabaseSync(resolveSqliteFilename(options.databaseUrl));
  const ensuredTables = new Set<string>();

  async function ensureTable(model: Function): Promise<void> {
    const metadata = getModelMetadata(model);
    if (ensuredTables.has(metadata.table)) {
      return;
    }

    for (const statement of createSchemaStatements(metadata)) {
      database.exec(statement);
    }
    ensuredTables.add(metadata.table);
  }

  const context: SqliteOrmContext = {
    database,
    ensureTable,
    loadMany
  };

  async function loadMany<T extends object>(
    model: ModelClass<T>,
    entities: T[],
    relationName: string
  ): Promise<T[]> {
    if (entities.length === 0) {
      return entities;
    }

    const sourceMetadata = getModelMetadata(model);
    const plan = resolveRelationPlan(sourceMetadata, relationName);
    await ensureTable(model);
    await ensureTable(plan.targetMetadata.target);

    const sourceValues = entities
      .map((entity) => readEntityValue(entity, plan.sourceField.name))
      .filter((value): value is Exclude<typeof value, undefined | null> => value !== undefined && value !== null);

    if (sourceValues.length === 0) {
      for (const entity of entities) {
        assignRelation(entity, relationName, relationDefaults(plan.kind));
      }
      return entities;
    }

    const uniqueValues = [...new Map(sourceValues.map((value) => [String(value), value])).values()];
    const placeholders = uniqueValues.map(() => "?").join(", ");

    if (plan.kind === "belongsTo" || plan.kind === "hasMany") {
      const rows = database
        .prepare(
          `SELECT * FROM ${quoteIdentifier(plan.targetMetadata.table)} WHERE ${quoteIdentifier(
            plan.targetField.name
          )} IN (${placeholders})`
        )
        .all(...uniqueValues.map((value) => toDatabaseValue(plan.targetField, value))) as Array<
        Record<string, unknown>
      >;
      const mappedRows = rows.map((row) => mapRow(plan.targetMetadata, row));

      if (plan.kind === "belongsTo") {
        const byTargetKey = new Map(
          mappedRows.map((row) => [String(row[plan.targetField.name]), row])
        );
        for (const entity of entities) {
          const sourceValue = readEntityValue(entity, plan.sourceField.name);
          assignRelation(
            entity,
            relationName,
            sourceValue === undefined || sourceValue === null
              ? undefined
              : byTargetKey.get(String(sourceValue))
          );
        }
        return entities;
      }

      const byForeignKey = new Map<string, Array<Record<string, unknown>>>();
      for (const row of mappedRows) {
        const key = String(row[plan.targetField.name]);
        const current = byForeignKey.get(key) ?? [];
        current.push(row);
        byForeignKey.set(key, current);
      }
      for (const entity of entities) {
        const sourceValue = readEntityValue(entity, plan.sourceField.name);
        assignRelation(
          entity,
          relationName,
          sourceValue === undefined || sourceValue === null
            ? []
            : (byForeignKey.get(String(sourceValue)) ?? [])
        );
      }
      return entities;
    }

    if (plan.kind !== "manyToMany") {
      throw new Error(`Expected many-to-many relation plan for ${relationName}`);
    }

    const manyToManyPlan = plan;
    const manyToManyRows = database
      .prepare(
        `SELECT t.*, jt.${quoteIdentifier(manyToManyPlan.throughSourceKey)} AS ${quoteIdentifier(
          MANY_TO_MANY_SOURCE_KEY_ALIAS
        )} FROM ${quoteIdentifier(manyToManyPlan.throughTable)} jt JOIN ${quoteIdentifier(
          manyToManyPlan.targetMetadata.table
        )} t ON jt.${quoteIdentifier(manyToManyPlan.throughTargetKey)} = t.${quoteIdentifier(
          manyToManyPlan.targetField.name
        )} WHERE jt.${quoteIdentifier(manyToManyPlan.throughSourceKey)} IN (${placeholders})`
      )
      .all(...uniqueValues.map((value) => toDatabaseValue(manyToManyPlan.sourceField, value))) as Array<
      Record<string, unknown>
    >;

    const grouped = new Map<string, Array<Record<string, unknown>>>();
    for (const row of manyToManyRows) {
      const sourceKey = String(row[MANY_TO_MANY_SOURCE_KEY_ALIAS]);
      const current = grouped.get(sourceKey) ?? [];
      current.push(mapRow(manyToManyPlan.targetMetadata, row));
      grouped.set(sourceKey, current);
    }

    for (const entity of entities) {
      const sourceValue = readEntityValue(entity, manyToManyPlan.sourceField.name);
      assignRelation(
        entity,
        relationName,
        sourceValue === undefined || sourceValue === null
          ? []
          : (grouped.get(String(sourceValue)) ?? [])
      );
    }

    return entities;
  }

  return {
    repository<T extends object>(model: ModelClass<T>): Repository<T> {
      const metadata = getModelMetadata(model);
      const primaryKey = getPrimaryKeyField(metadata);

      return {
        async create(input) {
          await ensureTable(model);
          const payload = normalizeInput(metadata, input);
          const issues = validateModelInput(model, payload);
          if (issues.length > 0) {
            throw new Error(issues.map((issue) => `${issue.field}: ${issue.message}`).join(", "));
          }

          const fields = metadata.fields.map((field) => field.name);
          const placeholders = fields.map(() => "?").join(", ");
          const values = fields.map((field) =>
            toDatabaseValue(fieldMetadata(metadata, field), payload[field])
          );

          database
            .prepare(
              `INSERT INTO ${quoteIdentifier(metadata.table)} (${fields
                .map(quoteIdentifier)
                .join(", ")}) VALUES (${placeholders})`
            )
            .run(...values);

          return payload as T;
        },

        async findById(id) {
          await ensureTable(model);
          return createQueryBuilder(context, model, "plain").where(primaryKey.name, "=", id).first();
        },

        async findMany(options = {}) {
          const builder = createQueryBuilder(context, model, "plain");
          for (const [field, value] of Object.entries(options.where ?? {})) {
            if (value !== undefined) {
              builder.where(field, "=", value as SqlScalar);
            }
          }
          if (options.orderBy) {
            builder.orderBy(options.orderBy.field, options.orderBy.direction);
          }
          return builder.all();
        },

        async update(id, patch) {
          await ensureTable(model);
          const current = await this.findById(id);
          if (!current) {
            throw new Error(`Record ${id} does not exist`);
          }

          if (primaryKey.name in patch && String(patch[primaryKey.name as keyof T]) !== id) {
            throw new Error(`Primary key ${primaryKey.name} cannot be updated`);
          }

          const next = normalizeInput(metadata, { ...current, ...patch, [primaryKey.name]: id });
          const issues = validateModelInput(model, next);
          if (issues.length > 0) {
            throw new Error(issues.map((issue) => `${issue.field}: ${issue.message}`).join(", "));
          }

          const assignments = metadata.fields
            .filter((field) => field.name !== primaryKey.name)
            .map((field) => `${quoteIdentifier(field.name)} = ?`);
          const values = metadata.fields
            .filter((field) => field.name !== primaryKey.name)
            .map((field) => toDatabaseValue(field, next[field.name]));

          database
            .prepare(
              `UPDATE ${quoteIdentifier(metadata.table)} SET ${assignments.join(", ")} WHERE ${quoteIdentifier(
                primaryKey.name
              )} = ?`
            )
            .run(...values, id);

          return next as T;
        },

        async delete(id) {
          await ensureTable(model);
          database
            .prepare(
              `DELETE FROM ${quoteIdentifier(metadata.table)} WHERE ${quoteIdentifier(primaryKey.name)} = ?`
            )
            .run(id);
        }
      };
    },

    query<T extends object>(model: ModelClass<T>): QueryBuilder<T> {
      return createQueryBuilder(context, model, "entity");
    },

    async load<T extends object>(model: ModelClass<T>, entity: T, relationName: string): Promise<unknown> {
      await loadMany(model, [entity], relationName);
      return readLoadedRelationValue(entity, relationName);
    },

    loadMany,

    async pushSchema(models) {
      const statements = uniqueStatements(
        models.flatMap((model) => createSchemaStatements(getModelMetadata(model)))
      );

      for (const model of models) {
        await ensureTable(model);
      }

      return { statements };
    },

    async pullSchema() {
      const tableRows = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
        )
        .all() as Array<{ name: string }>;

      return tableRows.map(({ name }) => ({
        name,
        columns: (database.prepare(`PRAGMA table_info(${quoteSqlString(name)})`).all() as Array<{
          name: string;
          type: string;
          notnull: number;
          pk: number;
        }>).map((column) => ({
          name: column.name,
          type: column.type,
          notNull: column.notnull === 1,
          primaryKey: column.pk === 1
        }))
      }));
    },

    async close() {
      database.close();
    }
  };
}

function createQueryBuilder<T extends object>(
  context: SqliteOrmContext,
  model: ModelClass<T>,
  materializationMode: MaterializationMode = "entity"
): SqliteQueryBuilder<T> {
  return new SqliteQueryBuilder(context, model, materializationMode);
}

class SqliteQueryBuilder<TModel extends object, TResult extends object = TModel>
  implements ProjectionQueryBuilder<TResult>
{
  private readonly metadata: ModelMetadata;
  private readonly joins = new Map<string, JoinedRelation>();
  private readonly includes = new Set<string>();
  private readonly conditions: QueryCondition[] = [];
  private readonly orderBys: QueryOrder[] = [];
  private projections?: QueryProjection[];
  private rowLimit?: number;
  private rowOffset?: number;

  constructor(
    private readonly context: SqliteOrmContext,
    private readonly model: ModelClass<TModel>,
    private readonly materializationMode: MaterializationMode
  ) {
    this.metadata = getModelMetadata(model);
  }

  where(field: string, operator: QueryOperator, value: SqlScalar): this {
    this.conditions.push({ field, operator, value });
    return this;
  }

  orderBy(field: string, direction: SortDirection = "asc"): this {
    this.orderBys.push({ field, direction });
    return this;
  }

  limit(count: number): this {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error("Query limit must be a non-negative integer");
    }
    this.rowLimit = count;
    return this;
  }

  offset(count: number): this {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error("Query offset must be a non-negative integer");
    }
    this.rowOffset = count;
    return this;
  }

  join(relationName: string): this {
    this.ensureJoin(relationName, "inner");
    return this;
  }

  leftJoin(relationName: string): this {
    this.ensureJoin(relationName, "left");
    return this;
  }

  include(relationName: string): QueryBuilder<TModel> {
    if (this.projections) {
      throw new Error("Cannot use include() on a projection query");
    }
    resolveRelationPlan(this.metadata, relationName);
    this.includes.add(relationName);
    return this as unknown as QueryBuilder<TModel>;
  }

  select<Row extends object>(
    shape: Record<Extract<keyof Row, string>, string>
  ): ProjectionQueryBuilder<Row> {
    if (this.includes.size > 0) {
      throw new Error("Cannot use select() on a query with include()");
    }

    const entries = Object.entries(shape);
    if (entries.length === 0) {
      throw new Error("Query select() requires at least one projected field");
    }

    const aliases = entries.map(([alias]) => alias);
    if (new Set(aliases).size !== aliases.length) {
      throw new Error("Query select() aliases must be unique");
    }

    this.projections = entries.map(([alias, fieldPath]) => ({
      alias,
      fieldPath: String(fieldPath)
    }));
    return this as unknown as ProjectionQueryBuilder<Row>;
  }

  async all(): Promise<TResult[]> {
    return this.executeAll();
  }

  async first(): Promise<TResult | undefined> {
    const rows = await this.executeAll(1);
    return rows[0];
  }

  private ensureJoin(relationName: string, joinType: JoinType): void {
    if (this.joins.has(relationName)) {
      return;
    }

    const plan = resolveRelationPlan(this.metadata, relationName);
    const index = this.joins.size + 1;
    this.joins.set(relationName, {
      alias: `j${index}`,
      throughAlias: plan.kind === "manyToMany" ? `j${index}_through` : undefined,
      joinType,
      plan
    });
  }

  private async executeAll(overrideLimit?: number): Promise<TResult[]> {
    await this.context.ensureTable(this.model);
    for (const joinedRelation of this.joins.values()) {
      await this.context.ensureTable(joinedRelation.plan.targetMetadata.target);
    }
    for (const relationName of this.includes) {
      const plan = resolveRelationPlan(this.metadata, relationName);
      await this.context.ensureTable(plan.targetMetadata.target);
    }

    const params: DatabaseValue[] = [];
    const hasManyToManyJoin = [...this.joins.values()].some(
      (joinedRelation) => joinedRelation.plan.kind === "manyToMany"
    );
    const joinSql = [...this.joins.values()]
      .map((joinedRelation) => renderJoinSql(joinedRelation))
      .join(" ");

    const whereSql = this.conditions
      .map((condition) => {
        const resolved = this.resolveField(condition.field);
        params.push(toDatabaseValue(resolved.field, condition.value));
        return `${resolved.reference} ${normalizeOperator(condition.operator)} ?`;
      })
      .join(" AND ");

    const orderSql = this.orderBys
      .map((order) => {
        const resolved = this.resolveField(order.field);
        return `${resolved.reference} ${order.direction.toUpperCase()}`;
      })
      .join(", ");

    const effectiveLimit = overrideLimit ?? this.rowLimit;
    const limitSql =
      effectiveLimit === undefined
        ? this.rowOffset === undefined
          ? ""
          : " LIMIT -1"
        : ` LIMIT ${effectiveLimit}`;
    const offsetSql = this.rowOffset === undefined ? "" : ` OFFSET ${this.rowOffset}`;
    const projections = this.resolveProjections();
    const selectClause =
      projections?.map((projection) => `${projection.reference} AS ${quoteIdentifier(projection.alias)}`).join(", ") ??
      "t0.*";
    const sql = [
      `${hasManyToManyJoin ? "SELECT DISTINCT" : "SELECT"} ${selectClause} FROM ${quoteIdentifier(
        this.metadata.table
      )} t0`,
      joinSql ? ` ${joinSql}` : "",
      whereSql ? ` WHERE ${whereSql}` : "",
      orderSql ? ` ORDER BY ${orderSql}` : "",
      limitSql,
      offsetSql
    ].join("");

    const rows = this.context.database.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    if (projections) {
      return rows.map((row) => mapProjectionRow(projections, row) as TResult);
    }

    const mappedRows = rows.map((row) =>
      this.materializationMode === "entity"
        ? materializeQueryEntity(this.context, this.model, this.metadata, row)
        : (mapRow(this.metadata, row) as TModel)
    );

    for (const relationName of this.includes) {
      await this.context.loadMany(this.model, mappedRows, relationName);
    }

    return mappedRows as unknown as TResult[];
  }

  private resolveField(fieldPath: string): ResolvedFieldReference {
    if (!fieldPath.includes(".")) {
      return {
        reference: `t0.${quoteIdentifier(fieldPath)}`,
        field: fieldMetadata(this.metadata, fieldPath)
      };
    }

    const [relationName, fieldName] = fieldPath.split(".", 2);
    const joinedRelation = this.joins.get(relationName);
    if (!joinedRelation) {
      throw new Error(`Relation ${relationName} must be joined before using ${fieldPath}`);
    }

    return {
      reference: `${joinedRelation.alias}.${quoteIdentifier(fieldName)}`,
      field: fieldMetadata(joinedRelation.plan.targetMetadata, fieldName)
    };
  }

  private resolveProjections(): ResolvedProjection[] | undefined {
    if (!this.projections) {
      return undefined;
    }

    return this.projections.map((projection) => {
      const resolved = this.resolveField(projection.fieldPath);
      return {
        alias: projection.alias,
        field: resolved.field,
        reference: resolved.reference
      };
    });
  }
}

function renderJoinSql(joinedRelation: JoinedRelation): string {
  const targetAlias = joinedRelation.alias;
  const joinKeyword = joinedRelation.joinType === "left" ? "LEFT JOIN" : "JOIN";

  if (joinedRelation.plan.kind === "manyToMany") {
    const throughAlias = joinedRelation.throughAlias;
    if (!throughAlias) {
      throw new Error(`Many-to-many relation ${joinedRelation.plan.relationName} is missing a through alias`);
    }
    return [
      `${joinKeyword} ${quoteIdentifier(joinedRelation.plan.throughTable)} ${throughAlias} ON t0.${quoteIdentifier(
        joinedRelation.plan.sourceField.name
      )} = ${throughAlias}.${quoteIdentifier(joinedRelation.plan.throughSourceKey)}`,
      `${joinKeyword} ${quoteIdentifier(joinedRelation.plan.targetMetadata.table)} ${targetAlias} ON ${throughAlias}.${quoteIdentifier(
        joinedRelation.plan.throughTargetKey
      )} = ${targetAlias}.${quoteIdentifier(joinedRelation.plan.targetField.name)}`
    ].join(" ");
  }

  return `${joinKeyword} ${quoteIdentifier(joinedRelation.plan.targetMetadata.table)} ${targetAlias} ON t0.${quoteIdentifier(
    joinedRelation.plan.sourceField.name
  )} = ${targetAlias}.${quoteIdentifier(joinedRelation.plan.targetField.name)}`;
}

function resolveRelationPlan(metadata: ModelMetadata, relationName: string): RelationPlan {
  const relation = metadata.relations.find((item) => item.name === relationName);
  if (!relation) {
    throw new Error(`Unknown relation ${relationName} on model ${metadata.name}`);
  }

  if (
    relation.kind !== "belongsTo" &&
    relation.kind !== "hasMany" &&
    relation.kind !== "manyToMany"
  ) {
    throw new Error(`Relation ${relationName} on model ${metadata.name} is not supported by the ORM yet`);
  }

  const targetMetadata = getModelMetadata(relation.target());

  if (relation.kind === "belongsTo") {
    return {
      relationName,
      kind: relation.kind,
      sourceMetadata: metadata,
      targetMetadata,
      sourceField: fieldMetadata(metadata, relation.foreignKey),
      targetField: fieldMetadata(targetMetadata, relation.targetKey)
    };
  }

  if (relation.kind === "hasMany") {
    return {
      relationName,
      kind: relation.kind,
      sourceMetadata: metadata,
      targetMetadata,
      sourceField: fieldMetadata(metadata, relation.localKey),
      targetField: fieldMetadata(targetMetadata, relation.foreignKey)
    };
  }

  return {
    relationName,
    kind: relation.kind,
    sourceMetadata: metadata,
    targetMetadata,
    sourceField: fieldMetadata(metadata, relation.sourceKey),
    targetField: fieldMetadata(targetMetadata, relation.targetKey),
    throughTable: relation.throughTable,
    throughSourceKey: relation.throughSourceKey,
    throughTargetKey: relation.throughTargetKey
  };
}

function relationDefaults(kind: RelationPlan["kind"]): unknown {
  return kind === "belongsTo" ? undefined : [];
}

function createSchemaStatements(metadata: ModelMetadata): string[] {
  return uniqueStatements([
    createTableStatement(metadata),
    ...createIndexStatements(metadata),
    ...createManyToManyStatements(metadata)
  ]);
}

function createManyToManyStatements(metadata: ModelMetadata): string[] {
  return metadata.relations.flatMap((relation) => {
    if (relation.kind !== "manyToMany") {
      return [];
    }

    const targetMetadata = getModelMetadata(relation.target());
    const sourceField = fieldMetadata(metadata, relation.sourceKey);
    const targetField = fieldMetadata(targetMetadata, relation.targetKey);
    const uniqueIndexName = `${relation.throughTable}_${relation.throughSourceKey}_${relation.throughTargetKey}_unique`;

    return [
      `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(relation.throughTable)} (${quoteIdentifier(
        relation.throughSourceKey
      )} ${sqlTypeForField(sourceField)} NOT NULL, ${quoteIdentifier(
        relation.throughTargetKey
      )} ${sqlTypeForField(targetField)} NOT NULL)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdentifier(uniqueIndexName)} ON ${quoteIdentifier(
        relation.throughTable
      )} (${quoteIdentifier(relation.throughSourceKey)}, ${quoteIdentifier(relation.throughTargetKey)})`
    ];
  });
}

function uniqueStatements(statements: string[]): string[] {
  return [...new Set(statements)];
}

function normalizeOperator(operator: QueryOperator): string {
  return operator === "like" ? "LIKE" : operator;
}

function readEntityValue(entity: object, key: string): unknown {
  return (entity as Record<string, unknown>)[key];
}

function readLoadedRelationValue(entity: object, relationName: string): unknown {
  const state = getLazyEntityState(entity);
  if (!state) {
    return readEntityValue(entity, relationName);
  }

  return state.relationCache.get(relationName)?.value;
}

function assignRelation(entity: object, relationName: string, value: unknown): void {
  const state = getLazyEntityState(entity);
  if (!state) {
    (entity as Record<string, unknown>)[relationName] = value;
    return;
  }

  const existing = state.relationCache.get(relationName);
  state.relationCache.set(relationName, {
    loaded: true,
    promise: existing?.promise ?? Promise.resolve(value),
    value
  });
}

function resolveSqliteFilename(databaseUrl: string): string {
  if (databaseUrl === "sqlite::memory:") {
    return ":memory:";
  }
  if (databaseUrl.startsWith("sqlite://")) {
    const path = databaseUrl.slice("sqlite://".length);
    return path.startsWith("/") ? path : `/${path}`;
  }
  throw new Error(`Unsupported database url for @ezorm/orm: ${databaseUrl}`);
}

function createTableStatement(metadata: ModelMetadata): string {
  const columns = metadata.fields.map((field) => {
    const parts = [
      quoteIdentifier(field.name),
      sqlTypeForField(field),
      field.primaryKey ? "PRIMARY KEY" : "",
      !field.nullable && field.defaultValue === undefined ? "NOT NULL" : "",
      field.defaultValue !== undefined ? `DEFAULT ${defaultValueSql(field)}` : ""
    ].filter(Boolean);
    return parts.join(" ");
  });

  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(metadata.table)} (${columns.join(", ")})`;
}

function createIndexStatements(metadata: ModelMetadata): string[] {
  return metadata.indices.map((index, indexPosition) => {
    const name = index.name ?? `${metadata.table}_${index.fields.join("_")}_${indexPosition}`;
    return `CREATE ${index.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${quoteIdentifier(
      name
    )} ON ${quoteIdentifier(metadata.table)} (${index.fields.map(quoteIdentifier).join(", ")})`;
  });
}

function getPrimaryKeyField(metadata: ModelMetadata): FieldMetadata {
  const primaryKeys = metadata.fields.filter((field) => field.primaryKey);
  if (primaryKeys.length !== 1) {
    throw new Error(`Model ${metadata.name} must declare exactly one primary key field`);
  }
  return primaryKeys[0];
}

function fieldMetadata(metadata: ModelMetadata, name: string): FieldMetadata {
  const field = metadata.fields.find((item) => item.name === name);
  if (!field) {
    throw new Error(`Unknown field ${name} on model ${metadata.name}`);
  }
  return field;
}

function normalizeInput<T extends object>(metadata: ModelMetadata, input: Partial<T>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const field of metadata.fields) {
    const value = input[field.name as keyof T];
    normalized[field.name] = value === undefined ? field.defaultValue ?? undefined : value;
  }
  return normalized;
}

function mapRow(metadata: ModelMetadata, row: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const field of metadata.fields) {
    mapped[field.name] = fromDatabaseValue(field, row[field.name]);
  }
  return mapped;
}

function mapProjectionRow(
  projections: ResolvedProjection[],
  row: Record<string, unknown>
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const projection of projections) {
    mapped[projection.alias] = fromDatabaseValue(projection.field, row[projection.alias]);
  }
  return mapped;
}

function materializeQueryEntity<T extends object>(
  context: SqliteOrmContext,
  model: ModelClass<T>,
  metadata: ModelMetadata,
  row: Record<string, unknown>
): T {
  const entity = new model();
  const mapped = mapRow(metadata, row);

  for (const field of metadata.fields) {
    (entity as Record<string, unknown>)[field.name] = mapped[field.name];
  }

  Object.defineProperty(entity, ENTITY_STATE, {
    value: {
      model,
      relationCache: new Map<string, LazyRelationCacheEntry>()
    } satisfies LazyEntityState<T>,
    configurable: false,
    enumerable: false,
    writable: false
  });

  for (const relation of metadata.relations) {
    if (
      relation.kind !== "belongsTo" &&
      relation.kind !== "hasMany" &&
      relation.kind !== "manyToMany"
    ) {
      continue;
    }

    Object.defineProperty(entity, relation.name, {
      configurable: true,
      enumerable: false,
      get() {
        return getOrCreateLazyRelationPromise(context, entity, model, relation.name);
      },
      set(value: unknown) {
        assignRelation(entity, relation.name, value);
      }
    });
  }

  return entity;
}

function getOrCreateLazyRelationPromise<T extends object>(
  context: SqliteOrmContext,
  entity: T,
  model: ModelClass<T>,
  relationName: string
): Promise<unknown> {
  const state = getLazyEntityState(entity);
  if (!state) {
    return Promise.resolve(readEntityValue(entity, relationName));
  }

  const cached = state.relationCache.get(relationName);
  if (cached) {
    return cached.promise;
  }

  const promise = context.loadMany(model, [entity], relationName).then(() => {
    return readLoadedRelationValue(entity, relationName);
  });

  state.relationCache.set(relationName, {
    loaded: false,
    promise,
    value: undefined
  });

  return promise;
}

function getLazyEntityState<T extends object>(entity: object): LazyEntityState<T> | undefined {
  return (entity as Record<PropertyKey, unknown>)[ENTITY_STATE] as LazyEntityState<T> | undefined;
}

function toDatabaseValue(field: FieldMetadata, value: unknown): DatabaseValue {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return null;
  }
  if (field.type === "boolean") {
    return value ? 1 : 0;
  }
  if (field.type === "json") {
    return JSON.stringify(value);
  }
  if (field.type === "number") {
    return Number(value);
  }
  return String(value);
}

function fromDatabaseValue(field: FieldMetadata, value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (field.type === "boolean") {
    return Number(value) === 1;
  }
  if (field.type === "json") {
    return JSON.parse(String(value));
  }
  return value;
}

function sqlTypeForField(field: FieldMetadata): string {
  switch (field.type) {
    case "string":
      return "TEXT";
    case "number":
      return "REAL";
    case "boolean":
      return "INTEGER";
    case "json":
      return "TEXT";
    default:
      return "TEXT";
  }
}

function defaultValueSql(field: FieldMetadata): string {
  if (field.type === "boolean") {
    return field.defaultValue ? "1" : "0";
  }
  if (field.type === "number") {
    return String(field.defaultValue);
  }
  if (field.type === "json") {
    return quoteSqlString(JSON.stringify(field.defaultValue));
  }
  return quoteSqlString(String(field.defaultValue));
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
