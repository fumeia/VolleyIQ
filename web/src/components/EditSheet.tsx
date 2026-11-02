import { useEffect, useLayoutEffect, useState } from 'react';
import { t } from '../lib/i18n';
import { ACTION_BY_CODE, isNetSpot, wantsSpots, type ActionCode } from '../lib/actions';
import { api, type Player, type VEvent } from '../lib/api';
import type { Pt } from '../lib/court';
import { ActionPicker } from './ActionPicker';
import { CourtFull } from './CourtFull';
import { NetSpot } from './NetSpot';
import { fmtTime } from './TagPad';

type Step = 'who' | 'what' | 'grade' | 'from' | 'to' | 'send';

interface Props {
  token: string;
  /** The tag to correct, or (with [add]) the defaults of a touch to add at that video time. */
  event: VEvent;
  add?: { matchId: number; t: number };
  players: Player[];
  /** Our team plays the far half at that time: draw the court as the camera sees it. */
  flip: boolean;
  /** The element the sheet sits below (the video). */
  anchor: HTMLElement | null;
  /** Video controls for the header (replay the clip, slow-mo). */
  controls?: React.ReactNode;
  onSent: () => void;
  onCancel: () => void;
}

/**
 * A correction (or a touch to add) one question at a time, like the tag pad in the app:
 * who → what → where → send. It sits fixed below the video, so the video stays in view
 * while you choose, slide the block or tap the court.
 */
export function EditSheet({ token, event, add, players, flip, anchor, controls, onSent, onCancel }: Props) {
  const [step, setStep] = useState<Step>('who');
  const [action, setAction] = useState<ActionCode>(event.action);
  const [value, setValue] = useState<number | null>(event.value);
  const [playerId, setPlayerId] = useState<number | null>(event.player_id);
  const [from, setFrom] = useState<Pt | null | undefined>(undefined);
  const [to, setTo] = useState<Pt | null | undefined>(undefined);
  const [note, setNote] = useState('');
  const [jersey, setJersey] = useState(() => { try { return localStorage.getItem('viq:editJersey') ?? ''; } catch { return ''; } });
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [top, setTop] = useState(0);

  // Sit right below the video, and keep the page from scrolling under the sheet.
  useLayoutEffect(() => {
    const measure = () => setTop(Math.max(0, anchor?.getBoundingClientRect().bottom ?? 0));
    measure();
    const t = window.setTimeout(measure, 450);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { clearTimeout(t); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [anchor]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const def = ACTION_BY_CODE[action];
  const path = def?.court === 'path';
  const spots = wantsSpots(action, 'points', 'all');
  const sender = /^\d{1,2}$/.test(jersey.trim()) ? Number(jersey.trim()) : null;
  const tagged = { from: event.fx != null && event.fy != null ? { x: event.fx, y: event.fy } : null, to: event.x != null && event.y != null ? { x: event.x, y: event.y } : null };
  const shownFrom = from === undefined ? tagged.from : from;
  const shownTo = to === undefined ? tagged.to : to;
  const who = (id: number | null) => { const p = players.find((x) => x.id === id); return p ? `#${p.number ?? '–'} ${p.name.split(' ')[0]}` : '–'; };

  // What changes (for a new touch: everything).
  const changes: Record<string, unknown> = {};
  if (add || action !== event.action) changes.action = action;
  if (add || value !== event.value) changes.value = value;
  if (add || playerId !== event.player_id) changes.player_id = playerId;
  const same = (a: Pt | null, b: Pt | null) => (a == null && b == null) || (!!a && !!b && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01);
  const moved = (from !== undefined || to !== undefined) && (!same(path ? shownFrom : null, path ? tagged.from : null) || !same(shownTo, tagged.to));
  if (add ? from !== undefined || to !== undefined : moved) {
    const f = path ? shownFrom : null;
    Object.assign(changes, { fx: f?.x ?? null, fy: f?.y ?? null, x: shownTo?.x ?? null, y: shownTo?.y ?? null });
  }
  const nothing = add ? playerId == null : !Object.keys(changes).length && !note.trim();

  /** The step after picking the action: the grade, the spots, or sending. */
  const afterAction = (c: ActionCode): Step => (c === 'receive' ? 'grade' : wantsSpots(c, 'points', 'all') ? (ACTION_BY_CODE[c].court === 'path' ? 'from' : 'to') : 'send');
  const steps: [Step, string][] = [['who', t('Who')], ['what', t('What')], ...(spots ? [[path ? 'from' : 'to', t('Where')] as [Step, string]] : []), ['send', t('Send')]];
  const stepOf = (s: Step) => (s === 'grade' ? 'what' : s === 'to' && path ? 'from' : s);

  async function send() {
    setState('sending');
    try {
      try { localStorage.setItem('viq:editJersey', String(sender)); } catch { /* private mode */ }
      await api.sendEdit(token, add
        ? { kind: 'add', match_id: add.matchId, t: add.t, changes, note: note.trim(), jersey: sender! }
        : { event_id: event.id, changes, note: note.trim(), jersey: sender! });
      onSent();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('Could not send'));
      setState('error');
    }
  }

  const spotStep = step === 'from' || step === 'to';
  return (
    <div className="spot-sheet edit-sheet" style={{ top, left: 0 }} role="dialog" aria-label="Suggest a correction">
      <div className="edit-sheet-head">
        <b>{add ? `${t('New touch')} · ${fmtTime(add.t)}` : `${t('Edit')} · ${who(event.player_id)} ${t(ACTION_BY_CODE[event.action]?.short ?? '')} · ${fmtTime(event.t ?? 0)}`}</b>
        <span className="edit-sheet-controls">{controls}</span>
        <button className="btn-ghost small" onClick={onCancel}>✕</button>
      </div>
      <div className="crumbs">
        {steps.flatMap(([s, label], k) => [
          ...(k > 0 ? [<span key={`${s}-sep`}>›</span>] : []),
          <button key={s} className={stepOf(step) === s ? 'on' : ''} onClick={() => setStep(s)}>{label}</button>,
        ])}
      </div>

      {step === 'who' && (
        <div className="edit-sheet-body">
          <span className="small muted">{t('Who played it?')}</span>
          <div className="pad-grid pad-players small-jerseys">
            {players.map((p) => (
              <button key={p.id} className={`jersey role-${p.role} ${playerId === p.id ? 'is-selected' : ''}`} onClick={() => { setPlayerId(p.id); setStep('what'); }}>
                <span className="jersey-num">{p.number ?? '–'}</span><span className="jersey-name">{p.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
          {!add && <button className="btn wide" onClick={() => setStep('what')}>Keep {who(event.player_id)} ▶</button>}
        </div>
      )}

      {step === 'what' && (
        <div className="edit-sheet-body">
          <span className="small muted">What was it?{add ? ' (e.g. Block → No touch)' : ''}</span>
          <ActionPicker value={action} onPick={(c) => { setAction(c); if (c !== 'receive') setValue(null); if (c !== action) { setFrom(undefined); setTo(undefined); } setStep(afterAction(c)); }} />
          {!add && <button className="btn wide" onClick={() => setStep(afterAction(action))}>Keep {def?.label ?? action} ▶</button>}
        </div>
      )}

      {step === 'grade' && (
        <div className="edit-sheet-body">
          <span className="small muted">{t('Pass grade (3 = perfect)')}</span>
          <div className="pad-grid pad-grid-4 receive-quick">
            {[0, 1, 2, 3].map((g) => <button key={g} className={`act act-receive r${g} ${value === g ? 'is-selected' : ''}`} onClick={() => { setValue(g); setStep(spots ? 'to' : 'send'); }}>{g}</button>)}
          </div>
        </div>
      )}

      {spotStep && (
        <>
          <span className="small muted">
            {t((step === 'from' ? def?.fromPrompt : def?.toPrompt) ?? 'Where?')}{path ? ` (${step === 'from' ? 1 : 2}/2)` : ''} · {t('as the camera sees it')}
          </span>
          <div className="spot-court">
            {isNetSpot(action, step === 'from' || !path)
              ? <NetSpot key={`${action}-${step}`} initial={(path ? shownFrom : shownTo)?.x} flip={flip}
                  label={path ? '✓ Block here, next: where the ball went' : '✓ Block here'}
                  onPick={(p) => { if (step === 'from') { setFrom(p); setStep('to'); } else { setTo(p); setStep('send'); } }} />
              : <CourtFull from={shownFrom} to={shownTo} flip={flip} label="court"
                  onPick={(p) => { if (step === 'from') { setFrom(p); setStep('to'); } else { setTo(p); setStep('send'); } }} />}
          </div>
          <div className="spot-actions">
            <button className="btn" onClick={() => setStep(step === 'to' && path ? 'from' : 'what')}>◀ {t('Back')}</button>
            <button className="btn" onClick={() => setStep(step === 'from' ? 'to' : 'send')}>
              {(step === 'from' ? shownFrom : shownTo) ? (add ? `${t('Keep')} ▶` : `${t('Keep tagged spot')} ▶`) : `${t('Skip')} ▶`}
            </button>
          </div>
        </>
      )}

      {step === 'send' && (
        <div className="edit-sheet-body">
          <table className="edit-diff small"><tbody>
            <tr><td className="muted">{t('Player')}</td><td>{!add && changes.player_id !== undefined && <s>{who(event.player_id)}</s>} <b>{who(playerId)}</b></td></tr>
            <tr><td className="muted">{t('Action')}</td><td>{!add && changes.action !== undefined && <s>{t(ACTION_BY_CODE[event.action]?.label ?? '')}</s>} <b>{t(def?.label ?? '')}{value != null ? ` ${value}` : ''}</b></td></tr>
            {(add ? from !== undefined || to !== undefined : moved) && <tr><td className="muted">{t('Court spot')}</td><td><b>{add ? t('set') : t('changed')}</b></td></tr>}
          </tbody></table>
          <label className="field-label">{t('Your shirt number')} <small className="muted">({t('required')})</small>
            <input className="input edit-jersey" inputMode="numeric" maxLength={2} placeholder="#" value={jersey} onChange={(e) => setJersey(e.target.value.replace(/\D/g, ''))} />
          </label>
          <textarea className="input" rows={2} maxLength={500} placeholder={t('Note (optional)')} value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-primary wide" disabled={nothing || sender == null || state === 'sending'} onClick={send}>
            {state === 'sending' ? t('Sending…') : nothing ? (add ? t('Pick who played it') : t('Nothing changed yet')) : sender == null ? t('Enter your shirt number') : `✓ ${t('Send')}`}
          </button>
          <p className="small muted">{t('Checked in the app before it changes anything.')}</p>
          {state === 'error' && <p className="small error">{err}</p>}
        </div>
      )}
    </div>
  );
}
