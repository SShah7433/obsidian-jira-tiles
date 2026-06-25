/**
 * Sprint array formatter.
 *
 * Jira returns sprint custom fields as an array (issues can be in multiple
 * sprints, e.g. when carried over). We render the names with a status hint
 * via CSS classes:
 *   - active: bold     (.jira-sprint--active)
 *   - future: italic   (.jira-sprint--future)
 *   - closed: muted    (.jira-sprint--closed)
 */

import type { JiraSprint } from "../../jira/types";
import { createEl, createFragment, doc } from "../dom";

export function formatSprintArray(sprints: JiraSprint[]): DocumentFragment {
  const frag = createFragment();
  sprints.forEach((sprint, idx) => {
    if (idx > 0) frag.append(doc().createTextNode(", "));
    const span = createEl("span");
    span.className = "jira-sprint";
    span.textContent = sprint.name ?? "(unnamed)";
    if (sprint.state === "active") span.classList.add("jira-sprint--active");
    else if (sprint.state === "future") span.classList.add("jira-sprint--future");
    else if (sprint.state === "closed") span.classList.add("jira-sprint--closed");
    frag.append(span);
  });
  return frag;
}
