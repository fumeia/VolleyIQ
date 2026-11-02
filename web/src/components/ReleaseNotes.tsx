import { Fragment } from 'react';

/** Inline markdown of the release notes: **bold** and `code`. */
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <b key={i}>{part.slice(2, -2)}</b>
      : part.startsWith('`') && part.endsWith('`') ? <code key={i}>{part.slice(1, -1)}</code>
      : <Fragment key={i}>{part}</Fragment>);
}

/**
 * The notes of a release, as written in CHANGELOG.md: "## " headings, "**Feature**" lines,
 * "- " points and plain lines. [skipIntro] leaves out the download instructions at the top.
 */
export function ReleaseNotes({ notes, skipIntro = true }: { notes: string; skipIntro?: boolean }) {
  let lines = notes.replace(/\r/g, '').split('\n');
  if (skipIntro) {
    const first = lines.findIndex((l) => l.startsWith('## ') || l.startsWith('**This build'));
    if (first > 0) lines = lines.slice(first);
  }
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) out.push(<ul key={out.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>); list = []; };
  for (const raw of lines) {
    const l = raw.trim();
    if (l.startsWith('- ')) { list.push(l.slice(2)); continue; }
    flush();
    if (!l) continue;
    if (l.startsWith('## ')) out.push(<h3 key={out.length}>{l.slice(3)}</h3>);
    else if (/^\*\*[^*]+\*\*$/.test(l)) out.push(<h4 key={out.length}>{l.slice(2, -2)}</h4>);
    else out.push(<p key={out.length}>{inline(l)}</p>);
  }
  flush();
  return <div className="release-notes">{out}</div>;
}
