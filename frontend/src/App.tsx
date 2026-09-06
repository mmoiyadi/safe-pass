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
import { Organise } from './features/organise/Organise.js';
import type { NamedItem } from './features/vault-list/Filters.js';
import { ChangePassword } from './features/settings/ChangePassword.js';

type Screen = 'unlock' | 'register' | 'forgot' | 'vault' | 'settings' | 'organise';

export function App() {
  const [screen, setScreen] = useState<Screen>('unlock');
  const [email, setEmail] = useState('');
  const [vaults, setVaults] = useState<VaultSummary[]>([]);
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

  const enterVault = useCallback(async (userEmail: string) => {
    setEmail(userEmail);
    const [loaded, loadedTemplates] = await Promise.all([
      loadVaults(),
      api<TemplateVersionRecord[]>('GET', '/templates'),
    ]);
    setVaults(loaded);
    setTemplates(loadedTemplates);
    setScreen('vault');
  }, []);

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

  const vault = vaults[0];
  const keyring = getKeyring();
  return (
    <main>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
        <h1 style={{ fontSize: '1.3rem', margin: 0 }}>{email}</h1>
        <nav style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" onClick={() => setScreen(screen === 'vault' ? 'organise' : 'vault')} style={navButton}>
            {screen === 'vault' ? 'Organise' : 'Vault'}
          </button>
          <button type="button" onClick={() => setScreen(screen === 'settings' ? 'vault' : 'settings')} style={navButton}>
            {screen === 'settings' ? 'Vault' : 'Settings'}
          </button>
          <button type="button" onClick={() => { lock(); setScreen('unlock'); }} style={navButton}>
            Lock
          </button>
        </nav>
      </header>

      {screen === 'settings' && keyring && (
        <ChangePassword email={email} wrappedUserKey={keyring.wrappedUserKey} onChanged={() => { lock(); setScreen('unlock'); }} />
      )}
      {screen === 'settings' && !keyring && (
        <p style={{ color: 'var(--muted)' }}>
          Changing the master password needs your wrapped key, which is fetched at sign-in. Lock
          and sign in again to use this screen.
        </p>
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
            key={reloadKey}
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

const navButton: React.CSSProperties = {
  padding: '0.35rem 0.7rem',
  fontSize: '0.9rem',
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--fg)',
  cursor: 'pointer',
};
