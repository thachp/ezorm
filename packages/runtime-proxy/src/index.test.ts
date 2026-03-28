import { describe, expect, it, vi } from "vitest";
import { Field, Model, PrimaryKey } from "@ezorm/core";
import { ProxyOrmClient, ProxyRuntimeError } from "./index";

@Model({ table: "users" })
class User {
  @PrimaryKey()
  @Field.string()
  id!: string;

  @Field.string()
  email!: string;
}

describe("@ezorm/runtime-proxy", () => {
  it("posts repository lookups through the ORM proxy contract", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ id: "usr_1", email: "alice@example.com" })
    );
    const client = new ProxyOrmClient({
      endpoint: "http://runtime.internal/",
      fetchImpl
    });
    const repository = client.repository(User);

    await expect(repository.findById("usr_1")).resolves.toEqual({
      id: "usr_1",
      email: "alice@example.com"
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://runtime.internal/orm/find-by-id",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ table: "users", id: "usr_1" })
      })
    );
  });

  it("posts ordered repository queries", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]));
    const client = new ProxyOrmClient({ endpoint: "http://runtime.internal", fetchImpl });
    const repository = client.repository(User);

    await repository.findMany({
      where: { email: "alice@example.com" },
      orderBy: { field: "email", direction: "asc" }
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://runtime.internal/orm/find-many",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          table: "users",
          options: {
            where: { email: "alice@example.com" },
            orderBy: { field: "email", direction: "asc" }
          }
        })
      })
    );
  });

  it("preserves proxy error details for non-conflict failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          code: "internal_error",
          message: "database is unavailable"
        },
        500
      )
    );
    const client = new ProxyOrmClient({ endpoint: "http://runtime.internal", fetchImpl });
    const repository = client.repository(User);

    await expect(repository.findById("usr_1")).rejects.toMatchObject({
      name: "ProxyRuntimeError",
      status: 500,
      code: "internal_error",
      message: "database is unavailable"
    });
  });

  it("exposes select on the unsupported query builder and rejects execution", async () => {
    const client = new ProxyOrmClient({
      endpoint: "http://runtime.internal",
      fetchImpl: vi.fn<typeof fetch>()
    });

    await expect(
      client
        .query(User)
        .select<{ email: string }>({ email: "email" })
        .all()
    ).rejects.toThrow(
      "@ezorm/runtime-proxy does not support relation-aware queries or loaders yet"
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
