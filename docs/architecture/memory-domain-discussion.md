# Memory domain discussion

## Status

Exploratory product and architecture note. Structured memory is an agreed topic
for further discussion, not an implemented feature or an approved
implementation plan.

## Product premise

Memory should become a core Jarvis domain capability rather than an optional
integration plugin. External systems may contribute information through
plugins, but the ownership, provenance, correction, retrieval, retention, and
deletion semantics of personal memory belong to the platform.

This topic follows the repository cleanup. The cleanup must preserve this note
without introducing speculative schemas, migrations, or tools.

## What the current system provides

Jarvis currently has several useful forms of persistence:

- Matrix conversation history;
- resumable Pi sessions and bounded thread context;
- workspace files that agents can read and write;
- attachments and media processing;
- schedules and execution history;
- retention and deletion mechanisms for existing record types.

These mechanisms retain information, but Jarvis does not understand a stored
statement as a personal fact, preference, decision, commitment, note, or other
memory. A sentence in a transcript or Markdown file has no platform-owned
identity, provenance, confidence, validity, correction history, or retrieval
policy.

The package named `memory-adapter` is a collection of in-memory adapter
implementations used by development and tests. It is not a semantic personal
memory feature.

## Proposed distinction

Conversation and files answer:

> What text was stored?

A memory domain should additionally answer:

> What does Jarvis believe it has been asked to remember, about what, based on
> which source, within which privacy scope, for how long, and what later
> corrected or superseded it?

Memory should not be equivalent to unlimited chat retention or autonomous
collection of every statement.

## Benefits to establish clearly

### Intentional persistence

The user can distinguish ordinary conversation from information Jarvis should
retain. A conservative default could be: conversation remains governed by its
retention policy unless the user explicitly asks Jarvis to remember something.
Inferred memories could require confirmation.

### Efficient retrieval

The current alternatives are to resume a large session, inject thread history,
search raw messages, or let the model inspect workspace files. These approaches
consume model context and tool calls while still requiring the model to infer
which old statements remain authoritative.

A memory query can return a small bounded set of current, relevant records.
Efficiency should be measured rather than assumed:

- tokens added to the model context;
- retrieval latency and number of tool calls;
- precision and recall for representative questions;
- frequency of stale or contradicted information;
- operator effort required to organize and correct stored knowledge.

### Provenance and explainability

Each memory can refer to its source: an explicit user instruction, a Matrix
event, an attachment, a tool result, or a confirmed inference. Jarvis can then
answer “Why do you think that?” and distinguish user-stated information from a
model conclusion.

### Correction instead of silent overwrite

When information changes, a new record can supersede an earlier one while
preserving enough history to explain the change. The platform can avoid
silently treating two contradictory sentences in different files or chats as
equally current.

### Privacy, retention, and deletion

Memory records can have explicit workspace/room scope, sensitivity, retention,
and deletion semantics. “Forget this” can target an identifiable record and
its derived index entries rather than relying on the model to edit whichever
files it happens to find.

### Reuse across sessions

Relevant knowledge becomes independent of a particular model provider, Pi
session, prompt layout, or transcript window. A smaller model can receive a
curated result rather than reconstructing history itself.

### Deterministic application behavior

Some behavior can use structured facts without asking a model to rediscover
them. Timezone, notification preferences, names, or confirmed constraints can
be resolved through application logic and supplied explicitly when needed.

## Why it may be more efficient than the current approach

The expected improvement is not primarily that a database lookup is faster
than reading a file. It is that the system performs semantic work once and
maintains the result deliberately, instead of repeatedly asking a model to:

1. search broad unstructured history;
2. interpret several candidate passages;
3. resolve contradictions;
4. decide which statement is current;
5. reconstruct its source and scope;
6. repeat that process in later sessions.

A structured memory record moves identity, current/superseded status, scope,
and provenance into deterministic application logic. The model is still useful
for interpreting requests and ranking ambiguous material, but it does not need
to recreate basic state on every turn.

This advantage disappears if extraction is noisy, retrieval injects irrelevant
records, or the schema is too rigid. The memory design must therefore be tested
against the current session/file approach with real personal-assistant tasks.

## Initial conceptual model—not a schema decision

A future memory may need concepts such as:

- stable identity;
- owner/workspace and visibility scope;
- kind, for example fact, preference, decision, commitment, or note;
- subject and normalized content;
- source and source location;
- explicit-user-stated versus inferred status;
- active, superseded, expired, or forgotten lifecycle;
- creation, observation, confirmation, and optional expiry times;
- relationship to a correcting or superseding memory;
- sensitivity or retrieval restrictions.

This list exists to guide discussion. It must not be converted directly into a
large schema before the user experience and invariants are agreed.

## Candidate interaction model

Potential operations include:

- remember an explicit statement;
- propose an inferred memory for confirmation;
- search or list remembered information;
- show the source and reason a memory was retrieved;
- correct or supersede a memory;
- forget a memory;
- review memories by subject, source, room, or age.

Candidate model-facing tools could eventually include `memory_search`,
`memory_get`, `memory_propose`, `memory_correct`, and `memory_forget`. Tool names
and approval behavior remain undecided.

## Core versus plugin boundary

The platform should own:

- memory identity and lifecycle;
- storage and queries;
- provenance;
- workspace/privacy scope;
- correction, supersession, expiration, and deletion;
- retention and audit behavior;
- bounded retrieval supplied to model runs.

Plugins may own:

- connectors that import candidate information;
- source-specific normalization;
- optional extraction strategies;
- views or workflows for particular external systems.

A plugin must not define an incompatible private memory store that bypasses the
platform's deletion and provenance rules.

## Conservative implementation direction

The likely starting point is PostgreSQL with structured records and ordinary
indexed/full-text queries. Do not begin by assuming the need for:

- a vector database;
- autonomous extraction of all conversational facts;
- a knowledge graph or broad ontology;
- automatic cross-workspace sharing;
- opaque importance or confidence scoring;
- indefinite retention.

Semantic retrieval or embeddings can be added later if representative queries
show a material gap that simpler retrieval cannot address.

## Questions for continued discussion

### Capture

- Is memory explicit-only, or may Jarvis propose inferred memories?
- Which phrases or commands constitute an explicit request to remember?
- Does a user-approved external source create memories automatically or only
  candidates?
- Should decisions and commitments be captured differently from facts and
  preferences?

### Scope and privacy

- Is memory private globally, room-scoped, or selectively shared?
- Can a memory learned in one room be used in another?
- How are sensitive memories marked and excluded from delegated agents?
- Which agents may create, retrieve, correct, or forget memories?

### Retrieval

- When should retrieval happen automatically versus through an explicit tool?
- How many memories may be injected into a turn?
- How is relevance calculated without hiding the reason for retrieval?
- Should the user see citations or source indicators in ordinary responses?

### Lifecycle

- What is the difference between forgotten, deleted, expired, and superseded?
- How should derived summaries behave when a source memory is corrected or
  deleted?
- Which memories require periodic revalidation?
- How does memory interact with existing Matrix-history and attachment
  retention?

### Trust

- Must all inferred memories be confirmed?
- Can a plugin or tool result create trusted facts, or only sourced candidates?
- How should conflicting sources be represented?
- Should confidence describe evidence quality, model uncertainty, or neither?

### User experience

- What is the simplest useful “remember / show / correct / forget” interface in
  Matrix?
- How can the user audit memory without reading database-shaped output?
- How can Jarvis explain that a response used a particular memory without
  becoming verbose?

### Evaluation

- Which real questions currently require excessive history or filesystem
  searching?
- What is the baseline token, latency, and accuracy cost today?
- What failure rate for stale or irrelevant retrieval is acceptable?
- Does structured memory allow smaller models to perform materially better?

## Preconditions before implementation planning

1. Complete the repository cleanup and settle the retained agent/plugin shape.
2. Describe several real user journeys, including correction and forgetting.
3. Decide the default capture and cross-room privacy policy.
4. Inventory existing retention and deletion guarantees that memory must join.
5. Define measurable comparisons with the current session/file approach.
6. Write domain invariants before choosing storage indexes or embedding
   technology.
