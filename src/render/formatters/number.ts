/**
 * Number formatter — uses locale-aware grouping for big numbers (story points,
 * estimates, votes).
 */

export function formatNumber(n: number): DocumentFragment {
  const frag = document.createDocumentFragment();
  frag.append(document.createTextNode(n.toLocaleString()));
  return frag;
}
