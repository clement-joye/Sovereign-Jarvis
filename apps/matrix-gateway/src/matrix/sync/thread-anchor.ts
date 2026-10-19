import type { OutboundMessageV1 } from "@second-brain/contracts";

export interface ThreadAnchorableOutboundSender {
  send(message: OutboundMessageV1): Promise<{ externalEventId: string }>;
}

export interface ThreadedReplyDelivery {
  externalEventId: string;
  anchorExternalEventId?: string;
  anchorIdempotencyKey?: string;
}

/**
 * Sends the reply, sending a marker message in the same room first when
 * `threadAnchorText` is set so the reply becomes part of that marker's
 * thread. The marker is not persisted in the control plane; it is only
 * sent inline so the entire thread (marker + reply) can be regenerated
 * idempotently by the Matrix transaction id on retries.
 *
 * If the reply already has a `threadRootExternalEventId` (i.e. it is a
 * retry of a previously anchored delivery), the anchor is skipped and
 * the existing thread root is honoured.
 */
export async function sendThreadedReply(
  sender: ThreadAnchorableOutboundSender,
  message: OutboundMessageV1
): Promise<ThreadedReplyDelivery> {
  if (!message.threadAnchorText || message.threadRootExternalEventId) {
    return { externalEventId: await sendAll(sender, message) };
  }
  const anchor = await sender.send(threadAnchorMessage(message));
  const externalEventId = await sendAll(sender, {
    ...message,
    replyToExternalEventId: anchor.externalEventId,
    threadRootExternalEventId: anchor.externalEventId
  });
  return {
    externalEventId,
    anchorExternalEventId: anchor.externalEventId,
    anchorIdempotencyKey: `${message.idempotencyKey}:anchor`
  };
}

/** Matrix permits one primary payload per event; retain a single logical reply
 * in storage but deterministically fan it out into correctly threaded events. */
async function sendAll(
  sender: ThreadAnchorableOutboundSender,
  message: OutboundMessageV1
): Promise<string> {
  let lastEventId: string | undefined;
  for (const event of matrixEvents(message)) {
    lastEventId = (await sender.send(event)).externalEventId;
  }
  if (!lastEventId) throw new Error("Outbound message has no deliverable Matrix event.");
  return lastEventId;
}

export function matrixEvents(message: OutboundMessageV1): OutboundMessageV1[] {
  const common = {
    schemaVersion: message.schemaVersion,
    traceId: message.traceId,
    conversationId: message.conversationId,
    ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
    ...(message.replyToExternalEventId
      ? { replyToExternalEventId: message.replyToExternalEventId }
      : {}),
    ...(message.threadRootExternalEventId
      ? { threadRootExternalEventId: message.threadRootExternalEventId }
      : {}),
    presentation: message.presentation,
    urgency: message.urgency
  };
  const events: OutboundMessageV1[] = [];
  if (message.text)
    events.push({
      ...common,
      id: `${message.id}:text`,
      text: message.text,
      images: [],
      files: [],
      idempotencyKey: `${message.idempotencyKey}:text`
    });
  if (message.audio)
    events.push({
      ...common,
      id: `${message.id}:audio`,
      audio: message.audio,
      images: [],
      files: [],
      idempotencyKey: `${message.idempotencyKey}:audio`
    });
  message.images.forEach((image, index) =>
    events.push({
      ...common,
      id: `${message.id}:image:${index + 1}`,
      images: [image],
      files: [],
      idempotencyKey: `${message.idempotencyKey}:image:${index + 1}`
    })
  );
  (message.files ?? []).forEach((file, index) =>
    events.push({
      ...common,
      id: `${message.id}:file:${index + 1}`,
      images: [],
      files: [file],
      idempotencyKey: `${message.idempotencyKey}:file:${index + 1}`
    })
  );
  return events;
}

export function threadAnchorMessage(reply: OutboundMessageV1): OutboundMessageV1 {
  return {
    schemaVersion: 1,
    id: `${reply.id}:anchor`,
    traceId: reply.traceId,
    conversationId: reply.conversationId,
    text: reply.threadAnchorText ?? "",
    images: [],
    files: [],
    presentation: reply.presentation,
    urgency: "normal",
    idempotencyKey: `${reply.idempotencyKey}:anchor`
  };
}
