// Signature every shared query function is written against. Callers supply
// their own executor — the client wraps `browserQueries.executeFetchString`
// (which handles logging and busy-session checks); the MCP server wraps
// `McpSession.executeFetchString` (its own GCI session, no logging).
export type QueryExecutor = (code: string) => string;
