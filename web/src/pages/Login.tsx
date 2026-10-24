import { useState } from 'react';
import { api } from '../lib/api';

export function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="center">
      <form
        className="card login"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.login(password);
            onLogin();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <div className="brand big"><img src="/icon.svg" alt="" /> VolleyIQ</div>
        <input className="input" type="password" autoFocus placeholder="Password" value={password}
          onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary wide">Log in</button>
      </form>
    </div>
  );
}
