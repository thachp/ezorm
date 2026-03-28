import {
  VersionConflictError,
  type DomainEvent,
  type EventStore,
  type StoredEvent
} from "@sqlmodel/events";

export interface ProxyRuntimeClientOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
}

export interface ProxyRuntimeErrorDetails {
  streamId?: string;
  expectedVersion?: number;
  actualVersion?: number;
}

export interface ProxyRuntimeErrorBody {
  code?: string;
  message?: string;
  details?: ProxyRuntimeErrorDetails;
}

interface EventListResponse {
  events: StoredEvent[];
}

interface LatestVersionResponse {
  version: number;
}

export class ProxyRuntimeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ProxyRuntimeError";
  }
}

export class ProxyRuntimeClient implements EventStore {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ProxyRuntimeClientOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async load(streamId: string): Promise<StoredEvent[]> {
    const response = await this.post<EventListResponse>("/events/load", { streamId });
    return response.events;
  }

  async loadAll(afterSequence = 0): Promise<StoredEvent[]> {
    const response = await this.post<EventListResponse>("/events/load-all", { afterSequence });
    return response.events;
  }

  async append(streamId: string, version: number, events: DomainEvent[]): Promise<StoredEvent[]> {
    const response = await this.post<EventListResponse>("/events/append", {
      streamId,
      version,
      events
    });
    return response.events;
  }

  async latestVersion(streamId: string): Promise<number> {
    const response = await this.post<LatestVersionResponse>("/events/latest-version", { streamId });
    return response.version;
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(`${this.endpoint}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw await this.toProxyError(response);
    }

    return (await response.json()) as T;
  }

  private async toProxyError(response: Response): Promise<Error> {
    const rawBody = await response.text();
    const payload = parseProxyRuntimeError(rawBody);

    if (
      payload?.code === "version_conflict" &&
      typeof payload.details?.streamId === "string" &&
      typeof payload.details.expectedVersion === "number" &&
      typeof payload.details.actualVersion === "number"
    ) {
      return new VersionConflictError(
        payload.details.streamId,
        payload.details.expectedVersion,
        payload.details.actualVersion
      );
    }

    return new ProxyRuntimeError(
      response.status,
      payload?.code ?? "http_error",
      payload?.message ?? `Proxy runtime request failed with ${response.status}`
    );
  }
}

function parseProxyRuntimeError(rawBody: string): ProxyRuntimeErrorBody | undefined {
  if (!rawBody) {
    return undefined;
  }

  try {
    const payload = JSON.parse(rawBody) as ProxyRuntimeErrorBody;
    if (typeof payload !== "object" || payload === null) {
      return undefined;
    }
    return payload;
  } catch {
    return undefined;
  }
}
