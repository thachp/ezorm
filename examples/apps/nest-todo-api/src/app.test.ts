import "reflect-metadata";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { createTodoApiApplication } from "./app";

describe("@ezorm/example-nest-todo-api", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("serves the todo workflow over REST", async () => {
    const created = await createTodoApiApplication();
    app = created.app;
    await app.init();

    const createResponse = await request(app.getHttpServer())
      .post("/todos")
      .send({ title: "Ship repository CRUD" })
      .expect(201);

    const todoId = createResponse.body.todo.id as string;

    await request(app.getHttpServer()).get("/todos").expect(200).expect([
      {
        id: todoId,
        title: "Ship repository CRUD",
        completed: false
      }
    ]);

    await request(app.getHttpServer()).post(`/todos/${todoId}/complete`).expect(201).expect({
      todo: {
        id: todoId,
        title: "Ship repository CRUD",
        completed: true
      }
    });
    await request(app.getHttpServer()).post(`/todos/${todoId}/reopen`).expect(201).expect({
      todo: {
        id: todoId,
        title: "Ship repository CRUD",
        completed: false
      }
    });

    await request(app.getHttpServer()).get("/todos").expect(200).expect([
      {
        id: todoId,
        title: "Ship repository CRUD",
        completed: false
      }
    ]);

    await created.services.close();
  });
});
