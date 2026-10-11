import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, queryClient } from '../../app/providers';
import { post, setCsrf, type SessionInfo } from '../../app/api';
import logoUrl from '../../img/gmvcc.png';

export function AuthPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, loading, error: connectionError, retry } = useAuth();
  const kind = location.pathname;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const notice = (location.state as { notice?: string } | null)?.notice;
  const [busy, setBusy] = useState(false);
  const [token] = useState(() => {
    const value = new URLSearchParams(location.hash.slice(1)).get('token') || '';
    if (value) history.replaceState(null, '', location.pathname);
    return value;
  });
  const isLogin = kind === '/login';
  const isReset = kind === '/forgot-password';
  const title = isLogin
    ? 'Welcome back'
    : isReset
      ? 'Reset your password'
      : kind === '/accept-invitation'
        ? 'Set up your account'
        : 'Choose a new password';
  const authCard = (
    <section className="panel auth-card">
      <h2>{title}</h2>
      <p className="muted">Use your school account to continue.</p>
      {connectionError && (
        <div role="alert">
          <p>Cannot reach the server. Start the API and database, then try again.</p>
          <button type="button" onClick={retry}>Retry connection</button>
        </div>
      )}
      {isLogin && loading && <p role="status">Checking the sign-in session…</p>}
      <form onSubmit={submit}>
        {(isLogin || isReset) && (
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
        )}
        {!isReset && (
          <div className="auth-password-field">
            <label htmlFor="auth-password">Password</label>
            {!isLogin && <span className="muted">At least 12 characters.</span>}
            <div className="auth-password">
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                aria-label="Password"
                minLength={isLogin ? 1 : 12}
                maxLength={128}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                className="auth-password-toggle"
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((shown) => !shown)}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {showPassword ? (
                    <>
                      <path d="M3 3l18 18" />
                      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                      <path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5 0 8.3 4.5 9 7-.3 1.1-1 2.2-1.9 3.2" />
                      <path d="M6.2 6.2C3.9 7.6 2.4 10 2 12c.7 2.5 4 7 10 7 1 0 2-.2 2.9-.5" />
                    </>
                  ) : (
                    <>
                      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  )}
                </svg>
              </button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {(message || notice) && <p role="status">{message || notice}</p>}
        <button
          className="primary"
          disabled={busy || loading || !!connectionError || (!isLogin && !isReset && !token)}
        >
          {busy ? 'Please wait…' : isLogin && loading ? 'Checking connection…' : isLogin ? 'Sign in' : isReset ? 'Send reset link' : 'Save password'}
        </button>
      </form>
      {!isLogin && !isReset && !token && (
        <p role="alert">Open the link from your invitation or password-reset email.</p>
      )}
      <div className="auth-links">
        {isLogin ? <Link to="/forgot-password">Forgot password?</Link> : <Link to="/login">Back to sign in</Link>}
      </div>
    </section>
  );

  if (isLogin && session?.user) return <Navigate to={'/' + session.user.role} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      if (isLogin) {
        const result = await post<SessionInfo>('/auth/login', { email, password });
        setCsrf(result.csrf);
        queryClient.setQueryData(['session'], result);
        navigate('/' + result.user!.role, { replace: true });
      } else {
        const result = await post<{ message: string }>(
          isReset ? '/auth/reset-request' : kind === '/accept-invitation' ? '/auth/accept-invitation' : '/auth/reset-password',
          isReset ? { email } : { token, password },
        );
        if (isReset) {
          setMessage(result.message);
          setPassword('');
        } else {
          await queryClient.invalidateQueries({ queryKey: ['session'] });
          navigate('/login', { replace: true, state: { notice: result.message } });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
  <main className={isLogin ? 'auth auth-login' : 'auth'}>
      <section className="auth-brand">
        <div className="auth-brand-header">
          <img className="auth-logo" src={logoUrl} alt="LearnSync logo" width={72} height={72} />
          <div className="auth-brand-copy">
            <Link to="/login" className="brand">
              LearnSync
            </Link>
            <p>Governor Mariano Villafuerte Community College</p>
          </div>
        </div>
        <h1>A clearer path through your learning.</h1>
        <p>Your subjects, lessons and progress, together in one place.</p>
        {isLogin && (
          <>
            <aside className="auth-tip">
              <p className="auth-tip-title">Tip</p>
              <p>Enter your email and password to get started with LearnSync.</p>
            </aside>
            <nav className="auth-social-links" aria-label="College links">
              <a
                href="https://www.facebook.com/p/Governor-Mariano-E-Villafuerte-Community-College-Libmanan-100064380480187/"
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M13.4 21v-8.2h2.8l.4-3.2h-3.2v-2c0-.9.3-1.5 1.6-1.5h1.7V3.2c-.3 0-1.4-.2-2.6-.2-2.6 0-4.4 1.6-4.4 4.5v2.1H7v3.2h2.7V21h3.7Z" />
                </svg>
                <span>Facebook</span>
              </a>
              <a
                href="https://baao.villafuertecolleges.edu.ph/libmanan"
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
                </svg>
                <span>Website</span>
              </a>
            </nav>
          </>
        )}
        {!isLogin && authCard}
      </section>
      {isLogin && authCard}
    </main>
  );
}
