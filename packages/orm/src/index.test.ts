import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { BelongsTo, Field, HasMany, ManyToMany, Model, PrimaryKey } from "@ezorm/core";
import { createOrmClient, type QueryBuilder } from "./index";

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

  it("returns query entities as model instances for joined reads", async () => {
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

    expect(posts[0]).toBeInstanceOf(Post);
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

  it("prewarms belongs-to includes without changing the enumerable row shape", async () => {
    const { Post, User } = defineAuthorModels();
    client = await createOrmClient({ databaseUrl: "sqlite::memory:" });
    await seedAuthorModels(client, User, Post);

    const posts = await client.query(Post).include("author").orderBy("title", "asc").all();
    const firstAuthorPromise = posts[0].author;

    expect(firstAuthorPromise).toBeInstanceOf(Promise);
    expect(firstAuthorPromise).toBe(posts[0].author);
    await expect(firstAuthorPromise).resolves.toEqual({
      id: "user-1",
      email: "alice@example.com"
    });
    expect(posts).toEqual([
      { id: "post-1", userId: "user-1", title: "Alpha" },
      { id: "post-2", userId: "user-2", title: "Beta" },
      { id: "post-3", userId: "user-1", title: "Gamma" }
    ]);
    expect(Object.keys(posts[0])).toEqual(["id", "userId", "title"]);
    expect(JSON.parse(JSON.stringify(posts[0]))).toEqual({
      id: "post-1",
      userId: "user-1",
      title: "Alpha"
    });
  });

  it("prewarms has-many includes without changing the enumerable row shape", async () => {
    const { Post, User } = defineAuthorModels();
    client = await createOrmClient({ databaseUrl: "sqlite::memory:" });
    await seedAuthorModels(client, User, Post);

    const users = await client.query(User).include("posts").orderBy("email", "asc").all();

    expect(users[0].posts).toBeInstanceOf(Promise);
    await expect(users[0].posts).resolves.toEqual([
      { id: "post-1", userId: "user-1", title: "Alpha" },
      { id: "post-3", userId: "user-1", title: "Gamma" }
    ]);
    expect(users).toEqual([
      { id: "user-1", email: "alice@example.com" },
      { id: "user-2", email: "bob@example.com" }
    ]);
    expect(Object.keys(users[0])).toEqual(["id", "email"]);
  });

  it("supports implicit lazy loading for belongs-to query entities", async () => {
    const { Post, User } = defineAuthorModels();
    client = await createOrmClient({ databaseUrl: "sqlite::memory:" });
    await seedAuthorModels(client, User, Post);

    const posts = await client.query(Post).orderBy("title", "asc").all();
    const firstAuthorPromise = posts[0].author;
    const loadedAuthor = await client.load(Post, posts[0], "author");
    await client.loadMany(Post, posts, "author");

    expect(posts[0]).toBeInstanceOf(Post);
    expect(firstAuthorPromise).toBeInstanceOf(Promise);
    expect(firstAuthorPromise).toBe(posts[0].author);
    await expect(firstAuthorPromise).resolves.toEqual({
      id: "user-1",
      email: "alice@example.com"
    });
    expect(loadedAuthor).toEqual({
      id: "user-1",
      email: "alice@example.com"
    });
    await expect(Promise.all(posts.map((post) => post.author))).resolves.toEqual([
      { id: "user-1", email: "alice@example.com" },
      { id: "user-2", email: "bob@example.com" },
      { id: "user-1", email: "alice@example.com" }
    ]);
    expect(Object.keys(posts[0])).toEqual(["id", "userId", "title"]);
  });

  it("keeps explicit load and loadMany as the plain-object relation path", async () => {
    const { Post, User } = defineAuthorModels();
    client = await createOrmClient({ databaseUrl: "sqlite::memory:" });
    await seedAuthorModels(client, User, Post);

    const repository = client.repository(Post);
    const firstPost = await repository.findById("post-1");
    const plainPosts = await repository.findMany({
      orderBy: { field: "title", direction: "asc" }
    });

    expect(firstPost).toEqual({
      id: "post-1",
      userId: "user-1",
      title: "Alpha"
    });

    await expect(client.load(Post, firstPost!, "author")).resolves.toEqual({
      id: "user-1",
      email: "alice@example.com"
    });
    await client.loadMany(Post, plainPosts, "author");

    expect(firstPost).toEqual({
      id: "post-1",
      userId: "user-1",
      title: "Alpha",
      author: {
        id: "user-1",
        email: "alice@example.com"
      }
    });
    expect(plainPosts).toEqual([
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

  it("supports first, limit, and offset on entity queries", async () => {
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

  it("supports root-field select projections", async () => {
    const { Post, User } = defineAuthorModels();
    client = await createOrmClient({ databaseUrl: "sqlite::memory:" });
    await seedAuthorModels(client, User, Post);

    const rows = await client
      .query(Post)
      .select<{ id: string; title: string }>({
        id: "id",
        title: "title"
      })
      .orderBy("title", "asc")
      .all();

    expect(rows).toEqual([
      { id: "post-1", title: "Alpha" },
      { id: "post-2", title: "Beta" },
      { id: "post-3", title: "Gamma" }
    ]);
  });

  it("supports joined flat-field select projections", async () => {
    const { Post, User } = defineAuthorModels();
    client = await createOrmClient({ databaseUrl: "sqlite::memory:" });
    await seedAuthorModels(client, User, Post);

    const rows = await client
      .query(Post)
      .join("author")
      .where("author.email", "=", "alice@example.com")
      .select<{ title: string; authorEmail: string }>({
        title: "title",
        authorEmail: "author.email"
      })
      .orderBy("title", "asc")
      .all();

    expect(rows).toEqual([
      { title: "Alpha", authorEmail: "alice@example.com" },
      { title: "Gamma", authorEmail: "alice@example.com" }
    ]);
  });

  it("rejects select projections that reference unjoined relations", async () => {
    const { Post, User } = defineAuthorModels();
    client = await createOrmClient({ databaseUrl: "sqlite::memory:" });
    await seedAuthorModels(client, User, Post);

    await expect(
      client
        .query(Post)
        .select<{ authorEmail: string }>({ authorEmail: "author.email" })
        .all()
    ).rejects.toThrow("Relation author must be joined before using author.email");
  });

  it("rejects include after select projection mode", async () => {
    const { Post, User } = defineAuthorModels();
    client = await createOrmClient({ databaseUrl: "sqlite::memory:" });
    await seedAuthorModels(client, User, Post);
    const builder = client
      .query(Post)
      .select<{ title: string }>({ title: "title" }) as unknown as QueryBuilder<InstanceType<typeof Post>>;

    expect(() => builder.include("author")).toThrow("Cannot use include() on a projection query");
  });

  it("rejects select after include entity mode", async () => {
    const { Post, User } = defineAuthorModels();
    client = await createOrmClient({ databaseUrl: "sqlite::memory:" });
    await seedAuthorModels(client, User, Post);

    expect(() =>
      client!.query(Post).include("author").select<{ title: string }>({ title: "title" })
    ).toThrow("Cannot use select() on a query with include()");
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

  it("prewarms many-to-many includes without changing the enumerable row shape", async () => {
    const { Post, Tag } = defineTagModels();
    client = await createOrmClientForManyToMany();
    await seedTagModels(client, Post, Tag);

    const posts = await client.query(Post).include("tags").orderBy("title", "asc").all();

    expect(posts[0].tags).toBeInstanceOf(Promise);
    await expect(posts[0].tags).resolves.toEqual([
      { id: "tag-1", label: "orm" },
      { id: "tag-2", label: "sqlite" }
    ]);
    expect(posts).toEqual([
      { id: "post-1", title: "Alpha" },
      { id: "post-2", title: "Beta" },
      { id: "post-3", title: "Gamma" }
    ]);
  });

  it("supports implicit lazy loading for many-to-many query entities", async () => {
    const { Post, Tag } = defineTagModels();
    client = await createOrmClientForManyToMany();
    await seedTagModels(client, Post, Tag);

    const posts = await client.query(Post).orderBy("title", "asc").all();
    const firstTagsPromise = posts[0].tags;
    const loadedTags = await client.load(Post, posts[0], "tags");
    await client.loadMany(Post, posts, "tags");

    expect(firstTagsPromise).toBeInstanceOf(Promise);
    expect(firstTagsPromise).toBe(posts[0].tags);
    await expect(firstTagsPromise).resolves.toEqual([
      { id: "tag-1", label: "orm" },
      { id: "tag-2", label: "sqlite" }
    ]);
    expect(loadedTags).toEqual([
      { id: "tag-1", label: "orm" },
      { id: "tag-2", label: "sqlite" }
    ]);
    await expect(Promise.all(posts.map((post) => post.tags))).resolves.toEqual([
      [
        { id: "tag-1", label: "orm" },
        { id: "tag-2", label: "sqlite" }
      ],
      [{ id: "tag-1", label: "orm" }],
      [{ id: "tag-3", label: "docs" }]
    ]);
    expect(Object.keys(posts[0])).toEqual(["id", "title"]);
  });

  it("supports first, limit, and offset on many-to-many entity queries", async () => {
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

  it("supports select projections on many-to-many joins", async () => {
    const { Post, Tag } = defineTagModels();
    client = await createOrmClientForManyToMany();
    await seedTagModels(client, Post, Tag);

    await expect(
      client
        .query(Post)
        .join("tags")
        .select<{ id: string }>({ id: "id" })
        .orderBy("title", "asc")
        .offset(1)
        .limit(1)
        .all()
    ).resolves.toEqual([{ id: "post-2" }]);

    await expect(
      client
        .query(Post)
        .join("tags")
        .where("tags.label", "=", "docs")
        .select<{ id: string; tagLabel: string }>({
          id: "id",
          tagLabel: "tags.label"
        })
        .first()
    ).resolves.toEqual({ id: "post-3", tagLabel: "docs" });
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
