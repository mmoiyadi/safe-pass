/**
 * The settings index (T053, T054 — FR-019).
 *
 * Six account tasks that used to be stacked on one page, now one at a time behind an index. The
 * page was cluttered rather than broken, so nothing about any task changes — only how many of
 * them you are looking at.
 *
 * Badges come from state the application has actually loaded (FR-030). A row shows nothing at all
 * rather than a placeholder or a zero, because "0 codes" and "we have not asked yet" are
 * different facts and only one of them is worth alarming anyone about.
 */
import {
  Archive,
  ArrowLeft,
  CloudOff,
  FileText,
  History,
  KeyRound,
  Smartphone,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../../components/Icon.js';

export type SettingsPanel =
  | 'password'
  | 'twofactor'
  | 'templates'
  | 'backup'
  | 'offline'
  | 'history';

export interface SettingsBadges {
  /** Null until loaded; meaningless unless `twoFactorEnrolled` is true. */
  backupCodesRemaining: number | null;
  twoFactorEnrolled: boolean | null;
  offlineEnabled: boolean | null;
  failedSignIns: number | null;
}

const PANELS: Array<{ id: SettingsPanel; label: string; icon: LucideIcon }> = [
  { id: 'password', label: 'Master password', icon: KeyRound },
  { id: 'twofactor', label: 'Two-factor', icon: Smartphone },
  { id: 'templates', label: 'Secret types', icon: FileText },
  { id: 'backup', label: 'Backup', icon: Archive },
  { id: 'offline', label: 'Offline access', icon: CloudOff },
  { id: 'history', label: 'Recent sign-ins', icon: History },
];

function badgeFor(panel: SettingsPanel, badges: SettingsBadges): string | null {
  /*
   * Only once two-factor is actually enrolled. The endpoint reports 0 remaining codes for an
   * account that never set it up, and "0 codes" there reads as "you have used them all" — a
   * different and more alarming fact than the true one. Omitting beats saying the wrong thing
   * (FR-030). Once enrolled, 0 IS worth showing.
   */
  if (panel === 'twofactor' && badges.twoFactorEnrolled && badges.backupCodesRemaining !== null) {
    return `${badges.backupCodesRemaining} code${badges.backupCodesRemaining === 1 ? '' : 's'}`;
  }
  if (panel === 'offline' && badges.offlineEnabled) return 'On';
  if (panel === 'history' && badges.failedSignIns !== null && badges.failedSignIns > 0) {
    return `${badges.failedSignIns} failed`;
  }
  return null;
}

export function SettingsRail({
  selected,
  onSelect,
  onBack,
  badges,
}: {
  selected: SettingsPanel;
  onSelect: (panel: SettingsPanel) => void;
  onBack: () => void;
  badges: SettingsBadges;
}) {
  return (
    <nav aria-label="Account settings" className="settings-rail" style={rail}>
      {/* Renamed from "Close settings" — one of the enumerated permitted copy changes
          (FR-002b). The e2e suite selects on this string. */}
      <button type="button" onClick={onBack} style={backRow}>
        <Icon icon={ArrowLeft} size={16} />
        Back to the vault
      </button>

      <h2 style={heading}>Account</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {PANELS.map((panel) => {
          const isSelected = panel.id === selected;
          const badge = badgeFor(panel.id, badges);
          return (
            <button
              key={panel.id}
              type="button"
              onClick={() => onSelect(panel.id)}
              aria-current={isSelected ? 'true' : undefined}
              style={isSelected ? rowSelected : row}
            >
              <Icon icon={panel.icon} size={16} />
              <span style={{ flex: 1, textAlign: 'left' }}>{panel.label}</span>
              {badge && <span style={badgeStyle}>{badge}</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

const rail: React.CSSProperties = {
  width: 252,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  padding: '22px 14px',
  background: 'var(--color-surface)',
  borderRadius: 28,
  overflowY: 'auto',
};

const backRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 36,
  padding: '6px 12px',
  border: 'none',
  background: 'transparent',
  color: 'var(--color-text)',
  font: 'inherit',
  fontSize: 13.5,
  fontWeight: 600,
  cursor: 'pointer',
};

const heading: React.CSSProperties = {
  margin: 0,
  padding: '0 12px',
  fontFamily: 'var(--font-heading)',
  fontSize: 20,
  fontWeight: 400,
};

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  minHeight: 42,
  padding: '10px 12px',
  border: 'none',
  borderRadius: 999,
  background: 'transparent',
  color: 'var(--color-text)',
  font: 'inherit',
  fontSize: 14,
  cursor: 'pointer',
};

const rowSelected: React.CSSProperties = {
  ...row,
  background: 'var(--color-neutral-100)',
  boxShadow: 'var(--shadow-sm)',
  fontWeight: 700,
};

const badgeStyle: React.CSSProperties = {
  padding: '2px 8px',
  borderRadius: 999,
  background: 'var(--color-accent-200)',
  color: 'var(--color-accent-700)',
  fontSize: 11,
  fontWeight: 700,
};
