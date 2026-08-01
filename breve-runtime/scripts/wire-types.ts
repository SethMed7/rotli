// The shapes Breve reads off a wire it does not own: signal-cli's JSON
// envelopes, the local model server's generate response, and the small
// file-backed lists in Rotli's Breve home (watchers, creators, pending
// actions).
//
// These are DESCRIPTIONS, not guarantees — every field is optional or narrow
// on purpose, because the producer is signal-cli, a model, or a JSON file a
// previous run wrote. Typing them this way is what makes the daemon's existing
// `?.` and `?? default` handling checkable instead of `any` waving it through.
// Nothing here widens what the code accepts; it names what it already assumed.

/** One attachment on an inbound Signal message. */
export interface SignalAttachment {
  id?: string;
  contentType?: string;
  filename?: string;
  size?: number;
}

/** The `dataMessage` body of an inbound Signal envelope. */
export interface SignalDataMessage {
  message?: string | null;
  attachments?: SignalAttachment[];
  timestamp?: number;
}

/** One `envelope` from `signal-cli -o json receive`. */
export interface SignalEnvelope {
  source?: string;
  sourceNumber?: string | null;
  sourceUuid?: string | null;
  timestamp?: number;
  dataMessage?: SignalDataMessage;
}

/** The local model server's completion response (`{ "response": "..." }`). */
export interface GenerateResponse {
  response?: string;
}

/** A page/repo watcher row in watchers.json. `fails`/`failureAlerted` are the
 * WatcherFailureState the checker persists back onto the row (watcher-failure.ts). */
export interface Watcher {
  id: number;
  url: string;
  condition?: string | null;
  lastHash?: string;
  lastSeen?: number;
  fails?: number;
  failureAlerted?: boolean;
}

/** A creator-feed row in creators.json. */
export interface Creator {
  id?: number;
  name?: string;
  handle?: string;
  channelId?: string;
  url?: string;
  lastSeen?: string;
}

/** An action the deep tier staged into pending-action.json for confirmation.
 * `action` is the discriminator the daemon switches on; the rest are the
 * arguments a given action reads, all optional because the writer is a model. */
export interface PendingAction {
  action?: string;
  plist?: string;
  label?: string;
  script?: string;
  args?: unknown;
  note?: string;
  [key: string]: unknown;
}

/** pending-voice.json — a chat-voice change awaiting "confirm". */
export interface PendingVoice {
  testing?: string | null;
  at?: number;
}

/** pending.json — a topic-email request awaiting its format answer. */
export interface PendingEmail {
  topic: string;
  recipient: string;
  format: "pdf" | "plain" | null;
}

/** The morning brief's "radar" suggestion awaiting a yes/no. */
export interface PendingSuggestion {
  name?: string;
  why?: string;
  date?: string;
}

/** The local model's travel-announcement classification. */
export interface TravelClassification {
  is_travel_announcement?: boolean;
  timezone?: string;
  start?: string;
  end?: string;
}

/** One configured mailbox in mail-accounts.json (the Keychain holds the password). */
export interface MailAccount {
  name: string;
  host: string;
  port: number;
  user: string;
  keychain: string;
  secure?: boolean;
  starttls?: boolean;
}

/** The flattened message row `mail.ts` prints. `date` is a Date in the writing
 * process and an ISO string by the time the daemon JSON.parses it back — and is
 * absent entirely when the envelope carried no date. */
export interface EnvelopeRow {
  uid: number;
  date: Date | string | undefined;
  from: string | undefined;
  subject: string;
  seen: boolean;
}

/** `mail.ts unread` output — merged counts across accounts, newest first. */
export interface UnreadReport {
  unread: number;
  accounts: Record<string, number>;
  errors: Record<string, string>;
  messages: (EnvelopeRow & { account: string })[];
}

/** `mail.ts search` output. */
export interface MailSearchReport {
  account: string;
  query: string;
  matches: EnvelopeRow[];
}

/** Resend's send response (id on success, message on failure). */
export interface ResendResponse {
  id?: string;
  message?: string;
}
