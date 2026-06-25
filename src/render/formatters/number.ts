/**
 * Number formatter — uses locale-aware grouping for big numbers (story points,
 * estimates, votes).
 */

import { createFragment, doc } from "../dom";

export function formatNumber(n: number): DocumentFragment {
  const frag = createFragment();
  frag.append(doc().createTextNode(n.toLocaleString()));
  return frag;
}
