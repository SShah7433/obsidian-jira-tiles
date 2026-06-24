/**
 * Sprint array formatter.
 *
 * Jira returns sprint custom fields as an array (issues can be in multiple
 * sprints, e.g. when carried over). We render the names with a status hint:
 *   - active: bold
 *   - future: italic
 *   - closed: muted
 */

import type { JiraSprint } from "../../jira/types";

export function formatSprintArray(sprints: JiraSprint[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  sprints.forEach((sprint, idx) => {
    if (idx > 0) frag.append(document.createTextNode(", "));
    const span = document.createElement("span");
    span.textContent = sprint.name ?? "(unnamed)";
    if (sprint.state === "active") {
      span.style.fontWeight = "600";
    } else if (sprint.state === "future") {
      span.style.fontStyle = "italic";
    } else if (sprint.state === "closed") {
      span.style.opacity = "0.6";
    }
    frag.append(span);
  });
  return frag;
}
