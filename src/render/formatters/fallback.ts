/**
 * Fallback formatter — JSON-stringify into a <code> block when no smarter
 * formatter applies. Truncates long strings to keep tile heights bounded.
 */

const MAX_LEN = 240;

export function formatFallback(value: unknown): DocumentFragment {
  const frag = document.createDocumentFragment();
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    json = String(value);
  }
  if (json && json.length > MAX_LEN) {
    json = json.slice(0, MAX_LEN) + "…";
  }
  const code = document.createElement("code");
  code.textContent = json ?? "—";
  frag.append(code);
  return frag;
}
