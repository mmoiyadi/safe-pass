/**
 * Search input (T070).
 *
 * Debounced, because every keystroke re-scans the whole in-memory index and typing should not
 * feel like it is fighting the machine. The delay is short enough to read as instant.
 */
import { useEffect, useRef, useState } from 'react';

const DEBOUNCE_MS = 120;

export function SearchBar({
  onQueryChange,
  resultCount,
  totalCount,
}: {
  onQueryChange: (query: string) => void;
  resultCount: number | null;
  totalCount: number;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handle = setTimeout(() => onQueryChange(value), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [value, onQueryChange]);

  // "/" to focus is the convention people already have from other tools.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (event.key === '/' && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === 'Escape' && document.activeElement === inputRef.current) {
        setValue('');
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div style={{ marginBottom: '0.85rem' }}>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search titles, folders, tags…  (press /)"
          aria-label="Search secrets"
          // Never offer history or autofill on a box that sits over vault contents.
          autoComplete="off"
          spellCheck={false}
          style={{
            width: '100%',
            padding: '0.55rem 0.7rem',
            fontSize: '1rem',
            border: '1px solid var(--border)',
            borderRadius: 5,
            background: 'var(--bg)',
            color: 'var(--fg)',
          }}
        />
      </div>

      <small style={{ color: 'var(--muted)' }}>
        {resultCount === null
          ? `${totalCount} secret${totalCount === 1 ? '' : 's'}`
          : `${resultCount} of ${totalCount} match`}
        {' · '}
        Runs entirely on this device — the server cannot read your titles, so it cannot search them.
      </small>
    </div>
  );
}
