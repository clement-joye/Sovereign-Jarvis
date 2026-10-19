import type { IncomingMessage, ServerResponse } from "node:http";

export interface BrainControlRouteContext {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly url: URL;
}

export type BrainControlRoute = (context: BrainControlRouteContext) => Promise<boolean>;
export type BrainControlRouteRegistrar<Dependencies> = (
  routes: BrainControlRoute[],
  deps: Dependencies
) => void;
