import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import htm from 'htm';

const html = htm.bind(React.createElement);

// Suggestions for the current query: existing pool matches first (so Enter picks
// the closest), an "add new" entry last; nothing matches → add-new only.
function buildSuggestions(query, pool, chosen) {
  const v = query.trim();
  if (!v) return [];
  const lower = v.toLowerCase();
  const exact = pool.some((s) => s.toLowerCase() === lower);
  const matches = pool
    .filter((s) => s.toLowerCase().includes(lower) && !chosen.includes(s))
    .sort((a, b) => Number(b.toLowerCase() === lower) - Number(a.toLowerCase() === lower))
    .slice(0, 6)
    .map((s) => ({ title: s, value: s, add: false }));
  return exact ? matches : [...matches, { title: `＋ add “${v}”`, value: v, add: true }];
}

// Per-photo field editor: species (chips + autocomplete), caption, title.
export default function EditPanel({ initial, pool, onCommit, onCancel }) {
  const [field, setField] = useState('species'); // species | caption | title
  const [species, setSpecies] = useState(initial.species);
  const [query, setQuery] = useState('');
  const [sug, setSug] = useState(0);
  const [caption, setCaption] = useState(initial.caption);
  const [title, setTitle] = useState(initial.title);

  const suggestions = buildSuggestions(query, pool, species);

  const advance = () => setField((f) => (f === 'species' ? 'caption' : f === 'caption' ? 'title' : f));
  const commit = () => onCommit({ species, caption, title });

  useInput((input, key) => {
    if (key.escape) return onCancel();
    if (key.tab) return field === 'title' ? commit() : advance();
    if (field !== 'species') return;
    if (key.upArrow) return setSug((i) => Math.max(0, i - 1));
    if (key.downArrow) return setSug((i) => Math.min(Math.max(0, suggestions.length - 1), i + 1));
    if (key.backspace && query === '') return setSpecies((s) => s.slice(0, -1));
  });

  const submitSpecies = () => {
    const q = query.trim();
    if (!q) {
      setField('caption'); // empty Enter → next field
      return;
    }
    const pick = suggestions[sug] || suggestions[0];
    const name = pick && !pick.add ? pick.value : q;
    if (!species.includes(name)) setSpecies([...species, name]);
    setQuery('');
    setSug(0);
  };

  const Label = ({ name, active }) =>
    html`<${Text} color=${active ? 'cyan' : undefined} dimColor=${!active}>${name}: </${Text}>`;

  return html`<${Box} flexDirection="column" marginTop=${1}>
    <${Box}>
      <${Text} bold color="cyan">Edit </${Text}>
      <${Text} dimColor>Enter add/next · ↑↓ pick · Tab skip field · Esc cancel</${Text}>
    </${Box}>

    <${Box}>
      <${Label} name="species" active=${field === 'species'} />
      <${Text}>${species.length ? species.join(' · ') : html`<${Text} dimColor>—</${Text}>`}</${Text}>
    </${Box}>
    ${field === 'species' &&
    html`<${Box} flexDirection="column">
      <${Box}>
        <${Text} dimColor>＋ </${Text}>
        <${TextInput}
          value=${query}
          onChange=${(q) => {
            setQuery(q);
            setSug(0);
          }}
          onSubmit=${submitSpecies}
          focus=${true}
          placeholder="type a species, Enter to add"
        />
      </${Box}>
      ${suggestions.map(
        (s, i) => html`<${Text} key=${s.title} inverse=${i === sug}>  ${s.title}</${Text}>`,
      )}
    </${Box}>`}

    <${Box}>
      <${Label} name="caption" active=${field === 'caption'} />
      ${field === 'caption'
        ? html`<${TextInput} value=${caption} onChange=${setCaption} onSubmit=${() => setField('title')} focus=${true} />`
        : html`<${Text}>${caption || html`<${Text} dimColor>—</${Text}>`}</${Text}>`}
    </${Box}>

    <${Box}>
      <${Label} name="title" active=${field === 'title'} />
      ${field === 'title'
        ? html`<${TextInput} value=${title} onChange=${setTitle} onSubmit=${commit} focus=${true} />`
        : html`<${Text}>${title || html`<${Text} dimColor>—</${Text}>`}</${Text}>`}
    </${Box}>
  </${Box}>`;
}
