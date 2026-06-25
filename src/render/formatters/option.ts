/**
 * Option formatter — for single-select / radio fields where Jira returns
 * `{ id, value, self }`.
 */

import type { JiraOption } from "../../jira/types";
import { createFragment, doc } from "../dom";

export function formatOption(option: JiraOption): DocumentFragment {
  const frag = createFragment();
  frag.append(doc().createTextNode(option.value ?? "—"));
  return frag;
}
