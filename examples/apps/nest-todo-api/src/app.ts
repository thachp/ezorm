import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { TodoApiModule } from "./todo-api.module";

export async function createTodoApiApplication(options?: { databaseUrl?: string }) {
  const app = await NestFactory.create(TodoApiModule.register(options), {
    logger: false
  });

  app.enableCors({
    origin: [/^http:\/\/localhost:\d+$/],
    methods: ["GET", "POST"],
    credentials: false
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true
    })
  );

  return { app };
}
