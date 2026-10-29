// Signature the shared query functions are written against. Callers supply
// their own executor — the client wraps `browserQueries.executeFetchString`
// (which handles logging and busy-session checks); the MCP server wraps
// `McpSession.executeFetchString` (its own GCI session, no logging).
export type QueryExecutor = (code: string) => string;

// A QueryExecutor that doesn't block the extension host while the query runs.
// A query written against it answers a Promise of what its blocking twin
// answers.
export type NbQueryExecutor = (code: string) => Promise<string>;
