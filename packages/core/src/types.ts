export type ModelKind = "model";

export interface ModelOptions {
  table?: string;
}

export interface FieldOptions {
  type: string;
  nullable?: boolean;
  defaultValue?: unknown;
  validate?: (value: unknown) => true | string;
}

export interface FieldMetadata extends FieldOptions {
  name: string;
  primaryKey?: boolean;
}

export interface IndexMetadata {
  name?: string;
  fields: string[];
  unique?: boolean;
}

export interface BelongsToOptions {
  foreignKey: string;
  targetKey: string;
}

export interface HasManyOptions {
  localKey: string;
  foreignKey: string;
}

export interface HasOneRelationMetadata {
  kind: "hasOne";
  name: string;
  target: () => Function;
}

export interface ManyToManyRelationMetadata {
  kind: "manyToMany";
  name: string;
  target: () => Function;
}

export interface BelongsToRelationMetadata {
  kind: "belongsTo";
  name: string;
  target: () => Function;
  foreignKey: string;
  targetKey: string;
}

export interface HasManyRelationMetadata {
  kind: "hasMany";
  name: string;
  target: () => Function;
  localKey: string;
  foreignKey: string;
}

export type RelationMetadata =
  | HasOneRelationMetadata
  | ManyToManyRelationMetadata
  | BelongsToRelationMetadata
  | HasManyRelationMetadata;

export interface ModelMetadata {
  kind: ModelKind;
  target: Function;
  name: string;
  table: string;
  fields: FieldMetadata[];
  indices: IndexMetadata[];
  relations: RelationMetadata[];
}

export interface ValidationIssue {
  field: string;
  message: string;
}
