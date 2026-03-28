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

export interface RelationMetadata {
  kind: "hasOne" | "hasMany" | "belongsTo" | "manyToMany";
  name: string;
  target: () => Function;
}

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
