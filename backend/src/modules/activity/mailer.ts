/**
 * Outbound mail.
 *
 * In development this writes to the Mailpit container from docker-compose, so quickstart V13
 * can assert that an invitation email discloses no vault name (FR-066).
 *
 * Message bodies must never contain a secret value, a key, or a token that grants vault
 * access — only tokens that prove control of the mailbox.
 */
import { createConnection } from 'node:net';

export interface Mail {
  to: string;
  subject: string;
  body: string;
}

const SMTP_URL = process.env['SMTP_URL'] ?? 'smtp://localhost:1025';

/** Minimal SMTP: enough for a local catcher, replaced by a provider SDK before production. */
export async function sendMail(mail: Mail): Promise<void> {
  const url = new URL(SMTP_URL);
  const host = url.hostname;
  const port = Number(url.port || 25);

  await new Promise<void>((resolve) => {
    const socket = createConnection({ host, port }, () => {
      const lines = [
        `EHLO localhost`,
        `MAIL FROM:<no-reply@passwordmanager.local>`,
        `RCPT TO:<${mail.to}>`,
        `DATA`,
        `From: Password Manager <no-reply@passwordmanager.local>`,
        `To: ${mail.to}`,
        `Subject: ${mail.subject}`,
        ``,
        mail.body,
        `.`,
        `QUIT`,
      ];
      socket.write(lines.join('\r\n') + '\r\n');
    });
    // Mail must never block or fail a request: a delivery problem is not a reason to refuse
    // an account deletion or a password change.
    socket.on('error', () => resolve());
    socket.on('close', () => resolve());
    setTimeout(() => {
      socket.destroy();
      resolve();
    }, 3000);
  });
}
