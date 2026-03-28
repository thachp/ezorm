# @ezorm/orm

`@ezorm/orm` is the direct Node.js ORM runtime for Ezorm models, including repositories, explicit read queries, and schema push/pull helpers.

## Install

```sh
npm install @ezorm/core @ezorm/orm
```

## Usage

```ts
import { createOrmClient } from "@ezorm/orm";

const client = await createOrmClient({
  databaseUrl: "sqlite::memory:"
});
```
