# Code Quality Guards

## Enforced by ESLint (production code)

| Rule                     | Threshold       | Rationale                                         |
| ------------------------ | --------------- | ------------------------------------------------- |
| `complexity`             | warn at **10**  | Cognitive complexity of functions                 |
| `max-lines-per-function` | warn at **100** | Lines per function (excludes blanks and comments) |
| `max-depth`              | warn at **3**   | Nesting depth                                     |

> **Note:** These thresholds are stricter than the defaults to enforce high cohesion and low complexity. A small, well-named helper that reduces cognitive load is preferable to splitting a function solely to satisfy a number.

## Recommended additional guards

When adding new lint rules or making changes, consider these additional constraints:

| Guard            | Recommended value | Notes                                   |
| ---------------- | ----------------- | --------------------------------------- |
| `max-params`     | warn at 4         | Parameters per function                 |
| `max-statements` | warn at 25        | Statements per function                 |
| `max-lines`      | warn at 400       | Lines per file (for non-contract files) |
| `max-lines`      | warn at 700       | Lines per file (for schemas/contracts)  |

## File size guidelines

- **Domain files:** Prefer under 200 lines. Extract value objects or helper functions.
- **Application files:** Prefer under 300 lines. Extract sub-handlers or utilities.
- **Adapter files:** Prefer under 300 lines. Extract row mappers or query builders.
- **Route files:** Prefer under 400 lines. Extract route handlers or middleware.
- **Contract/schema files:** May exceed 400 lines (schema definitions are inherently verbose).
- **Test files:** Prefer under 200 lines. Extract test fixtures or helper functions.
- **Composition files:** May exceed 400 lines (dependency wiring is inherently verbose).

## When to split

A small, well-named helper that reduces cognitive load is preferable to splitting a function solely to satisfy a number. Split when:

1. The extracted unit has a clear, single responsibility.
2. The extracted unit improves readability of the caller.
3. The extracted unit is independently testable.
