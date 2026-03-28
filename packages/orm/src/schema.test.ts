import { describe, expect, it } from "vitest";
import { Field, Index, Model, PrimaryKey } from "@ezorm/core";
import { deriveModelSchemas, planSchemaDiff } from "./schema";

describe("schema helpers", () => {
  it("derives table and index schema from models", () => {
    @Model({ table: "todos" })
    @Index(["title"], { name: "todos_title_idx" })
    class Todo {
      @PrimaryKey()
      @Field.string()
      id!: string;

      @Field.string()
      title!: string;
    }

    expect(deriveModelSchemas("sqlite", [Todo])).toEqual([
      {
        name: "todos",
        columns: [
          { name: "id", type: "TEXT", notNull: true, primaryKey: true, defaultValue: undefined },
          { name: "title", type: "TEXT", notNull: true, primaryKey: false, defaultValue: undefined }
        ],
        indices: [
          {
            name: "todos_title_idx",
            columns: ["title"],
            unique: false
          }
        ]
      }
    ]);
  });

  it("plans additive table, column, and index changes", () => {
    @Model({ table: "todos" })
    @Index(["title"], { name: "todos_title_idx" })
    class Todo {
      @PrimaryKey()
      @Field.string()
      id!: string;

      @Field.string()
      title!: string;
    }

    const desired = deriveModelSchemas("sqlite", [Todo]);
    const createTablePlan = planSchemaDiff("sqlite", desired, []);
    expect(createTablePlan.safeStatements).toEqual([
      'CREATE TABLE IF NOT EXISTS "todos" ("id" TEXT PRIMARY KEY NOT NULL, "title" TEXT NOT NULL)',
      'CREATE INDEX IF NOT EXISTS "todos_title_idx" ON "todos" ("title")'
    ]);
    expect(createTablePlan.blockedChanges).toEqual([]);

    const addColumnPlan = planSchemaDiff("sqlite", desired, [
      {
        name: "todos",
        columns: [{ name: "id", type: "TEXT", notNull: true, primaryKey: true }],
        indices: []
      }
    ]);
    expect(addColumnPlan.safeStatements).toEqual([
      'ALTER TABLE "todos" ADD COLUMN "title" TEXT NOT NULL',
      'CREATE INDEX IF NOT EXISTS "todos_title_idx" ON "todos" ("title")'
    ]);
    expect(addColumnPlan.blockedChanges).toEqual([]);
  });

  it("fails fast when a model has no fields", () => {
    @Model({ table: "todos" })
    class Todo {}

    expect(() => deriveModelSchemas("sqlite", [Todo])).toThrow(
      "Model Todo for table todos must declare at least one field"
    );
  });

  it("fails fast when a model does not declare exactly one primary key field", () => {
    @Model({ table: "todos" })
    class Todo {
      @Field.string()
      title!: string;
    }

    expect(() => deriveModelSchemas("sqlite", [Todo])).toThrow(
      "Model Todo for table todos must declare exactly one primary key field, found 0"
    );
  });

  it("blocks destructive drift on managed tables", () => {
    @Model({ table: "todos" })
    class Todo {
      @PrimaryKey()
      @Field.string()
      id!: string;
    }

    const desired = deriveModelSchemas("sqlite", [Todo]);
    const plan = planSchemaDiff("sqlite", desired, [
      {
        name: "todos",
        columns: [
          { name: "id", type: "TEXT", notNull: true, primaryKey: true },
          { name: "title", type: "TEXT", notNull: true, primaryKey: false }
        ],
        indices: [
          {
            name: "todos_title_idx",
            columns: ["title"],
            unique: false
          }
        ]
      }
    ]);

    expect(plan.safeStatements).toEqual([]);
    expect(plan.blockedChanges).toEqual([
      "Column todos.title exists in the database but not in the model",
      "Index todos_title_idx exists on todos but not in the model"
    ]);
  });
});
