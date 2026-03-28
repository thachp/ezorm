import "reflect-metadata";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { createTodoApiApplication } from "./app";

describe("@sqlmodel/example-nest-todo-api", () => {
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
      .send({ title: "Call projector replay" })
      .expect(201);

    const todoId = createResponse.body.todo.id as string;

    await request(app.getHttpServer()).get("/todos").expect(200).expect([
      {
        id: todoId,
        title: "Call projector replay",
        completed: false,
        version: 1
      }
    ]);

    await request(app.getHttpServer()).post(`/todos/${todoId}/complete`).expect(201);
    await request(app.getHttpServer()).post(`/todos/${todoId}/reopen`).expect(201);

    await created.services.readModelStore.reset();
    await request(app.getHttpServer()).get("/todos").expect(200).expect([]);

    const rebuildResponse = await request(app.getHttpServer())
      .post("/projectors/todos/rebuild")
      .expect(201);

    expect(rebuildResponse.body.checkpoint.lastSequence).toBe(3);

    await request(app.getHttpServer()).get("/todos").expect(200).expect([
      {
        id: todoId,
        title: "Call projector replay",
        completed: false,
        version: 3
      }
    ]);
  });
});
