export interface PendingEvent {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
  processed_at: Date | null;
  retry_count: number;
  last_error: string | null;
}

export type EventHandler = (event: PendingEvent) => Promise<void>;

export interface DbDescriptor {
  name: string;
  url: string;
  handlers: Map<string, EventHandler>;
}
