# AGENTS.md

## Project Overview

**Jarvis (Second Brain)** is a private, self-hosted Matrix personal assistant
that runs Pi-backed agents on infrastructure you control. It is a
**process-separated modular monolith**: one TypeScript monorepo, several small
services, one authoritative PostgreSQL database, and strict package boundaries.

The system provides Matrix-based conversations with specialist delegation,
durable scheduling, voice/media processing, isolated workspace runtimes, and a
plugin-first extensibility model.

**Request flow:** `Element → Matrix homeserver → matrix-gateway → brain-control → PostgreSQL`
Workers (`brain-worker`, `media-worker`, `pi-runner`) execute leased jobs via private HTTP APIs.

## Table of Contents

| Section               | File                                                                   |
| --------------------- | ---------------------------------------------------------------------- |
| Repository Structure  | [`.agents/repository-structure.md`](.agents/repository-structure.md)   |
| Tech Stack            | [`.agents/tech-stack.md`](.agents/tech-stack.md)                       |
| Development Commands  | [`.agents/development-commands.md`](.agents/development-commands.md)   |
| Architecture          | [`.agents/architecture.md`](.agents/architecture.md)                   |
| Coding Conventions    | [`.agents/coding-conventions.md`](.agents/coding-conventions.md)       |
| Code Quality Guards   | [`.agents/code-quality-guards.md`](.agents/code-quality-guards.md)     |
| Testing Guidelines    | [`.agents/testing-guidelines.md`](.agents/testing-guidelines.md)       |
| Change Guidelines     | [`.agents/change-guidelines.md`](.agents/change-guidelines.md)         |
| Important Constraints | [`.agents/important-constraints.md`](.agents/important-constraints.md) |
| Do Not                | [`.agents/do-not.md`](.agents/do-not.md)                               |
| Scripts Reference     | [`.agents/scripts-reference.md`](.agents/scripts-reference.md)         |
