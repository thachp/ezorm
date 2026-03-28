import { BadRequestException } from "@nestjs/common";

export function requireTodoId(id: string): string {
  const nextId = id.trim();
  if (!nextId) {
    throw new BadRequestException("Todo id is required");
  }
  return nextId;
}
