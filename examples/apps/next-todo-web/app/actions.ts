"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  completeTodo,
  createTodo,
  reopenTodo
} from "../lib/todo-api";

function redirectWithQuery(key: "error" | "status", value: string): never {
  redirect(`/?${key}=${encodeURIComponent(value)}`);
}

function getRequiredText(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export async function createTodoAction(formData: FormData): Promise<never> {
  let title = "";

  try {
    title = getRequiredText(formData, "title");
    await createTodo(title);
  } catch (error) {
    return redirectWithQuery("error", getErrorMessage(error));
  }

  revalidatePath("/");
  return redirectWithQuery("status", "Todo created");
}

export async function completeTodoAction(formData: FormData): Promise<never> {
  let id = "";

  try {
    id = getRequiredText(formData, "id");
    await completeTodo(id);
  } catch (error) {
    return redirectWithQuery("error", getErrorMessage(error));
  }

  revalidatePath("/");
  return redirectWithQuery("status", "Todo completed");
}

export async function reopenTodoAction(formData: FormData): Promise<never> {
  let id = "";

  try {
    id = getRequiredText(formData, "id");
    await reopenTodo(id);
  } catch (error) {
    return redirectWithQuery("error", getErrorMessage(error));
  }

  revalidatePath("/");
  return redirectWithQuery("status", "Todo reopened");
}
