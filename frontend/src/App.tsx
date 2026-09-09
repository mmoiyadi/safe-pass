import { useCallback, useEffect, useRef, useState } from 'react';
import type { TemplateVersionRecord } from '@pm/shared';
import './theme.css';
import { api, setReauthHandler } from './api/client.js';
import { isUnlocked, lock, onLockStateChange } from './vault/keyring.js';
import { startAutoLock } from './vault/auto-lock.js';
import { completeAfterTotp, getKeyring, loadVaults, reauthenticate, type VaultWithWraps } from './vault/session.js';
import { refreshOfflineCache } from './vault/offline-session.js';
import { isOfflineEnabled, loadSnapshot, type CachedVault } from './vault/offline-cache.js';
import { Register } from './features/register/Register.js';
import { Unlock } from './features/unlock/Unlock.js';
import { ForgotPassword } from './features/unlock/ForgotPassword.js';
import { SecretList } from './features/vault-list/SecretList.js';
import { VaultRail } from './features/shell/VaultRail.js';
import { Notices } from './features/shell/Notices.js';
import { FolderIcon, KeyRound, Settings as SettingsIcon, Users } from 'lucide-react';
import { Icon } from './components/Icon.js';
import type { VaultWithName } from './features/vault-list/vault-name.js';
import type { Screen } from './features/shell/screen.js';
import {
  SettingsRail,
  type SettingsBadges,
  type SettingsPanel,
} from './features/settings/SettingsRail.js';
import { Organise } from './features/organise/Organise.js';
import { Sharing } from './features/sharing/Sharing.js';
import type { FilterState, NamedItem } from './features/vault-list/Filters.js';
import { ChangePassword } from './features/settings/ChangePassword.js';
import { TwoFactor } from './features/settings/TwoFactor.js';
import { SignInHistory } from './features/settings/SignInHistory.js';
import { TotpStep } from './features/unlock/TotpStep.js';
import { TemplateEditor } from './features/templates/TemplateEditor.js';
import { Backup } from './features/settings/backup.js';
import { OfflineAccess } from './features/settings/OfflineAccess.js';
import { VerifyLanding } from './features/settings/VerifyEmail.js';
import { decrypt } from './crypto/envelope.js';
import { vaultKeyFor } from './vault/keyring.js';

export function App() {
  const [screen, setScreen] = useState<Screen>('unlock');
  const [email, setEmail] = useState('');
  /**
   * The signed-in address, readable from callbacks with empty dependency lists.
   * `refreshVaults` is created once and would otherwise close over the address as it was at
   * first render — the empty string — and cache the vault under the wrong account.
   */
  const emailRef = useRef('');
  /** True when this session was opened from the device's cached copy, with no network. */
  const [offline, setOffline] = useState(false);
  /** Read from callbacks with empty dependency lists, which cannot see current state. */
  const offlineRef = useRef(false);
  const vaultsRef = useRef<VaultWithWraps[]>([]);
  /**
   * A verification token in the URL. Read once at startup and stripped from the address bar
   * immediately: a token in a URL ends up in browser history, and this one is single-use.
   */
  const [verifyToken, setVerifyToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const token = new URLSearchParams(window.location.search).get('token');
    if (token) window.history.replaceState({}, '', window.location.pathname);
    return token;
  });
  /** The cached vault contents backing an offline session, keyed by vault id. */
  const [cachedVaults, setCachedVaults] = useState<Map<string, CachedVault>>(new Map());
  const [vaults, setVaults] = useState<VaultWithName[]>([]);
  const [selectedVaultId, setSelectedVaultId] = useState<string>('');
  const [templates, setTemplates] = useState<TemplateVersionRecord[]>([]);
  const [reauthNeeded, setReauthNeeded] = useState(false);
  /** Held only between password and second factor; discarded either way. */
  const [pendingTotp, setPendingTotp] = useState<{ email: string; password: string; userKey: Uint8Array } | null>(null);
  const [organise, setOrganise] = useState<{
    folders: NamedItem[];
    tags: NamedItem[];
    folderCounts: Map<string, number>;
    tagCounts: Map<string, number>;
    unfiled: number;
    total: number;
  }>({
    folders: [],
    tags: [],
    folderCounts: new Map(),
    tagCounts: new Map(),
    unfiled: 0,
    total: 0,
  });
  /**
   * Filter state lives here, not in `SecretList`, because two components now render it: the rail
   * offers the controls and the list obeys them (T021a). Two copies would drift apart the first
   * time one of them re-mounted.
   */
  const [filters, setFilters] = useState<FilterState>({ folderId: null, tagIds: [] });
  const [reloadKey, setReloadKey] = useState(0);
  /** Which of the six account tasks is on screen. Reset on each entry to settings. */
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanel>('password');
  const [badges, setBadges] = useState<SettingsBadges>({
    backupCodesRemaining: null,
    twoFactorEnrolled: null,
    offlineEnabled: null,
    failedSignIns: null,
  });

  const handleDataChanged = useCallback(
    (next: {
      folders: NamedItem[];
      tags: NamedItem[];
      folderCounts: Map<string, number>;
      tagCounts: Map<string, number>;
      unfiled: number;
      total: number;
    }) => {
      setOrganise(next);

      /*
       * Refresh the offline copy whenever the vault's contents change.
       *
       * Without this the copy was written once at sign-in and never again, so a secret added
       * afterwards simply was not there offline — the feature appeared to work while quietly
       * serving a snapshot from the start of the session. Found by the end-to-end offline test,
       * which adds a secret and then pulls the network, as a user would.
       *
       * Skipped in an offline session: there is nothing to refresh from, and re-writing the
       * cache from the cache would be pointless at best.
       */
      if (!offlineRef.current) {
        const keyring = getKeyring();
        if (keyring) {
          void refreshOfflineCache({
            email: emailRef.current,
            keyring,
            vaults: vaultsRef.current,
          });
        }
      }
    },
    [],
  );

  /*
   * The index badges (T054, FR-030).
   *
   * Loaded here rather than lifted out of the three panels, because a panel only mounts when it
   * is chosen and a badge that appears only after you have already visited the row tells you
   * nothing. Every fetch is best-effort: a failure leaves the value null and the row simply
   * carries no badge, which is the honest rendering of "we do not know" — and is what an offline
   * session gets, since none of these can be reached without a network.
   */
  useEffect(() => {
    if (screen !== 'settings') return;
    setSettingsPanel('password');

    let cancelled = false;
    void (async () => {
      const [totp, signIns, offlineOn] = await Promise.all([
        api<{ enrolled: boolean; backupCodesRemaining: number }>('GET', '/auth/totp').catch(
          () => null,
        ),
        api<Array<{ outcome: string }>>('GET', '/security/sign-ins').catch(() => null),
        isOfflineEnabled().catch(() => null),
      ]);
      if (cancelled) return;
      setBadges({
        backupCodesRemaining: totp?.backupCodesRemaining ?? null,
        twoFactorEnrolled: totp?.enrolled ?? null,
        failedSignIns: signIns ? signIns.filter((e) => e.outcome !== 'success').length : null,
        offlineEnabled: offlineOn,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [screen]);

  useEffect(() => startAutoLock(), []);

  // The lock state is the single source of truth for what is reachable. When the keyring is
  // cleared — by auto-lock, sign-out, or a REAUTH_REQUIRED response — every vault screen must
  // become unreachable in the same tick, not on the next navigation.
  useEffect(
    () =>
      onLockStateChange((unlocked) => {
        if (!unlocked) setScreen((s) => (s === 'vault' || s === 'settings' ? 'unlock' : s));
      }),
    [],
  );

  useEffect(() => setReauthHandler(() => setReauthNeeded(true)), []);

  /** Vault names are encrypted under each vault's own key, so they decrypt after unlock. */
  const refreshVaults = useCallback(async (): Promise<VaultWithName[]> => {
    const loaded = await loadVaults();
    const named: VaultWithName[] = [];
    for (const vault of loaded) {
      let decryptedName = 'Untitled vault';
      try {
        decryptedName = await decrypt(vaultKeyFor(vault.id, vault.nameKeyVersion), vault.name);
      } catch {
        // A name at a generation this device does not hold is a rotation still in flight.
        // Showing a placeholder is better than hiding the vault entirely.
        decryptedName = 'Vault (re-encrypting)';
      }
      named.push({ ...vault, decryptedName });
    }

    // Best-effort: the encrypted copy is refreshed from what was just fetched, so a later
    // offline unlock opens the same vault. Never allowed to fail the sign-in (FR-054).
    vaultsRef.current = loaded;
    const keyring = getKeyring();
    if (keyring) void refreshOfflineCache({ email: emailRef.current, keyring, vaults: loaded });
    setVaults(named);
    setSelectedVaultId((current) => {
      if (current && named.some((v) => v.id === current && v.status === 'active')) return current;
      return named.find((v) => v.status === 'active')?.id ?? '';
    });
    return named;
  }, []);

  const refreshTemplates = useCallback(async () => {
    setTemplates(await api<TemplateVersionRecord[]>('GET', '/templates'));
  }, []);

  const enterVault = useCallback(
    async (userEmail: string, offline = false) => {
      setEmail(userEmail);
      emailRef.current = userEmail;
      setOffline(offline);
      offlineRef.current = offline;

      if (offline) {
        // Everything comes from the cache; the network is not there to ask. The keyring and
        // vault keys are already in memory — `unlockOffline` put them there.
        const snapshot = await loadSnapshot(userEmail);
        const cached = snapshot?.vaults ?? [];
        const named: VaultWithName[] = [];
        for (const vault of cached) {
          let decryptedName = 'Untitled vault';
          try {
            decryptedName = await decrypt(vaultKeyFor(vault.id, vault.nameKeyVersion), vault.name);
          } catch {
            decryptedName = 'Vault (re-encrypting)';
          }
          named.push({
            id: vault.id,
            name: vault.name,
            kind: vault.kind,
            keyVersion: vault.keyVersion,
            nameKeyVersion: vault.nameKeyVersion,
            role: vault.role,
            status: 'active',
            // A rotation cannot be observed or joined from a cached copy; the banner would be
            // stale and the action impossible, so it stays off until the device reconnects.
            rotationPending: false,
            decryptedName,
          });
        }
        setVaults(named);
        setCachedVaults(new Map(cached.map((v) => [v.id, v])));
        setSelectedVaultId((current) => current || (named[0]?.id ?? ''));
        setTemplates(cached[0]?.templates ?? []);
        setScreen('vault');
        return;
      }

      const [, loadedTemplates] = await Promise.all([
        refreshVaults(),
        api<TemplateVersionRecord[]>('GET', '/templates'),
      ]);
      setTemplates(loadedTemplates);
      setScreen('vault');
    },
    [refreshVaults],
  );

  // Handled first, and without a session: the link arrives in a mail client, on any device.
  if (verifyToken) {
    return <VerifyLanding token={verifyToken} onDone={() => setVerifyToken(null)} />;
  }

  if (pendingTotp) {
    return (
      <TotpStep
        userKey={pendingTotp.userKey}
        onVerified={async () => {
          await completeAfterTotp(pendingTotp.email, pendingTotp.password);
          const email = pendingTotp.email;
          // The password is not kept a moment past the unlock it was needed for.
          pendingTotp.userKey.fill(0);
          setPendingTotp(null);
          await enterVault(email);
        }}
        onCancel={() => {
          pendingTotp.userKey.fill(0);
          setPendingTotp(null);
        }}
      />
    );
  }

  if (reauthNeeded) {
    return <ReauthPrompt email={email} onDone={() => { setReauthNeeded(false); void enterVault(email); }} />;
  }

  if (screen === 'register') {
    return <Register onRegistered={(e) => void enterVault(e)} />;
  }
  if (screen === 'forgot') {
    return <ForgotPassword onBack={() => setScreen('unlock')} />;
  }
  if (!isUnlocked() || screen === 'unlock') {
    return (
      <Unlock
        onUnlocked={(e, offline) => void enterVault(e, offline)}
        onTotpRequired={(e, password, userKey) => setPendingTotp({ email: e, password, userKey })}
        onForgot={() => setScreen('forgot')}
        onRegister={() => setScreen('register')}
      />
    );
  }

  const active = vaults.filter((v) => v.status === 'active');
  const vault = active.find((v) => v.id === selectedVaultId) ?? active[0];
  const keyring = getKeyring();
  return (
    /*
     * The three-pane shell (T019, FR-013). The page itself does not scroll: each pane scrolls
     * independently, so the rail and the list headers stay put while their contents move. This
     * is what replaces four stacked strips and a page that grew downwards forever.
     *
     * The list/detail split inside `content` arrives with the list column (Phase 4); until then
     * the vault content occupies the whole region.
     */
    <main className="workbench" style={shell}>
      {/* Settings is an account screen, not a vault one, so it brings its own index in place
          of the vault rail rather than sitting beside it (FR-019). */}
      {screen === 'settings' ? (
        <SettingsRail
          selected={settingsPanel}
          onSelect={setSettingsPanel}
          onBack={() => setScreen('vault')}
          badges={badges}
        />
      ) : (
      <VaultRail
        screen={screen}
        vaults={active}
        selectedVaultId={vault?.id ?? ''}
        onSelectVault={(id) => {
          setSelectedVaultId(id);
          /*
           * Filters are vault-scoped — a folder id from the vault being left matches nothing in
           * the vault being entered, and would silently show an empty list. Clearing them is the
           * FR-017 rule applied to a change of vault (FR-017a).
           */
          setFilters({ folderId: null, tagIds: [] });
          setReloadKey((k) => k + 1);
        }}
        onVaultCreated={async () => {
          await refreshVaults();
          setReloadKey((k) => k + 1);
        }}
        onNavigate={setScreen}
        folders={organise.folders}
        tags={organise.tags}
        counts={{
          byFolder: organise.folderCounts,
          byTag: organise.tagCounts,
          unfiled: organise.unfiled,
        }}
        total={organise.total}
        filters={filters}
        onFiltersChange={setFilters}
        email={email}
        onLock={() => {
          /*
           * Lock clears the in-memory keys and NOTHING else.
           *
           * It must not discard the offline copy: locking is the ordinary end of a session, and
           * "unlock later, with no network" is the entire point of holding that copy (FR-054).
           * Clearing it here made offline access work exactly once per device — caught by the
           * end-to-end offline test, which locks before going offline the way a real user would.
           *
           * The copy is discarded where FR-058 actually asks: when the user turns offline access
           * off, when it goes stale, and when access to a vault is revoked.
           */
          lock();
          setScreen('unlock');
        }}
        offline={offline}
      />
      )}

      <div className="workbench-content" style={content}>
        <Notices
          offline={offline}
          vaults={vaults}
          onInvitationResponded={async () => {
            await refreshVaults();
            setReloadKey((k) => k + 1);
          }}
        />

      {screen === 'settings' && (
        <div className="pane" style={settingsPane}>
          {settingsPanel === 'password' &&
            (keyring ? (
              <ChangePassword
                email={email}
                wrappedUserKey={keyring.wrappedUserKey}
                onChanged={() => {
                  lock();
                  setScreen('unlock');
                }}
              />
            ) : (
              <p style={{ color: 'var(--color-neutral-700)' }}>
                Changing the master password needs your wrapped key, which is fetched at sign-in.
                Lock and sign in again to use this screen.
              </p>
            ))}
          {settingsPanel === 'twofactor' && <TwoFactor email={email} />}
          {/* Account-scoped, like everything else on this screen: a template belongs to the
              user and is usable in any of their vaults, so it does not sit under a vault tab. */}
          {settingsPanel === 'templates' && (
            <TemplateEditor templates={templates} onChanged={refreshTemplates} />
          )}
          {settingsPanel === 'backup' && (
            <Backup
              email={email}
              vaults={vaults}
              keyring={keyring}
              onRestored={async () => {
                await refreshVaults();
                setReloadKey((k) => k + 1);
              }}
            />
          )}
          {settingsPanel === 'offline' && <OfflineAccess email={email} />}
          {settingsPanel === 'history' && <SignInHistory />}
        </div>
      )}

      {screen === 'sharing' && vault && (
        <div className="pane" style={settingsPane}>
        <Sharing
          vaultId={vault.id}
          keyVersion={vault.keyVersion}
          personal={vault.kind === 'personal'}
          myRole={vault.role}
          onChanged={async () => {
            await refreshVaults();
            setReloadKey((k) => k + 1);
          }}
        />
        </div>
      )}

      {screen === 'organise' && vault && (
        <div className="pane" style={settingsPane}>
        <Organise
          vaultId={vault.id}
          folders={organise.folders}
          tags={organise.tags}
          folderCounts={organise.folderCounts}
          onChanged={async () => setReloadKey((k) => k + 1)}
        />
        </div>
      )}
      {/* Kept mounted across the Organise screen so its decrypted set and search index are not
          rebuilt on every navigation; hidden rather than unmounted. */}
      {vault && templates.length > 0 && (
        <div hidden={screen !== 'vault'} style={screen === 'vault' ? vaultPanes : undefined}>
          <SecretList
            key={`${vault.id}:${reloadKey}`}
            vaultId={vault.id}
            templates={templates}
            vault={vault}
            cached={offline ? cachedVaults.get(vault.id) : undefined}
            filters={filters}
            onDataChanged={handleDataChanged}
          />
        </div>
      )}
        {screen === 'vault' && templates.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>No templates seeded. Run: pnpm db:reset</p>
        )}
      </div>

      {/*
        The stacked layout's primary navigation (T065). Shown by CSS below the breakpoint only.

        The handoff draws five destinations including a plus circle for a new secret. The plus is
        NOT here: "New secret" is already a full-width button at the foot of the list column on
        every narrow screen, so a second control for it would duplicate an action rather than
        reach one that is otherwise unreachable — and this redesign adds no capability (FR-001).
      */}
      <nav aria-label="Sections" className="bottom-bar">
        {(
          [
            { screen: 'vault', label: 'Secrets', icon: KeyRound },
            { screen: 'organise', label: 'Organise', icon: FolderIcon },
            { screen: 'sharing', label: 'Sharing', icon: Users },
            { screen: 'settings', label: 'Account', icon: SettingsIcon },
          ] as const
        ).map((item) => (
          <button
            key={item.screen}
            type="button"
            onClick={() => setScreen(item.screen)}
            aria-current={screen === item.screen ? 'page' : undefined}
            style={screen === item.screen ? bottomTabActive : bottomTab}
          >
            <Icon icon={item.icon} size={18} />
            {item.label}
          </button>
        ))}
      </nav>
    </main>
  );
}

function ReauthPrompt({ email, onDone }: { email: string; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="column">
      <h1>Re-enter your master password</h1>
      <p>
        Your master password was changed on another device, so the keys this device was holding
        are no longer current. Enter the new password to continue.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void reauthenticate(email, password)
            .then(onDone)
            .catch(() => setError('That master password is not current.'));
        }}
      >
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
          style={{ display: 'block', width: '100%', padding: '0.55rem 0.7rem', fontSize: '1rem', border: '1px solid var(--border)', borderRadius: 5, background: 'var(--bg)', color: 'var(--fg)' }} />
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        <button type="submit" style={{ marginTop: '1rem', padding: '0.6rem 1.1rem', border: 'none', borderRadius: 5, background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>
          Continue
        </button>
      </form>
    </main>
  );
}

/**
 * The workbench shell (T019). Fills the window; the page never scrolls, each pane does.
 *
 * `accountBar`, `vaultRegion`, `vaultTabs`, `vaultTab`, `vaultTabActive`, `navButton` and
 * `navButtonActive` were deleted here (T026). They described the four stacked strips the rail
 * replaces, and left in place they would invite a return to the old vocabulary.
 */
const shell: React.CSSProperties = {
  display: 'flex',
  gap: 16,
  padding: 16,
  height: '100vh',
  margin: 0,
  background: 'var(--color-bg)',
  overflow: 'hidden',
};

/**
 * The vault's two panes. Applied only while visible: when the region is `hidden`, leaving the
 * inline `display` off lets the user-agent rule hide it, since an inline `display: flex` would
 * override `[hidden]` and the region would stay on screen behind the settings.
 */
const vaultPanes: React.CSSProperties = { display: 'flex', flex: 1, minHeight: 0 };

const bottomTab: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 2,
  flex: 1,
  minHeight: 44,
  padding: '6px 4px',
  border: 'none',
  borderRadius: 999,
  background: 'transparent',
  color: 'var(--color-neutral-700)',
  font: 'inherit',
  // The measured floor for interactive text is 12.5px (FR-029, T067a).
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
};

const bottomTabActive: React.CSSProperties = {
  ...bottomTab,
  background: 'var(--color-neutral-100)',
  color: 'var(--color-text)',
  fontWeight: 700,
};

/** The settings content pane. One task on screen at a time (FR-019). */
const settingsPane: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '34px 36px',
  borderRadius: 28,
  background: 'var(--color-neutral-100)',
  overflowY: 'auto',
};

/** Everything right of the rail: the notice slot, then whichever screen is showing. */
const content: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minHeight: 0,
};
