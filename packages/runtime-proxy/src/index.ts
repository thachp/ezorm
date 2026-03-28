import type { DomainEvent, EventStore, StoredEvent } from "@sqlmodel-ts/events";

export interface ProxyRuntimeClientOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
}

export class ProxyRuntimeClient implements EventStore {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ProxyRuntimeClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async load(streamId: string): Promise<StoredEvent[]> {
    return this.post("/events/load", { streamId });
  }

  async loadAll(afterSequence = 0): Promise<StoredEvent[]> {
    return this.post("/events/load-all", { afterSequence });
  }

  async append(streamId: string, version: number, events: DomainEvent[]): Promise<StoredEvent[]> {
    return this.post("/events/append", { streamId, version, events });
  }

  async latestVersion(streamId: string): Promise<number> {
    const events = await this.load(streamId);
    return events.at(-1)?.version ?? 0;
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(`${this.options.endpoint}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`Proxy runtime request failed with ${response.status}`);
    }
    return (await response.json()) as T;
  }
}

