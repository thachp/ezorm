export interface TodoListItem {
  id: string;
  title: string;
  completed: boolean;
}

export interface TodoMutationResult {
  todo: TodoListItem;
}

function apiBaseUrl(): string {
  return process.env.TODO_API_BASE_URL ?? "http://localhost:4000";
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchTodos(): Promise<TodoListItem[]> {
  return requestJson<TodoListItem[]>("/todos", {
    method: "GET"
  });
}

export async function createTodo(title: string): Promise<TodoMutationResult> {
  return requestJson<TodoMutationResult>("/todos", {
    method: "POST",
    body: JSON.stringify({ title })
  });
}

export async function completeTodo(id: string): Promise<TodoMutationResult> {
  return requestJson<TodoMutationResult>(`/todos/${id}/complete`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function reopenTodo(id: string): Promise<TodoMutationResult> {
  return requestJson<TodoMutationResult>(`/todos/${id}/reopen`, {
    method: "POST",
    body: JSON.stringify({})
  });
}
