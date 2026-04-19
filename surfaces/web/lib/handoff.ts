import type { MatchedPerson, Track } from "./types";

/**
 * Build a paste-ready Claude Code handoff prompt for a single outreach.
 *
 * The returned string is the literal prompt text — no YAML front-matter, no
 * JSON envelope. Values for the person are inlined so the prompt stands on
 * its own even if context is stripped.
 */
export function buildHandoffPrompt(args: {
  person: MatchedPerson;
  track: Track;
  draft: string;
  repoUrl?: string;
}): string {
  const { person, track, draft, repoUrl } = args;

  const draftTrimmed = draft.trim();
  // Subject = first sentence of the draft, collapsed to one line,
  // capped so it stays a reasonable email subject.
  const firstSentenceMatch = draftTrimmed.match(/^[^.!?\n]+[.!?]?/);
  const rawSubject = (firstSentenceMatch?.[0] ?? draftTrimmed)
    .replace(/\s+/g, " ")
    .trim();
  const subject =
    rawSubject.length > 90 ? `${rawSubject.slice(0, 87).trimEnd()}…` : rawSubject;

  const linkedin = person.linkedin ?? "(no LinkedIn on file)";
  const recentPost = person.recent_post
    ? `"${person.recent_post.replace(/\s+/g, " ").trim().slice(0, 220)}"`
    : "(no recent public post indexed)";
  const recentPostUrl = person.recent_post_url ?? "(no source url)";
  const repoLine = repoUrl ? `Repo context: ${repoUrl}` : "Repo context: (not provided)";

  return [
    `Send outreach to ${person.name} (${person.title} @ ${person.company}) — track: ${track}.`,
    `LinkedIn: ${linkedin}`,
    `Latest public post: ${recentPost} — source: ${recentPostUrl}`,
    repoLine,
    ``,
    `1. If the Gmail MCP server is connected, draft an email to ${person.name} with subject "${subject}" and the body below. Do NOT send — leave it as a draft for me to review.`,
    `2. If Gmail MCP is not configured, open ${linkedin} in the browser and copy the body to my clipboard so I can paste it as a LinkedIn message.`,
    `3. After the draft is created (or copied), append one JSON line to ~/.lighthouse/ledger.jsonl: {"ts": <unix_ms>, "name": "${person.name}", "company": "${person.company}", "track": "${track}", "status": "sent"}. Create the file if missing.`,
    `4. Schedule a reminder 3 days from now to check for a reply. If no reply lands by then, draft a follow-up grounded in ${person.name}'s latest public post — pull a fresh one via Crustdata enrich or the Lighthouse MCP server rather than reusing the snippet above.`,
    ``,
    `--- body ---`,
    draftTrimmed,
    `--- end body ---`,
  ].join("\n");
}
