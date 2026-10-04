import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
export const requestContext = new AsyncLocalStorage<{ id: string }>();
export function safeRequestId(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}
export function currentRequestId() { return requestContext.getStore()?.id ?? randomUUID(); }
