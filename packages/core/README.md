# @ezorm/core

`@ezorm/core` provides Ezorm's decorator-based model metadata, validation, indices, and relation declarations.

## Install

```sh
npm install @ezorm/core
```

## Usage

```ts
import { Field, Model, PrimaryKey } from "@ezorm/core";

@Model({ table: "todos" })
class Todo {
  @PrimaryKey()
  @Field.string()
  id!: string;

  @Field.string()
  title!: string;
}
```
