/** A caller supplied proposal was malformed or did not match reviewed policy. */
export class ActionProposalValidationError extends Error {}

/** A proposal cannot currently be used for the requested operation. */
export class ActionProposalConflictError extends Error {}

/** A proposal's owner approval has expired or was already expired. */
export class ActionProposalExpiredError extends ActionProposalConflictError {}

/** A proposal is waiting for an owner decision. */
export class ActionProposalPendingError extends ActionProposalConflictError {}
