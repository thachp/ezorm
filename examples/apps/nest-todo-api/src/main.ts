import "reflect-metadata";
import { createTodoApiApplication } from "./app";

async function bootstrap(): Promise<void> {
  const { app } = await createTodoApiApplication();
  const port = Number(process.env.PORT ?? 4000);

  await app.listen(port);
  console.log(`Todo API listening on http://localhost:${port}`);
}

void bootstrap();
