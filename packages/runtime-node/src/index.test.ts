import { afterEach, describe, expect, it } from "vitest";
import { Field, Model, PrimaryKey } from "@sqlmodel/core";
import { createNodeRuntime, detectNativeTargetTriple } from "./index";

describe("@sqlmodel/runtime-node", () => {
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

  it("maps supported platforms to packaged target triples", () => {
    expect(detectNativeTargetTriple("darwin", "arm64")).toBe("aarch64-apple-darwin");
    expect(detectNativeTargetTriple("linux", "x64")).toBe("x86_64-unknown-linux-gnu");
  });

  it("fails fast on unsupported packaged targets", () => {
    expect(() => detectNativeTargetTriple("freebsd", "x64")).toThrow(
      "Unsupported native target for sqlmodel: freebsd/x64"
    );
  });
});
