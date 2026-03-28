# @ezorm/core

`@ezorm/core` provides Ezorm's decorator-based model metadata, validation, indices, and relation declarations.

## Install

```sh
npm install @ezorm/core
```

## Usage

```ts
import { Field, Model, PrimaryKey } from "@ezorm/core";

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
```

`cache` is optional model metadata for the direct Node ORM read cache. Models can inherit the client default, disable caching with `backend: false`, or override the backend and `ttlSeconds` per model.
