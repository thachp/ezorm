import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BelongsTo,
  Field,
  HasMany,
  Index,
  ManyToMany,
  Model,
  PrimaryKey,
  Unique,
  clearMetadataRegistry,
  getModelMetadata,
  validateModelInput
} from "./index";

describe("@ezorm/core", () => {
  beforeEach(() => {
    clearMetadataRegistry();
  });

  afterEach(() => {
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

      @HasMany(() => UserProfile, { localKey: "id", foreignKey: "userId" })
      profiles!: unknown[];
    }

    @Model()
    class UserProfile {
      @PrimaryKey()
      @Field.string()
      id!: string;

      @Field.string()
      userId!: string;

      @BelongsTo(() => User, { foreignKey: "userId", targetKey: "id" })
      user!: unknown;
    }

    const metadata = getModelMetadata(User);
    expect(metadata.kind).toBe("model");
    expect(metadata.table).toBe("users");
    expect(metadata.cache).toEqual({
      backend: "inherit",
      ttlSeconds: "inherit"
    });
    expect(metadata.fields.map((field) => field.name)).toEqual(["id", "email"]);
    expect(metadata.indices).toHaveLength(2);
    expect(metadata.relations[0]).toMatchObject({
      kind: "hasMany",
      name: "profiles",
      localKey: "id",
      foreignKey: "userId"
    });
  });

  it("fails fast when relation keys point at unknown fields", () => {
    @Model()
    class User {
      @PrimaryKey()
      @Field.string()
      id!: string;
    }

    @Model()
    class Comment {
      @PrimaryKey()
      @Field.string()
      id!: string;

      @BelongsTo(() => User, { foreignKey: "authorId", targetKey: "id" })
      author!: unknown;
    }

    expect(() => getModelMetadata(Comment)).toThrow("Unknown field authorId on model Comment");
  });

  it("stores many-to-many metadata with explicit through-table keys", () => {
    @Model({ table: "posts" })
    class Post {
      @PrimaryKey()
      @Field.string()
      id!: string;

      @ManyToMany(() => Tag, {
        throughTable: "post_tags",
        sourceKey: "id",
        throughSourceKey: "post_id",
        targetKey: "id",
        throughTargetKey: "tag_id"
      })
      tags!: unknown[];
    }

    @Model({ table: "tags" })
    class Tag {
      @PrimaryKey()
      @Field.string()
      id!: string;
    }

    const metadata = getModelMetadata(Post);
    expect(metadata.relations[0]).toMatchObject({
      kind: "manyToMany",
      name: "tags",
      throughTable: "post_tags",
      sourceKey: "id",
      throughSourceKey: "post_id",
      targetKey: "id",
      throughTargetKey: "tag_id"
    });
  });

  it("fails fast when many-to-many keys point at unknown fields", () => {
    @Model()
    class Tag {
      @PrimaryKey()
      @Field.string()
      id!: string;
    }

    @Model()
    class Post {
      @PrimaryKey()
      @Field.string()
      id!: string;

      @ManyToMany(() => Tag, {
        throughTable: "post_tags",
        sourceKey: "postId",
        throughSourceKey: "post_id",
        targetKey: "id",
        throughTargetKey: "tag_id"
      })
      tags!: unknown[];
    }

    expect(() => getModelMetadata(Post)).toThrow("Unknown field postId on model Post");
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

  it("stores explicit cache metadata on models", () => {
    @Model({
      cache: {
        backend: "file",
        ttlSeconds: 60
      }
    })
    class AuditLog {
      @PrimaryKey()
      @Field.string()
      id!: string;
    }

    expect(getModelMetadata(AuditLog).cache).toEqual({
      backend: "file",
      ttlSeconds: 60
    });
  });

  it("rejects invalid model cache ttl values", () => {
    @Model({
      cache: {
        ttlSeconds: 0
      }
    })
    class CachedModel {
      @PrimaryKey()
      @Field.string()
      id!: string;
    }

    expect(() => getModelMetadata(CachedModel)).toThrow(
      "Model CachedModel cache ttlSeconds must be a positive integer"
    );
  });
});
