import { useState } from 'react';
import { api, isApp, serverBase, setServerBase } from '../lib/api';

export function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(serverBase() || 'https://');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const app = isApp();

  return (
    <div className="center">
      <form
        className="card login"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          setBusy(true);
          try {
            if (app) {
              if (!/^https?:\/\/[^/]+/.test(server.trim())) throw new Error('Enter your server address, e.g. https://volleyiq.example.com');
              setServerBase(server);
            }
            await api.login(password);
            onLogin();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="brand big"><img src="/icon.svg" alt="" /> VolleyIQ</div>
        {app && (
          <>
            <label className="field-label">Server</label>
            <input className="input" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" value={server}
              onChange={(e) => setServer(e.target.value)} placeholder="https://volleyiq.example.com" />
          </>
        )}
        <input className="input" type="password" autoFocus={!app} placeholder="Password" value={password}
          onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary wide" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
    </div>
  );
}
