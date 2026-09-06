import { useCallback, useEffect, useState } from 'react';
import type { TemplateVersionRecord, VaultSummary } from '@pm/shared';
import './theme.css';
import { api, setReauthHandler } from './api/client.js';
import { isUnlocked, lock, onLockStateChange } from './vault/keyring.js';
import { startAutoLock } from './vault/auto-lock.js';
import { getKeyring, loadVaults, reauthenticate } from './vault/session.js';
import { Register } from './features/register/Register.js';
import { Unlock } from './features/unlock/Unlock.js';
import { ForgotPassword } from './features/unlock/ForgotPassword.js';
import { SecretList } from './features/vault-list/SecretList.js';
import { VaultSwitcher, type VaultWithName } from './features/vault-list/VaultSwitcher.js';
import { Organise } from './features/organise/Organise.js';
import { Sharing } from './features/sharing/Sharing.js';
import { IncomingInvitations } from './features/sharing/IncomingInvitations.js';
import type { NamedItem } from './features/vault-list/Filters.js';
import { ChangePassword } from './features/settings/ChangePassword.js';
import { decrypt } from './crypto/envelope.js';
import { vaultKeyFor } from './vault/keyring.js';

type Screen = 'unlock' | 'register' | 'forgot' | 'vault' | 'settings' | 'organise' | 'sharing';

export function App() {
  const [screen, setScreen] = useState<Screen>('unlock');
  const [email, setEmail] = useState('');
  const [vaults, setVaults] = useState<VaultWithName[]>([]);
  const [selectedVaultId, setSelectedVaultId] = useState<string>('');
  const [templates, setTemplates] = useState<TemplateVersionRecord[]>([]);
  const [reauthNeeded, setReauthNeeded] = useState(false);
  const [organise, setOrganise] = useState<{
    folders: NamedItem[];
    tags: NamedItem[];
    folderCounts: Map<string, number>;
  }>({ folders: [], tags: [], folderCounts: new Map() });
  const [reloadKey, setReloadKey] = useState(0);

  const handleDataChanged = useCallback(
    (folders: NamedItem[], tags: NamedItem[], folderCounts: Map<string, number>) =>
      setOrganise({ folders, tags, folderCounts }),
    [],
  );

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
    const loaded: VaultSummary[] = await loadVaults();
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
    setVaults(named);
    setSelectedVaultId((current) => {
      if (current && named.some((v) => v.id === current && v.status === 'active')) return current;
      return named.find((v) => v.status === 'active')?.id ?? '';
    });
    return named;
  }, []);

  const enterVault = useCallback(
    async (userEmail: string) => {
      setEmail(userEmail);
      const [, loadedTemplates] = await Promise.all([
        refreshVaults(),
        api<TemplateVersionRecord[]>('GET', '/templates'),
      ]);
      setTemplates(loadedTemplates);
      setScreen('vault');
    },
    [refreshVaults],
  );

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
        onUnlocked={(e) => void enterVault(e)}
        onForgot={() => setScreen('forgot')}
        onRegister={() => setScreen('register')}
      />
    );
  }

  const active = vaults.filter((v) => v.status === 'active');
  const vault = active.find((v) => v.id === selectedVaultId) ?? active[0];
  const keyring = getKeyring();
  return (
    <main>
      {/*
        Two levels, because there are two levels. Settings and Lock act on the account and the
        session; Secrets, Organise and Sharing act on whichever vault is selected and silently
        re-target when it changes. Presenting them as one flat row claimed they were peers, and
        gave no signal about which half a vault switch had just changed the meaning of.
      */}
      <header style={accountBar}>
        <h1 style={{ fontSize: '1.15rem', margin: 0 }}>{email}</h1>
        <nav aria-label="Account" style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={() => setScreen('settings')}
            aria-current={screen === 'settings' ? 'page' : undefined}
            style={screen === 'settings' ? navButtonActive : navButton}
          >
            Settings
          </button>
          <button type="button" onClick={() => { lock(); setScreen('unlock'); }} style={navButton}>
            Lock
          </button>
        </nav>
      </header>

      <IncomingInvitations
        vaults={vaults}
        onResponded={async () => {
          await refreshVaults();
          setReloadKey((k) => k + 1);
        }}
      />

      {vault && screen !== 'settings' && (
        <section aria-label="Vault" style={vaultRegion}>
          <VaultSwitcher
            vaults={active}
            selectedId={vault.id}
            onSelect={(id) => {
              setSelectedVaultId(id);
              // Stay on the same kind of screen, now pointed at the vault just chosen —
              // switching vault should not also throw away what you were doing.
              setReloadKey((k) => k + 1);
            }}
            onCreated={async () => {
              await refreshVaults();
              setReloadKey((k) => k + 1);
            }}
          />

          <nav aria-label={`Actions for this vault`} style={vaultTabs}>
            {(['vault', 'organise', 'sharing'] as const).map((target) => (
              <button
                key={target}
                type="button"
                onClick={() => setScreen(target)}
                aria-current={screen === target ? 'page' : undefined}
                style={screen === target ? vaultTabActive : vaultTab}
              >
                {target === 'vault' ? 'Secrets' : target === 'organise' ? 'Folders & tags' : 'Sharing'}
              </button>
            ))}
          </nav>
        </section>
      )}

      {screen === 'settings' && keyring && (
        <ChangePassword
          email={email}
          wrappedUserKey={keyring.wrappedUserKey}
          onChanged={() => {
            lock();
            setScreen('unlock');
          }}
        />
      )}
      {screen === 'settings' && !keyring && (
        <p style={{ color: 'var(--muted)' }}>
          Changing the master password needs your wrapped key, which is fetched at sign-in. Lock
          and sign in again to use this screen.
        </p>
      )}

      {screen === 'sharing' && vault && (
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
      )}

      {screen === 'organise' && vault && (
        <Organise
          vaultId={vault.id}
          folders={organise.folders}
          tags={organise.tags}
          folderCounts={organise.folderCounts}
          onChanged={async () => setReloadKey((k) => k + 1)}
        />
      )}
      {/* Kept mounted across the Organise screen so its decrypted set and search index are not
          rebuilt on every navigation; hidden rather than unmounted. */}
      {vault && templates.length > 0 && (
        <div hidden={screen !== 'vault'}>
          <SecretList
            key={`${vault.id}:${reloadKey}`}
            vaultId={vault.id}
            templates={templates}
            shared={vault.kind !== 'personal'}
            onDataChanged={handleDataChanged}
          />
        </div>
      )}
      {screen === 'vault' && templates.length === 0 && (
        <p style={{ color: 'var(--muted)' }}>No templates seeded. Run: pnpm db:reset</p>
      )}
    </main>
  );
}

function ReauthPrompt({ email, onDone }: { email: string; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <main>
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

const accountBar: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '1rem',
  paddingBottom: '0.6rem',
  borderBottom: '1px solid var(--border)',
  marginBottom: '0.9rem',
};

/** The vault and everything scoped to it, visually contained so the nesting is legible. */
const vaultRegion: React.CSSProperties = {
  marginBottom: '1.1rem',
};

const vaultTabs: React.CSSProperties = {
  display: 'flex',
  gap: '0.25rem',
  marginTop: '0.6rem',
  borderBottom: '1px solid var(--border)',
};

const vaultTab: React.CSSProperties = {
  padding: '0.4rem 0.8rem',
  fontSize: '0.92rem',
  border: 'none',
  borderBottom: '2px solid transparent',
  background: 'transparent',
  color: 'var(--muted)',
  cursor: 'pointer',
  marginBottom: '-1px',
};

const vaultTabActive: React.CSSProperties = {
  ...vaultTab,
  color: 'var(--fg)',
  borderBottom: '2px solid var(--accent)',
  fontWeight: 600,
};

const navButtonActive: React.CSSProperties = {
  padding: '0.35rem 0.7rem',
  fontSize: '0.9rem',
  borderRadius: 4,
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: '#fff',
  cursor: 'pointer',
};

const navButton: React.CSSProperties = {
  padding: '0.35rem 0.7rem',
  fontSize: '0.9rem',
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--fg)',
  cursor: 'pointer',
};
