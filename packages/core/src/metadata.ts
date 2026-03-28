import type {
  BelongsToOptions,
  BelongsToRelationMetadata,
  FieldMetadata,
  FieldOptions,
  HasManyRelationMetadata,
  HasOneRelationMetadata,
  HasManyOptions,
  IndexMetadata,
  ManyToManyOptions,
  ManyToManyRelationMetadata,
  ModelOptions,
  ModelKind,
  ModelMetadata,
  RelationMetadata,
  ValidationIssue
} from "./types.js";

const REGISTRY_KEY = Symbol.for("ezorm.modelMetadataRegistry");
const registry = getRegistry();
type PendingRelation =
  | Omit<HasOneRelationMetadata, "name">
  | Omit<ManyToManyRelationMetadata, "name">
  | Omit<BelongsToRelationMetadata, "name">
  | Omit<HasManyRelationMetadata, "name">;

function getRegistry(): Map<Function, ModelMetadata> {
  const globalStore = globalThis as typeof globalThis & Record<symbol, unknown>;
  const existing = globalStore[REGISTRY_KEY];
  if (existing instanceof Map) {
    return existing as Map<Function, ModelMetadata>;
  }

  const metadataRegistry = new Map<Function, ModelMetadata>();
  globalStore[REGISTRY_KEY] = metadataRegistry;
  return metadataRegistry;
}

function ensureModel(target: Function, options?: { kind?: ModelKind; table?: string }): ModelMetadata {
  const existing = registry.get(target);
  if (existing) {
    existing.kind = options?.kind ?? existing.kind;
    existing.table = options?.table ?? existing.table;
    return existing;
  }

  const metadata: ModelMetadata = {
    kind: options?.kind ?? "model",
    target,
    name: target.name,
    table: options?.table ?? defaultTableName(target.name),
    fields: [],
    indices: [],
    relations: []
  };
  registry.set(target, metadata);
  return metadata;
}

function addField(target: object, propertyKey: string | symbol, field: Partial<FieldMetadata>): void {
  const ctor = target.constructor;
  const metadata = ensureModel(ctor);
  const name = String(propertyKey);
  const existing = metadata.fields.find((item) => item.name === name);
  if (existing) {
    Object.assign(existing, field);
    return;
  }
  metadata.fields.push({
    name,
    type: "unknown",
    ...field
  });
}

function addRelation(target: object, propertyKey: string | symbol, relation: PendingRelation): void {
  const ctor = target.constructor;
  const metadata = ensureModel(ctor);
  metadata.relations.push({
    ...relation,
    name: String(propertyKey)
  });
}

export function Model(options: ModelOptions = {}): ClassDecorator {
  return (target) => {
    ensureModel(target, { kind: "model", table: options.table ?? defaultTableName(target.name) });
  };
}

export function Field(options: FieldOptions): PropertyDecorator {
  return (target, propertyKey) => {
    addField(target, propertyKey, options);
  };
}

Field.string = (options: Omit<FieldOptions, "type"> = {}): PropertyDecorator =>
  Field({ type: "string", ...options });
Field.number = (options: Omit<FieldOptions, "type"> = {}): PropertyDecorator =>
  Field({ type: "number", ...options });
Field.boolean = (options: Omit<FieldOptions, "type"> = {}): PropertyDecorator =>
  Field({ type: "boolean", ...options });
Field.json = (options: Omit<FieldOptions, "type"> = {}): PropertyDecorator =>
  Field({ type: "json", ...options });

export namespace Field {
  export let string: (options?: Omit<FieldOptions, "type">) => PropertyDecorator;
  export let number: (options?: Omit<FieldOptions, "type">) => PropertyDecorator;
  export let boolean: (options?: Omit<FieldOptions, "type">) => PropertyDecorator;
  export let json: (options?: Omit<FieldOptions, "type">) => PropertyDecorator;
}

export function PrimaryKey(): PropertyDecorator {
  return (target, propertyKey) => {
    addField(target, propertyKey, { primaryKey: true });
  };
}

function addIndex(target: Function, index: IndexMetadata): void {
  const metadata = ensureModel(target);
  metadata.indices.push(index);
}

export function Index(fields: string[], options: { name?: string; unique?: boolean } = {}): ClassDecorator {
  return (target) => addIndex(target, { fields, ...options });
}

export function Unique(fields: string[], name?: string): ClassDecorator {
  return Index(fields, { name, unique: true });
}

export function HasOne(targetModel: () => Function): PropertyDecorator {
  return (target, propertyKey) => addRelation(target, propertyKey, { kind: "hasOne", target: targetModel });
}

export function HasMany(targetModel: () => Function, options: HasManyOptions): PropertyDecorator {
  return (target, propertyKey) =>
    addRelation(target, propertyKey, {
      kind: "hasMany",
      target: targetModel,
      localKey: options.localKey,
      foreignKey: options.foreignKey
    });
}

export function BelongsTo(targetModel: () => Function, options: BelongsToOptions): PropertyDecorator {
  return (target, propertyKey) =>
    addRelation(target, propertyKey, {
      kind: "belongsTo",
      target: targetModel,
      foreignKey: options.foreignKey,
      targetKey: options.targetKey
    });
}

export function ManyToMany(
  targetModel: () => Function,
  options: ManyToManyOptions
): PropertyDecorator {
  return (target, propertyKey) =>
    addRelation(target, propertyKey, {
      kind: "manyToMany",
      target: targetModel,
      throughTable: options.throughTable,
      sourceKey: options.sourceKey,
      throughSourceKey: options.throughSourceKey,
      targetKey: options.targetKey,
      throughTargetKey: options.throughTargetKey
    });
}

export function getModelMetadata(target: Function): ModelMetadata {
  const metadata = ensureModel(target);
  validateModelMetadata(metadata);
  return cloneMetadata(metadata);
}

export function listModelMetadata(): ModelMetadata[] {
  return [...registry.values()].map((item) => {
    validateModelMetadata(item);
    return cloneMetadata(item);
  });
}

export function clearMetadataRegistry(): void {
  registry.clear();
}

export function validateModelInput(target: Function, input: Record<string, unknown>): ValidationIssue[] {
  const metadata = ensureModel(target);
  const issues: ValidationIssue[] = [];

  for (const field of metadata.fields) {
    const value = input[field.name];

    if (value === undefined) {
      if (!field.nullable && field.defaultValue === undefined) {
        issues.push({ field: field.name, message: "Field is required" });
      }
      continue;
    }

    if (value === null && !field.nullable) {
      issues.push({ field: field.name, message: "Field cannot be null" });
      continue;
    }

    if (value === null) {
      continue;
    }

    if (field.type === "string" && typeof value !== "string") {
      issues.push({ field: field.name, message: "Expected string" });
    } else if (field.type === "number" && typeof value !== "number") {
      issues.push({ field: field.name, message: "Expected number" });
    } else if (field.type === "boolean" && typeof value !== "boolean") {
      issues.push({ field: field.name, message: "Expected boolean" });
    }

    if (field.validate) {
      const result = field.validate(value);
      if (result !== true) {
        issues.push({ field: field.name, message: result });
      }
    }
  }

  return issues;
}

function cloneMetadata(value: ModelMetadata): ModelMetadata {
  return {
    ...value,
    fields: value.fields.map((field) => ({ ...field })),
    indices: value.indices.map((index) => ({ ...index, fields: [...index.fields] })),
    relations: value.relations.map((relation) => ({ ...relation }))
  };
}

function validateModelMetadata(metadata: ModelMetadata, visited = new Set<Function>()): void {
  if (visited.has(metadata.target)) {
    return;
  }

  visited.add(metadata.target);

  for (const relation of metadata.relations) {
    switch (relation.kind) {
      case "belongsTo": {
        fieldMetadata(metadata, relation.foreignKey);
        const targetMetadata = ensureModel(relation.target());
        fieldMetadata(targetMetadata, relation.targetKey);
        validateModelMetadata(targetMetadata, visited);
        break;
      }
      case "hasMany": {
        fieldMetadata(metadata, relation.localKey);
        const targetMetadata = ensureModel(relation.target());
        fieldMetadata(targetMetadata, relation.foreignKey);
        validateModelMetadata(targetMetadata, visited);
        break;
      }
      case "manyToMany": {
        fieldMetadata(metadata, relation.sourceKey);
        const targetMetadata = ensureModel(relation.target());
        fieldMetadata(targetMetadata, relation.targetKey);
        requireIdentifier(relation.throughTable, "through table");
        requireIdentifier(relation.throughSourceKey, "through source key");
        requireIdentifier(relation.throughTargetKey, "through target key");
        validateModelMetadata(targetMetadata, visited);
        break;
      }
      default:
        validateModelMetadata(ensureModel(relation.target()), visited);
    }
  }
}

function fieldMetadata(metadata: ModelMetadata, name: string): FieldMetadata {
  const field = metadata.fields.find((item) => item.name === name);
  if (!field) {
    throw new Error(`Unknown field ${name} on model ${metadata.name}`);
  }
  return field;
}

function defaultTableName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/\s+/g, "_")
    .toLowerCase();
}

function requireIdentifier(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`Relation ${label} is required`);
  }
}
