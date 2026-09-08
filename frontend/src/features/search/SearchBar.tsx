/**
 * Search input (T070).
 *
 * Debounced, because every keystroke re-scans the whole in-memory index and typing should not
 * feel like it is fighting the machine. The delay is short enough to read as instant.
 */
import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Icon } from '../../components/Icon.js';

const DEBOUNCE_MS = 120;

export function SearchBar({ onQueryChange }: { onQueryChange: (query: string) => void }) {
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
    <div style={pill}>
      <Icon icon={Search} size={16} style={{ color: 'var(--color-neutral-700)' }} />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        // Shortened because the "/" hint is now a badge rather than part of the placeholder
        // (FR-002b). Nothing else about this string changes.
        placeholder="Search titles, folders, tags"
        aria-label="Search secrets"
        // Never offer history or autofill on a box that sits over vault contents.
        autoComplete="off"
        spellCheck={false}
        style={input}
      />
      {/*
        Decorative: the shortcut it advertises still works, but announcing "/" to a screen
        reader would read as content rather than as the affordance it is (FR-026d).
      */}
      <kbd aria-hidden style={badge}>
        /
      </kbd>
    </div>
  );
}

const pill: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  padding: '12px 18px',
  borderRadius: 999,
  background: 'var(--color-neutral-100)',
  border: '1px solid var(--color-neutral-300)',
};

const input: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: 'var(--color-text)',
  font: 'inherit',
  fontSize: 14,
};

const badge: React.CSSProperties = {
  padding: '1px 7px',
  borderRadius: 6,
  background: 'var(--color-neutral-200)',
  color: 'var(--color-neutral-700)',
  fontSize: 11.5,
  fontWeight: 700,
  fontFamily: 'inherit',
};
