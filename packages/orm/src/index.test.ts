import { afterEach, describe, expect, it } from "vitest";
import { BelongsTo, Field, HasMany, Model, PrimaryKey } from "@ezorm/core";
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

  it("joins belongs-to relations for filtering and ordering", async () => {
    const { Post, User } = defineAuthorModels();
    client = await createOrmClient({ databaseUrl: "sqlite::memory:" });
    await seedAuthorModels(client, User, Post);

    const posts = await client
      .query(Post)
      .join("author")
      .where("author.email", "=", "alice@example.com")
      .orderBy("author.email", "asc")
      .orderBy("title", "asc")
      .all();

    expect(posts).toEqual([
      {
        id: "post-1",
        userId: "user-1",
        title: "Alpha"
      },
      {
        id: "post-3",
        userId: "user-1",
        title: "Gamma"
      }
    ]);
  });

  it("hydrates belongs-to includes without changing the base row shape", async () => {
    const { Post, User } = defineAuthorModels();
    client = await createOrmClient({ databaseUrl: "sqlite::memory:" });
    await seedAuthorModels(client, User, Post);

    const posts = await client.query(Post).include("author").orderBy("title", "asc").all();

    expect(posts).toEqual([
      {
        id: "post-1",
        userId: "user-1",
        title: "Alpha",
        author: {
          id: "user-1",
          email: "alice@example.com"
        }
      },
      {
        id: "post-2",
        userId: "user-2",
        title: "Beta",
        author: {
          id: "user-2",
          email: "bob@example.com"
        }
      },
      {
        id: "post-3",
        userId: "user-1",
        title: "Gamma",
        author: {
          id: "user-1",
          email: "alice@example.com"
        }
      }
    ]);
  });

  it("hydrates has-many includes without duplicating the base rows", async () => {
    const { Post, User } = defineAuthorModels();
    client = await createOrmClient({ databaseUrl: "sqlite::memory:" });
    await seedAuthorModels(client, User, Post);

    const users = await client.query(User).include("posts").orderBy("email", "asc").all();

    expect(users).toEqual([
      {
        id: "user-1",
        email: "alice@example.com",
        posts: [
          { id: "post-1", userId: "user-1", title: "Alpha" },
          { id: "post-3", userId: "user-1", title: "Gamma" }
        ]
      },
      {
        id: "user-2",
        email: "bob@example.com",
        posts: [{ id: "post-2", userId: "user-2", title: "Beta" }]
      }
    ]);
  });

  it("supports explicit lazy loading for single entities and batches", async () => {
    const { Post, User } = defineAuthorModels();
    client = await createOrmClient({ databaseUrl: "sqlite::memory:" });
    await seedAuthorModels(client, User, Post);

    const posts = await client.query(Post).orderBy("title", "asc").all();
    const firstAuthor = await client.load(Post, posts[0], "author");
    await client.loadMany(Post, posts, "author");

    expect(firstAuthor).toEqual({
      id: "user-1",
      email: "alice@example.com"
    });
    expect(posts).toEqual([
      {
        id: "post-1",
        userId: "user-1",
        title: "Alpha",
        author: {
          id: "user-1",
          email: "alice@example.com"
        }
      },
      {
        id: "post-2",
        userId: "user-2",
        title: "Beta",
        author: {
          id: "user-2",
          email: "bob@example.com"
        }
      },
      {
        id: "post-3",
        userId: "user-1",
        title: "Gamma",
        author: {
          id: "user-1",
          email: "alice@example.com"
        }
      }
    ]);
  });

  it("supports first, limit, and offset on the read builder", async () => {
    const { Post, User } = defineAuthorModels();
    client = await createOrmClient({ databaseUrl: "sqlite::memory:" });
    await seedAuthorModels(client, User, Post);

    await expect(
      client.query(Post).orderBy("title", "asc").offset(1).limit(1).all()
    ).resolves.toEqual([
      {
        id: "post-2",
        userId: "user-2",
        title: "Beta"
      }
    ]);

    await expect(client.query(Post).where("title", "=", "Missing").first()).resolves.toBeUndefined();
  });
});

function defineAuthorModels() {
  @Model({ table: "users" })
  class User {
    @PrimaryKey()
    @Field.string()
    id!: string;

    @Field.string()
    email!: string;

    @HasMany(() => Post, { localKey: "id", foreignKey: "userId" })
    posts!: Post[];
  }

  @Model({ table: "posts" })
  class Post {
    @PrimaryKey()
    @Field.string()
    id!: string;

    @Field.string()
    userId!: string;

    @Field.string()
    title!: string;

    @BelongsTo(() => User, { foreignKey: "userId", targetKey: "id" })
    author!: User | undefined;
  }

  return { User, Post };
}

async function seedAuthorModels(
  client: Awaited<ReturnType<typeof createOrmClient>>,
  User: ReturnType<typeof defineAuthorModels>["User"],
  Post: ReturnType<typeof defineAuthorModels>["Post"]
): Promise<void> {
  await client.pushSchema([User, Post]);

  const userRepository = client.repository(User);
  const postRepository = client.repository(Post);

  await userRepository.create({ id: "user-1", email: "alice@example.com", posts: [] });
  await userRepository.create({ id: "user-2", email: "bob@example.com", posts: [] });

  await postRepository.create({
    id: "post-1",
    userId: "user-1",
    title: "Alpha",
    author: undefined
  });
  await postRepository.create({
    id: "post-2",
    userId: "user-2",
    title: "Beta",
    author: undefined
  });
  await postRepository.create({
    id: "post-3",
    userId: "user-1",
    title: "Gamma",
    author: undefined
  });
}
