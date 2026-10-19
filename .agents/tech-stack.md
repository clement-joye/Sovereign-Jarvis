# Tech Stack

- **Language:** TypeScript (ES2023 target, NodeNext modules)
- **Package manager:** pnpm 11.5.0 (workspace monorepo)
- **Runtime:** Node.js 24
- **Build:** TypeScript project references (`tsc -b`)
- **Testing:** Vitest (unit + contract), Testcontainers (integration), Docker Compose (system)
- **Linting:** TypeScript ESLint (recommended-type-checked)
- **Formatting:** Prettier (100-char width, no trailing comma, double quotes)
- **Architecture checks:** dependency-cruiser
- **Database:** PostgreSQL with Kysely ORM
- **Validation:** Zod schemas (contracts and API)
- **Deployment:** Docker Compose (dev, production, observability, system-test profiles)
