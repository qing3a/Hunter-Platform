import { app } from 'electron';
import path from 'node:path';

export const userDataDir = (): string => app.getPath('userData');

export const dbPath = (): string => path.join(userDataDir(), 'sessions.db');

export const attachmentsDir = (): string => path.join(userDataDir(), 'attachments');

export const logsDir = (): string => path.join(userDataDir(), 'logs');
