import type { InboundMessageV1 } from "@second-brain/contracts";

import type { SessionRoutingResult } from "./session-routing-result.js";

/** Narrow dependency used by inbound job processing. */
export interface SessionRoutingPort {
  routeInbound(message: InboundMessageV1): Promise<SessionRoutingResult>;
}
