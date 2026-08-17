export const CASE = {
  supportEmail: "support@lovable.dev",
  projectName: "jarvisjane — Jarvis AI Companion",
  projectId: "90c492b0-9211-4837-9ada-e2c73ef2d4fe",
  workspaceId: "95dcb1764cf410e0d985",
  editorUrl: "https://lovable.dev/projects/90c492b0-9211-4837-9ada-e2c73ef2d4fe",
  liveUrl: "https://jarvisjane.lovable.app",
  errorText:
    "403 account_blocked: This account is not permitted to perform this action.\nReach out to support if you think it is a mistake.",
};

export type Step = { id: string; title: string; detail: string };

export const preflight: Step[] = [
  {
    id: "pf-billing",
    title: "Check billing for a hold",
    detail:
      "Open lovable.dev/settings/billing and look for a past-due, suspended, or restricted banner. A failed charge is the most common cause of a write-only block.",
  },
  {
    id: "pf-payment",
    title: "Confirm a valid payment method",
    detail: "On a paid plan, an expired card silently degrades the account to read-only.",
  },
  {
    id: "pf-email",
    title: "Search inbox and spam for Lovable notices",
    detail:
      'Search for "Lovable" plus "account", "billing", or "policy". Trust & Safety actions are always emailed.',
  },
  {
    id: "pf-scope",
    title: "Confirm the block is account-wide, not project-wide",
    detail:
      "Try a write action on a different project in the same workspace. If it also 403s, the flag is on the account; if not, it is project or workspace scoped.",
  },
];

export const reconnectSteps: Step[] = [
  {
    id: "rc-signout",
    title: "Sign out of lovable.dev",
    detail: "Profile menu, top right, then Sign out. Close the tab afterwards.",
  },
  {
    id: "rc-revoke",
    title: "Revoke the existing authorization",
    detail:
      "In lovable.dev account settings, remove the connected Claude / MCP app. Disconnecting only on the client side leaves the grant alive, so the next handshake re-approves it with no prompt.",
  },
  {
    id: "rc-disconnect",
    title: "Disconnect the connector in Claude",
    detail: "Connector settings, find Lovable, Disconnect. Do this after revoking, not before.",
  },
  {
    id: "rc-incognito",
    title: "Open a fresh private window",
    detail:
      "A private window guarantees no Lovable or Google session cookie is available for silent reuse.",
  },
  {
    id: "rc-google",
    title: "Sign out of Google too, if you used Google sign-in",
    detail:
      "Google's account chooser will otherwise hand back the same identity without showing a login form.",
  },
  {
    id: "rc-reconnect",
    title: "Reconnect and watch for a blank login screen",
    detail:
      "If the popup shows an account picker instead of an empty form, a session is still cached: stop and repeat from step 1.",
  },
  {
    id: "rc-verify",
    title: "Verify with a read, then a write",
    detail:
      "List projects: the old project ID must be absent. Then attempt one small edit to confirm writes succeed.",
  },
];

export const corrections = [
  {
    id: "cx-model",
    label: "Blocking",
    title: "gemini-3.7-flash is not a real model ID",
    body: "The queued fix would have replaced a working model string with one that does not exist, turning a 403 into a runtime provider error. Keep gemini-2.5-flash, or move to a model ID you have verified against the gateway's model list first.",
  },
  {
    id: "cx-revoke",
    label: "Root cause",
    title: "Reconnecting without revoking cannot change accounts",
    body: "OAuth re-authorization reuses the live grant plus the browser session. The original steps disconnected only on the client, which is why two reconnect attempts returned the same account. Revoke server-side first.",
  },
  {
    id: "cx-email",
    label: "Same identity",
    title: "Two accounts on one email are one account",
    body: "If both sign-ins use the same address, there is no second account to switch to. Confirm the new account uses a distinct email before spending more time on connector debugging.",
  },
  {
    id: "cx-redact",
    label: "Hygiene",
    title: "Send IDs, never tokens",
    body: "Project and workspace IDs are safe to paste into a ticket. API keys, bearer tokens, and session cookies are not — rotate any that were already shared.",
  },
  {
    id: "cx-scope",
    label: "Diagnosis",
    title: "Reads working does not mean the account is healthy",
    body: "Read-only survival is the signature of a permission downgrade, not a transient outage. Retrying the same write is not a fix, so escalate rather than loop.",
  },
];

export function buildTicket(email: string, plan: string, notes: string) {
  return `Subject: 403 account_blocked on all write actions — ${CASE.projectName}

Account email: ${email || "[your account email]"}
Plan: ${plan || "[your plan]"}
Project: ${CASE.projectName}
Project ID: ${CASE.projectId}
Workspace ID: ${CASE.workspaceId}

Every write or edit action on my account fails with the following error, while
read-only actions continue to succeed:

${CASE.errorText}

Questions:
1. Why was this account blocked for write actions?
2. Is this a billing hold, a plan restriction, or a Trust & Safety / ToS flag?
3. What exactly do I need to do to get it unblocked, and how long does that take?
4. Is the flag scoped to the account, the workspace, or this single project?

Already checked on my side:
- Billing page shows no past-due or suspended banner.
- A valid payment method is on file.
- No email from Lovable about account status in inbox or spam.
- The same write fails from a different client, so it is not a client-side issue.
${notes ? `\nAdditional context:\n${notes}\n` : ""}
Thanks,`;
}