import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { BelongsTo, Field, HasMany, ManyToMany, Model, PrimaryKey } from "@ezorm/core";
import { createOrmClient } from "./index";

let tempDirectory: string | undefined;

describe("@ezorm/orm", () => {
  let client: Awaited<ReturnType<typeof createOrmClient>> | undefined;

  afterEach(async () => {
    await client?.close();
    if (tempDirectory) {
      await rm(tempDirectory, { recursive: true, force: true });
      tempDirectory = undefined;
    }
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

  it("creates many-to-many join tables during schema push", async () => {
    const { Post, Tag } = defineTagModels();
    client = await createOrmClient({ databaseUrl: "sqlite::memory:" });

    const push = await client.pushSchema([Post, Tag]);
    const schema = await client.pullSchema();

    expect(push.statements).toEqual(
      expect.arrayContaining([
        expect.stringContaining('CREATE TABLE IF NOT EXISTS "post_tags"'),
        expect.stringContaining('CREATE UNIQUE INDEX IF NOT EXISTS "post_tags_post_id_tag_id_unique"')
      ])
    );
    expect(schema).toEqual(
      expect.arrayContaining([
        {
          name: "post_tags",
          columns: [
            { name: "post_id", type: "TEXT", notNull: true, primaryKey: false },
            { name: "tag_id", type: "TEXT", notNull: true, primaryKey: false }
          ]
        }
      ])
    );
  });

  it("joins many-to-many relations for filtering, ordering, and distinct base rows", async () => {
    const { Post, Tag } = defineTagModels();
    client = await createOrmClientForManyToMany();
    await seedTagModels(client, Post, Tag);

    const posts = await client
      .query(Post)
      .join("tags")
      .where("tags.label", "like", "orm%")
      .orderBy("title", "asc")
      .all();

    expect(posts).toEqual([
      { id: "post-1", title: "Alpha" },
      { id: "post-2", title: "Beta" }
    ]);
  });

  it("hydrates many-to-many includes without duplicating the base rows", async () => {
    const { Post, Tag } = defineTagModels();
    client = await createOrmClientForManyToMany();
    await seedTagModels(client, Post, Tag);

    const posts = await client.query(Post).include("tags").orderBy("title", "asc").all();

    expect(posts).toEqual([
      {
        id: "post-1",
        title: "Alpha",
        tags: [
          { id: "tag-1", label: "orm" },
          { id: "tag-2", label: "sqlite" }
        ]
      },
      {
        id: "post-2",
        title: "Beta",
        tags: [{ id: "tag-1", label: "orm" }]
      },
      {
        id: "post-3",
        title: "Gamma",
        tags: [{ id: "tag-3", label: "docs" }]
      }
    ]);
  });

  it("supports explicit lazy loading for many-to-many relations", async () => {
    const { Post, Tag } = defineTagModels();
    client = await createOrmClientForManyToMany();
    await seedTagModels(client, Post, Tag);

    const posts = await client.query(Post).orderBy("title", "asc").all();
    const firstTags = await client.load(Post, posts[0], "tags");
    await client.loadMany(Post, posts, "tags");

    expect(firstTags).toEqual([
      { id: "tag-1", label: "orm" },
      { id: "tag-2", label: "sqlite" }
    ]);
    expect(posts).toEqual([
      {
        id: "post-1",
        title: "Alpha",
        tags: [
          { id: "tag-1", label: "orm" },
          { id: "tag-2", label: "sqlite" }
        ]
      },
      {
        id: "post-2",
        title: "Beta",
        tags: [{ id: "tag-1", label: "orm" }]
      },
      {
        id: "post-3",
        title: "Gamma",
        tags: [{ id: "tag-3", label: "docs" }]
      }
    ]);
  });

  it("supports first, limit, and offset on many-to-many joins", async () => {
    const { Post, Tag } = defineTagModels();
    client = await createOrmClientForManyToMany();
    await seedTagModels(client, Post, Tag);

    await expect(
      client.query(Post).join("tags").orderBy("title", "asc").offset(1).limit(1).all()
    ).resolves.toEqual([{ id: "post-2", title: "Beta" }]);

    await expect(
      client.query(Post).join("tags").where("tags.label", "=", "docs").first()
    ).resolves.toEqual({ id: "post-3", title: "Gamma" });
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

function defineTagModels() {
  @Model({ table: "posts" })
  class Post {
    @PrimaryKey()
    @Field.string()
    id!: string;

    @Field.string()
    title!: string;

    @ManyToMany(() => Tag, {
      throughTable: "post_tags",
      sourceKey: "id",
      throughSourceKey: "post_id",
      targetKey: "id",
      throughTargetKey: "tag_id"
    })
    tags!: Tag[];
  }

  @Model({ table: "tags" })
  class Tag {
    @PrimaryKey()
    @Field.string()
    id!: string;

    @Field.string()
    label!: string;
  }

  return { Post, Tag };
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

async function createOrmClientForManyToMany() {
  const directory = await mkdtemp(join(tmpdir(), "ezorm-many-to-many-"));
  tempDirectory = directory;
  return createOrmClient({
    databaseUrl: `sqlite://${join(directory, "test.sqlite")}`
  });
}

async function seedTagModels(
  client: Awaited<ReturnType<typeof createOrmClient>>,
  Post: ReturnType<typeof defineTagModels>["Post"],
  Tag: ReturnType<typeof defineTagModels>["Tag"]
): Promise<void> {
  await client.pushSchema([Post, Tag]);

  const postRepository = client.repository(Post);
  const tagRepository = client.repository(Tag);

  await postRepository.create({ id: "post-1", title: "Alpha", tags: [] });
  await postRepository.create({ id: "post-2", title: "Beta", tags: [] });
  await postRepository.create({ id: "post-3", title: "Gamma", tags: [] });

  await tagRepository.create({ id: "tag-1", label: "orm" });
  await tagRepository.create({ id: "tag-2", label: "sqlite" });
  await tagRepository.create({ id: "tag-3", label: "docs" });

  if (!tempDirectory) {
    throw new Error("Expected temporary database directory to exist");
  }

  const database = new DatabaseSync(join(tempDirectory, "test.sqlite"));
  try {
    database
      .prepare('INSERT INTO "post_tags" ("post_id", "tag_id") VALUES (?, ?)')
      .run("post-1", "tag-1");
    database
      .prepare('INSERT INTO "post_tags" ("post_id", "tag_id") VALUES (?, ?)')
      .run("post-1", "tag-2");
    database
      .prepare('INSERT INTO "post_tags" ("post_id", "tag_id") VALUES (?, ?)')
      .run("post-2", "tag-1");
    database
      .prepare('INSERT INTO "post_tags" ("post_id", "tag_id") VALUES (?, ?)')
      .run("post-3", "tag-3");
  } finally {
    database.close();
  }
}
