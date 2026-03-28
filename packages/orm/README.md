# @ezorm/orm

`@ezorm/orm` is the direct Node.js ORM runtime for Ezorm models, including repositories, explicit read queries, and schema push/pull helpers.

## Install

```sh
npm install @ezorm/core @ezorm/orm
```

## Usage

```ts
import { Field, Model, PrimaryKey } from "@ezorm/core";
import { createOrmClient } from "@ezorm/orm";

@Model({
  table: "todos",
  cache: {
    backend: "inherit",
    ttlSeconds: "inherit"
  }
})
class Todo {
  @PrimaryKey()
  @Field.string()
  id!: string;

  @Field.string()
  title!: string;
}

const client = await createOrmClient({
  databaseUrl: "sqlite::memory:",
  readCache: {
    default: {
      backend: "memory",
      ttlSeconds: 30
    },
    byModel: {
      Todo: {
        backend: "file",
        ttlSeconds: 300
      }
    }
  }
});
```

`readCache` is opt-in and only applies to repository reads in the direct ORM:

- `repository.findById(...)`
- `repository.findMany(...)`

TTL is absolute from write time, and `create`, `update`, and `delete` clear that model's cached repository entries.
