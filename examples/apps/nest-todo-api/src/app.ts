import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  createTodoDemoServices,
  type TodoDemoServices
} from "@sqlmodel/example-todo-domain";
import { TodoApiModule } from "./todo-api.module";

export async function createTodoApiApplication(services?: TodoDemoServices) {
  const resolvedServices = services ?? (await createTodoDemoServices());
  const app = await NestFactory.create(TodoApiModule.register(resolvedServices), {
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

  return {
    app,
    services: resolvedServices
  };
}
