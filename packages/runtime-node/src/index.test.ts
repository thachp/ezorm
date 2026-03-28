import { afterEach, describe, expect, it } from "vitest";
import { Field, Model, PrimaryKey } from "@ezorm/core";
import { createNodeRuntime } from "./index";

describe("@ezorm/runtime-node", () => {
  let runtime: Awaited<ReturnType<typeof createNodeRuntime>> | undefined;

  afterEach(async () => {
    await runtime?.close();
    runtime = undefined;
  });

  it("creates a SQL-backed ORM client when a database url is supplied", async () => {
    @Model({ table: "users" })
    class User {
      @PrimaryKey()
      @Field.string()
      id!: string;

      @Field.string()
      email!: string;
    }

    runtime = await createNodeRuntime({
      connect: { databaseUrl: "sqlite::memory:" }
    });

    const repository = runtime.repository(User);
    await runtime.pushSchema([User]);
    await repository.create({ id: "usr_1", email: "alice@example.com" });

    await expect(repository.findById("usr_1")).resolves.toEqual({
      id: "usr_1",
      email: "alice@example.com"
    });
  });

  it("defaults to an in-memory sqlite runtime", async () => {
    @Model({ table: "defaults" })
    class DefaultRecord {
      @PrimaryKey()
      @Field.string()
      id!: string;
    }

    runtime = await createNodeRuntime();
    await runtime.pushSchema([DefaultRecord]);

    await expect(
      runtime.repository(DefaultRecord).create({ id: "default_1" })
    ).resolves.toEqual({ id: "default_1" });
  });

  it("accepts relational database urls handled by @ezorm/orm", async () => {
    const databaseUrl =
      process.env.EZORM_TEST_POSTGRES_URL ??
      process.env.EZORM_TEST_MYSQL_URL ??
      process.env.EZORM_TEST_MSSQL_URL;

    if (!databaseUrl) {
      return;
    }

    runtime = await createNodeRuntime({
      connect: { databaseUrl }
    });

    expect(runtime).toBeDefined();
  });
});
