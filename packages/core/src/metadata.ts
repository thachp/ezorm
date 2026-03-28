import type {
  FieldMetadata,
  FieldOptions,
  IndexMetadata,
  ModelKind,
  ModelMetadata,
  RelationMetadata,
  ValidationIssue
} from "./types";

const registry = new Map<Function, ModelMetadata>();

function ensureModel(target: Function, kind?: ModelKind): ModelMetadata {
  const existing = registry.get(target);
  if (existing) {
    if (kind && existing.kind !== kind && existing.kind !== "projection") {
      // `projection` is only a placeholder internal default before the class decorator runs.
      throw new Error(`Model ${target.name} is already registered as ${existing.kind}`);
    }
    if (kind) {
      existing.kind = kind;
    }
    return existing;
  }

  if (!kind) {
    const placeholder: ModelMetadata = {
      kind: "projection",
      target,
      name: target.name,
      fields: [],
      indices: [],
      relations: []
    };
    registry.set(target, placeholder);
    return placeholder;
  }

  const metadata: ModelMetadata = {
    kind,
    target,
    name: target.name,
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

function addRelation(target: object, propertyKey: string | symbol, relation: Omit<RelationMetadata, "name">): void {
  const ctor = target.constructor;
  const metadata = ensureModel(ctor);
  metadata.relations.push({
    ...relation,
    name: String(propertyKey)
  });
}

export function Aggregate(): ClassDecorator {
  return (target) => {
    ensureModel(target, "aggregate");
  };
}

export function Projection(): ClassDecorator {
  return (target) => {
    ensureModel(target, "projection");
  };
}

export function Event(): ClassDecorator {
  return (target) => {
    ensureModel(target, "event");
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

export function HasMany(targetModel: () => Function): PropertyDecorator {
  return (target, propertyKey) => addRelation(target, propertyKey, { kind: "hasMany", target: targetModel });
}

export function BelongsTo(targetModel: () => Function): PropertyDecorator {
  return (target, propertyKey) => addRelation(target, propertyKey, { kind: "belongsTo", target: targetModel });
}

export function ManyToMany(targetModel: () => Function): PropertyDecorator {
  return (target, propertyKey) => addRelation(target, propertyKey, { kind: "manyToMany", target: targetModel });
}

export function getModelMetadata(target: Function): ModelMetadata {
  return cloneMetadata(ensureModel(target));
}

export function listModelMetadata(): ModelMetadata[] {
  return [...registry.values()].map((item) => cloneMetadata(item));
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
