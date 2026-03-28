import { beforeEach, describe, expect, it } from "vitest";
import {
  Aggregate,
  BelongsTo,
  Field,
  HasMany,
  Index,
  PrimaryKey,
  Projection,
  Unique,
  clearMetadataRegistry,
  getModelMetadata,
  validateModelInput
} from "./index";

describe("@sqlmodel-ts/core", () => {
  beforeEach(() => {
    clearMetadataRegistry();
  });

  it("registers aggregate metadata with fields, indices, and relations", () => {
    @Aggregate()
    @Index(["email"])
    @Unique(["email"], "users_email_unique")
    class UserAggregate {
      @PrimaryKey()
      @Field.string()
      id!: string;

      @Field.string()
      email!: string;

      @HasMany(() => UserProjection)
      projections!: unknown[];
    }

    @Projection()
    class UserProjection {
      @PrimaryKey()
      @Field.string()
      id!: string;

      @BelongsTo(() => UserAggregate)
      aggregate!: unknown;
    }

    const metadata = getModelMetadata(UserAggregate);
    expect(metadata.kind).toBe("aggregate");
    expect(metadata.fields.map((field) => field.name)).toEqual(["id", "email"]);
    expect(metadata.indices).toHaveLength(2);
    expect(metadata.relations[0]).toMatchObject({ kind: "hasMany", name: "projections" });
  });

  it("validates DTO input using field definitions", () => {
    @Aggregate()
    class OrderAggregate {
      @PrimaryKey()
      @Field.string()
      id!: string;

      @Field.number({ validate: (value) => (value as number) > 0 || "Must be positive" })
      amount!: number;
    }

    expect(validateModelInput(OrderAggregate, { id: "ord_1", amount: 25 })).toEqual([]);
    expect(validateModelInput(OrderAggregate, { id: "ord_1", amount: -1 })).toEqual([
      { field: "amount", message: "Must be positive" }
    ]);
  });
});
