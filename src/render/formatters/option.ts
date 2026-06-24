/**
 * Option formatter — for single-select / radio fields where Jira returns
 * `{ id, value, self }`.
 */

import type { JiraOption } from "../../jira/types";

export function formatOption(option: JiraOption): DocumentFragment {
  const frag = document.createDocumentFragment();
  frag.append(document.createTextNode(option.value ?? "—"));
  return frag;
}
