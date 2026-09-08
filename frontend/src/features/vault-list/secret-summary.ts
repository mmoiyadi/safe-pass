/**
 * What a single list row can say about a secret (FR-014a, FR-014b, FR-023a).
 *
 * The row shows one summary value and offers one quick copy, and both have to cope with secrets
 * that have neither. The built-in `Secure Note` has exactly one field and it is `sensitive`, so
 * it has no summary value at all — reachable with seed data, not a hypothetical.
 *
 * The rule throughout is FR-030's: where a value cannot be sourced, omit the element rather than
 * fake it. No placeholder, no mask, no field label standing in for a value, and no disabled
 * button whose purpose the user cannot discover.
 */
import type { TemplateField, TemplateVersionRecord } from '@pm/shared';
import type { CustomField } from '../secret-detail/CustomFields.js';

export interface SummarisableSecret {
  fields: Record<string, string>;
  custom: CustomField[];
}

function orderedFields(template: TemplateVersionRecord | undefined): TemplateField[] {
  return [...((template?.fields ?? []) as TemplateField[])].sort((a, b) => a.order - b.order);
}

/**
 * The third part of the summary line, or null when the secret has no non-sensitive value.
 *
 * Template fields are consulted in their declared order, then the secret's own custom fields.
 * A custom field is as much the user's data as a template one, so a secret whose only readable
 * value lives there should still say something.
 */
export function summaryValue(
  secret: SummarisableSecret,
  template: TemplateVersionRecord | undefined,
): string | null {
  for (const field of orderedFields(template)) {
    if (field.sensitive) continue;
    const value = secret.fields[field.id];
    if (value) return value;
  }
  for (const field of secret.custom) {
    if (field.sensitive) continue;
    if (field.value) return field.value;
  }
  return null;
}

/**
 * The field the row's quick-copy control acts on, or null when there is nothing sensitive to
 * copy — in which case the control is not rendered at all (FR-014b).
 *
 * Empty values do not count: a sensitive field that was never filled in has nothing to put on
 * the clipboard, and a control that copies an empty string is worse than no control.
 */
export function firstSensitiveField(
  secret: SummarisableSecret,
  template: TemplateVersionRecord | undefined,
): { label: string; value: string } | null {
  for (const field of orderedFields(template)) {
    if (!field.sensitive) continue;
    const value = secret.fields[field.id];
    if (value) return { label: field.label, value };
  }
  for (const field of secret.custom) {
    if (!field.sensitive) continue;
    if (field.value) return { label: field.label, value: field.value };
  }
  return null;
}

const graphemes =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/**
 * The letter in the row avatar (FR-023a).
 *
 * A grapheme cluster rather than a code unit, so an emoji, a flag or a combining accent renders
 * whole instead of as half a character. Uppercasing is left to the locale: scripts without case
 * are unchanged by `toUpperCase`, so no special-casing is needed to leave them alone.
 *
 * A title that is empty or starts with whitespace yields no character. The avatar still renders
 * — its tint carries the template — but nothing is invented to fill it.
 */
export function avatarInitial(title: string): string {
  if (title.length === 0 || /^\s/.test(title)) return '';
  if (graphemes) {
    const [first] = graphemes.segment(title);
    return (first?.segment ?? '').toUpperCase();
  }
  return ([...title][0] ?? '').toUpperCase();
}
