import { afterEach, describe, expect, it } from "vitest";
import { Field, Model, PrimaryKey } from "@ezorm/core";
import { createOrmClient } from "./index";

describe("@ezorm/orm", () => {
  let client: Awaited<ReturnType<typeof createOrmClient>> | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it("supports SQL-backed repository CRUD and ordered reads", async () => {
    @Model({ table: "todos" })
    class Todo {
      @PrimaryKey()
      @Field.string()
      id!: string;

      @Field.string()
      title!: string;

      @Field.boolean({ defaultValue: false })
      completed!: boolean;
    }

    client = await createOrmClient({ databaseUrl: "sqlite::memory:" });
    const repository = client.repository(Todo);

    await repository.create({ id: "todo-1", title: "Ship ORM", completed: false });
    await repository.create({ id: "todo-2", title: "Add tests", completed: true });

    await expect(repository.findById("todo-1")).resolves.toEqual({
      id: "todo-1",
      title: "Ship ORM",
      completed: false
    });

    await expect(
      repository.findMany({
        where: { completed: false },
        orderBy: { field: "title", direction: "asc" }
      })
    ).resolves.toEqual([
      {
        id: "todo-1",
        title: "Ship ORM",
        completed: false
      }
    ]);

    await expect(repository.update("todo-1", { completed: true })).resolves.toEqual({
      id: "todo-1",
      title: "Ship ORM",
      completed: true
    });

    await repository.delete("todo-2");
    await expect(repository.findById("todo-2")).resolves.toBeUndefined();
  });

  it("introspects pushed model tables", async () => {
    @Model({ table: "accounts" })
    class Account {
      @PrimaryKey()
      @Field.string()
      id!: string;

      @Field.number()
      balance!: number;
    }

    client = await createOrmClient({ databaseUrl: "sqlite::memory:" });
    const push = await client.pushSchema([Account]);
    const schema = await client.pullSchema();

    expect(push.statements[0]).toContain("CREATE TABLE IF NOT EXISTS");
    expect(schema).toEqual([
      {
        name: "accounts",
        columns: [
          { name: "id", type: "TEXT", notNull: true, primaryKey: true },
          { name: "balance", type: "REAL", notNull: true, primaryKey: false }
        ]
      }
    ]);
  });
});
