# `src/jira`

Jira REST API client and types.

## Modules

| File              | Purpose                                                              |
|-------------------|----------------------------------------------------------------------|
| `types.ts`        | Hand-curated type definitions for the Jira REST v3 responses we use  |
| `client.ts`       | Thin wrapper around `requestUrl` with auth + error mapping           |
| `fieldDiscovery.ts` | Helpers to fetch and filter custom field metadata for the picker   |

## Why not generated types?

Atlassian's OpenAPI spec is enormous and the generated types are unwieldy. We
hand-curate the small slice we need (~10 types) and let TypeScript `unknown`
guard against the long tail of custom-field shapes.

## Client behavior

`JiraClient.getIssue(key, fields[])`:

1. `authManager.getContext()` — produces `{ baseUrl, authorizationHeader }`
   from the configured API token (token value is resolved from
   SecretStorage at this point).
2. `requestUrl({ url, headers, throw: false })` — Obsidian's CORS-free HTTP.
3. Parse the response body (defensive: falls back to `JSON.parse(text)` if
   `requestUrl.json` is empty).
4. Map non-2xx to `JiraApiError` with a friendly message.

The client does NOT cache; that is `IssueCache`'s job.

## Error model

All non-2xx responses (and timeouts) become `JiraApiError`:

```ts
class JiraApiError extends Error {
  status: number;     // 0 for timeouts, otherwise the HTTP status
  message: string;    // human-friendly summary (includes 401, 404, 429, 502 hints)
  body?: string;      // raw response body for debugging
}
```

Renderer code surfaces `message` directly; the error fixtures in the dev
preview harness (on the `dev` branch) exercise the most common cases.
