/**
 * How long after posting a chat message its author may still edit it — used to
 * show/hide the Edit action in trip, DM and group chats. Mirrors the backend
 * `EDIT_WINDOW_MS` (the server is the authority; keep the two in sync).
 */
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
