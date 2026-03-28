import { beforeEach, describe, expect, it } from "vitest";
import {
  BelongsTo,
  Field,
  HasMany,
  Index,
  Model,
  PrimaryKey,
  Unique,
  clearMetadataRegistry,
  getModelMetadata,
  validateModelInput
} from "./index";

describe("@sqlmodel/core", () => {
  beforeEach(() => {
    clearMetadataRegistry();
  });

  it("registers model metadata with fields, indices, relations, and a resolved table name", () => {
    @Model({ table: "users" })
    @Index(["email"])
    @Unique(["email"], "users_email_unique")
    class User {
      @PrimaryKey()
      @Field.string()
      id!: string;

      @Field.string()
      email!: string;

      @HasMany(() => UserProfile)
      profiles!: unknown[];
    }

    @Model()
    class UserProfile {
      @PrimaryKey()
      @Field.string()
      id!: string;

      @BelongsTo(() => User)
      user!: unknown;
    }

    const metadata = getModelMetadata(User);
    expect(metadata.kind).toBe("model");
    expect(metadata.table).toBe("users");
    expect(metadata.fields.map((field) => field.name)).toEqual(["id", "email"]);
    expect(metadata.indices).toHaveLength(2);
    expect(metadata.relations[0]).toMatchObject({ kind: "hasMany", name: "profiles" });
  });

  it("validates DTO input using field definitions", () => {
    @Model()
    class Order {
      @PrimaryKey()
      @Field.string()
      id!: string;

      @Field.number({ validate: (value) => (value as number) > 0 || "Must be positive" })
      amount!: number;
    }

    expect(validateModelInput(Order, { id: "ord_1", amount: 25 })).toEqual([]);
    expect(validateModelInput(Order, { id: "ord_1", amount: -1 })).toEqual([
      { field: "amount", message: "Must be positive" }
    ]);
  });
});
