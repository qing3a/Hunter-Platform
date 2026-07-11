// src/main/modules/candidate-portal/messages.ts
//
// Candidate Portal: messages list / send / detail / mark-read handler.
//
// Public-facing methods called from the router layer (Task 12). This module
// enforces authz (any authenticated user type — candidate / headhunter /
// employer — can send and receive) and content validation; the router
// layer enforces payload-shape strictness via Zod.
//
// Authorization model:
//   - Any authenticated `candidate | headhunter | employer` can list and send.
//   - Sending requires the recipient (`to_user_id`) to exist (we look up by id
//     and confirm user_type is one of the three messaging-eligible types).
//   - `unread_count` is computed for the CALLER's inbox (so the frontend can
//     badge the bell without a separate round-trip).
//
// Content validation:
//   - Non-empty after trim (length > 0).
//   - Up to 2000 chars (long enough for a multi-paragraph intro, short
//     enough to keep a single message row well under SQLite's 1 GB limit).
//   - Existence of the recipient is verified BEFORE insert to surface a
//     precise 404 instead of an opaque foreign-key failure later.

import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import {
  createCandidateMessagesRepo,
  type MessageListItem,
  type MessageRow,
} from '../../db/repositories/candidate-messages.js';
import { Errors } from '../../errors.js';

export interface MessageSendInput {
  to_user_id: string;
  content: string;
  application_id?: number | null;
}

export interface MessagesListQuery {
  box?: 'inbox' | 'sent';
  unread_only?: boolean;
  limit?: number;
  offset?: number;
}

export interface MessagesListResult {
  items: MessageListItem[];
  unread_count: number;
  box: 'inbox' | 'sent';
}

export interface MessagesModule {
  list(user: User, opts?: MessagesListQuery): MessagesListResult;
  send(user: User, input: MessageSendInput): { message_id: number };
  detail(user: User, messageId: number): MessageListItem;
  markRead(user: User, messageId: number): { message_id: number; read_at: number };
}

const CONTENT_MAX = 2000;
const LIST_LIMIT_MAX = 50;
const LIST_LIMIT_DEFAULT = 20;

export function createCandidatePortalMessages(db: DB): MessagesModule {
  const repo = createCandidateMessagesRepo(db);

  /**
   * Confirm `recipientId` is an active, messaging-eligible user. Throws
   * 404 when missing. We deliberately accept ALL three user_types as
   * valid recipients (any candidate ↔ hunter ↔ employer ↔ candidate
   * pairing is allowed within the portal).
   */
  function resolveRecipient(recipientId: string): { id: string; user_type: string } {
    if (!recipientId || typeof recipientId !== 'string') {
      throw Errors.invalidParams('to_user_id is required');
    }
    const recipient = db
      .prepare("SELECT id, user_type FROM users WHERE id = ? AND status = 'active'")
      .get(recipientId) as { id: string; user_type: string } | undefined;
    if (!recipient) throw Errors.notFound('Recipient not found');
    if (
      recipient.user_type !== 'candidate' &&
      recipient.user_type !== 'hr' &&
      recipient.user_type !== 'pm'
    ) {
      throw Errors.invalidParams('Recipient user type cannot receive messages');
    }
    return recipient;
  }

  return {
    /**
     * List messages for the caller. Defaults to `box=inbox`. `unread_only`
     * is honored only for the inbox box (sent messages have no read state
     * from the caller's perspective).
     */
    list(user: User, opts: MessagesListQuery = {}): MessagesListResult {
      if (
        user.user_type !== 'candidate' &&
        user.user_type !== 'hr' &&
        user.user_type !== 'pm'
      ) {
        throw Errors.forbidden('Invalid user type for messaging');
      }
      const limit = Math.min(Math.max(opts.limit ?? LIST_LIMIT_DEFAULT, 1), LIST_LIMIT_MAX);
      const offset = Math.max(opts.offset ?? 0, 0);
      const box = opts.box ?? 'inbox';
      // The `let` + re-assign + filter() needs a stable array element type;
      // cast to the union of the two row shapes so the filter is type-correct.
      const itemsAll: MessageListItem[] = box === 'inbox'
        ? repo.inbox(user.id, limit, offset)
        : repo.sent(user.id, limit, offset);
      // unread_only is inbox-only; for 'sent' we return as-is regardless.
      const items = (box === 'inbox' && opts.unread_only)
        ? itemsAll.filter((m) => (m as MessageRow).read_at === null)
        : itemsAll;
      const unread_count = repo.unreadCount(user.id);
      return { items, unread_count, box };
    },

    /**
     * Send a message. The recipient must exist (active user with a messaging
     * user_type). Content is trimmed and length-checked here; the router
     * layer validates shape (Zod) and rejects unknown fields.
     */
    send(user: User, input: MessageSendInput): { message_id: number } {
      if (
        user.user_type !== 'candidate' &&
        user.user_type !== 'hr' &&
        user.user_type !== 'pm'
      ) {
        throw Errors.forbidden('Invalid user type for messaging');
      }
      if (!input || typeof input !== 'object') {
        throw Errors.invalidParams('Request body is required');
      }
      const content = (input.content ?? '').toString().trim();
      if (!content) {
        throw Errors.invalidParams('Content cannot be empty');
      }
      if (content.length > CONTENT_MAX) {
        throw Errors.invalidParams(
          `Content too long (max ${CONTENT_MAX} chars)`,
          { max: CONTENT_MAX, actual: content.length },
        );
      }
      if (input.to_user_id === user.id) {
        throw Errors.invalidParams('Cannot send a message to yourself');
      }
      resolveRecipient(input.to_user_id);

      const messageId = repo.insert({
        from_user_id: user.id,
        to_user_id: input.to_user_id,
        content,
        application_id: input.application_id ?? null,
      });
      return { message_id: messageId };
    },

    /**
     * Fetch a single message. Either sender or recipient can view it (we
     * don't have sidebars yet that would hide one side from the other).
     * 404 when the message doesn't exist; 403 when the caller is neither
     * sender nor recipient.
     */
    detail(user: User, messageId: number): MessageListItem {
      if (
        user.user_type !== 'candidate' &&
        user.user_type !== 'hr' &&
        user.user_type !== 'pm'
      ) {
        throw Errors.forbidden('Invalid user type for messaging');
      }
      if (!Number.isInteger(messageId) || messageId <= 0) {
        throw Errors.invalidParams('message_id must be a positive integer');
      }
      // Try inbox first; fall back to sent. Both queries join `users` so we
      // can produce a single unified response shape from either side.
      const inboxAll = repo.inbox(user.id, 1, 0);
      const foundInbox = inboxAll.find((m) => m.id === messageId);
      if (foundInbox) return foundInbox;
      const sentAll = repo.sent(user.id, 1000, 0);
      const foundSent = sentAll.find((m) => m.id === messageId);
      if (foundSent) return foundSent;
      // The above two checks implicitly cover the authz: we only see what we
      // own. A "not mine or doesn't exist" row falls through to 404 below.
      throw Errors.notFound('Message not found');
    },

    /**
     * Mark a single received message as read. Only the recipient can mark
     * read; the repo's WHERE clause enforces this at the SQL layer (returns
     * 0 changes for non-recipients).
     */
    markRead(user: User, messageId: number): { message_id: number; read_at: number } {
      if (
        user.user_type !== 'candidate' &&
        user.user_type !== 'hr' &&
        user.user_type !== 'pm'
      ) {
        throw Errors.forbidden('Invalid user type for messaging');
      }
      if (!Number.isInteger(messageId) || messageId <= 0) {
        throw Errors.invalidParams('message_id must be a positive integer');
      }
      const readAt = Date.now();
      const ok = repo.markRead(messageId, user.id, readAt);
      if (!ok) throw Errors.notFound('Message not found');
      return { message_id: messageId, read_at: readAt };
    },
  };
}
