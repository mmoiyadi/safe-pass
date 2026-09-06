/**
 * Seeds the four built-in templates (FR-036).
 *
 * These are ROWS, not code. Adding a fifth secret type is an insert, not a migration and not
 * a deploy — that is what Constitution Principle V requires, and what
 * tests/integration/no-migration.test.ts asserts.
 *
 * `sensitive: true` is what drives encryption. Which fields are secret is a property of the
 * data, never of the rendering code (FR-041).
 */
import { prisma } from './client.js';

type Field = {
  id: string;
  label: string;
  type: 'text' | 'password' | 'email' | 'url' | 'number' | 'date' | 'totp' | 'multiline';
  required: boolean;
  sensitive: boolean;
  order: number;
};

const BUILT_INS: Array<{ name: string; fields: Field[] }> = [
  {
    name: 'Website Account',
    fields: [
      { id: 'url', label: 'Website', type: 'url', required: false, sensitive: false, order: 0 },
      { id: 'username', label: 'Username', type: 'text', required: true, sensitive: false, order: 1 },
      { id: 'password', label: 'Password', type: 'password', required: true, sensitive: true, order: 2 },
      { id: 'totp', label: 'One-time code', type: 'totp', required: false, sensitive: true, order: 3 },
      { id: 'notes', label: 'Notes', type: 'multiline', required: false, sensitive: true, order: 4 },
    ],
  },
  {
    name: 'Credit Card',
    fields: [
      { id: 'cardholder', label: 'Cardholder', type: 'text', required: true, sensitive: false, order: 0 },
      { id: 'number', label: 'Card number', type: 'text', required: true, sensitive: true, order: 1 },
      { id: 'expiry', label: 'Expires', type: 'text', required: true, sensitive: true, order: 2 },
      { id: 'cvv', label: 'Security code', type: 'password', required: true, sensitive: true, order: 3 },
      { id: 'pin', label: 'PIN', type: 'password', required: false, sensitive: true, order: 4 },
      { id: 'notes', label: 'Notes', type: 'multiline', required: false, sensitive: true, order: 5 },
    ],
  },
  {
    name: 'Identity / PAN Card',
    fields: [
      { id: 'fullName', label: 'Full name', type: 'text', required: true, sensitive: false, order: 0 },
      { id: 'pan', label: 'PAN number', type: 'text', required: true, sensitive: true, order: 1 },
      { id: 'dob', label: 'Date of birth', type: 'date', required: false, sensitive: true, order: 2 },
      { id: 'issued', label: 'Issued by', type: 'text', required: false, sensitive: false, order: 3 },
      { id: 'notes', label: 'Notes', type: 'multiline', required: false, sensitive: true, order: 4 },
    ],
  },
  {
    name: 'Secure Note',
    fields: [
      { id: 'body', label: 'Note', type: 'multiline', required: true, sensitive: true, order: 0 },
    ],
  },
];

export async function seedBuiltInTemplates(): Promise<void> {
  for (const spec of BUILT_INS) {
    const existing = await prisma.templateVersion.findFirst({
      where: { name: spec.name, template: { kind: 'builtin' } },
    });
    if (existing) continue;

    const template = await prisma.template.create({ data: { kind: 'builtin', ownerId: null } });
    const version = await prisma.templateVersion.create({
      data: { templateId: template.id, version: 1, name: spec.name, fields: spec.fields },
    });
    await prisma.template.update({
      where: { id: template.id },
      data: { currentVersionId: version.id },
    });
  }
}

const isEntrypoint = process.argv[1]?.endsWith('seed.ts');
if (isEntrypoint) {
  await seedBuiltInTemplates();
  await prisma.$disconnect();
}
