'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { connectMeta, disconnectMeta, testMeta } from './actions';

const INPUT_CLASS =
  'w-full rounded-md border border-border bg-surface2 px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none';
const PRIMARY =
  'inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40';
const SECONDARY =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-fg transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-40';

type PageChoice = { id: string; name: string; igUsername: string | null };

/** Pegar el token del Graph API Explorer y conectar. */
export function MetaConnectForm({ scopes }: { scopes: string[] }) {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [choices, setChoices] = useState<PageChoice[] | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConnect() {
    setMessage(null);
    startTransition(async () => {
      const result = await connectMeta({ token, pageId });
      if (result.ok) {
        setToken('');
        setChoices(null);
        const extra =
          result.missingOptional.length > 0
            ? ` Faltan permisos opcionales (${result.missingOptional.join(', ')}): sin ellos podría fallar la publicación de videos en Facebook.`
            : '';
        setMessage({ ok: true, text: `Conectado.${extra}` });
        router.refresh();
        return;
      }
      if ('choose' in result) {
        setChoices(result.choose);
        setPageId(result.choose[0]?.id ?? null);
        setMessage({ ok: false, text: 'Tienes varias páginas con Instagram: elige cuál conectar y toca Conectar otra vez.' });
        return;
      }
      setMessage({ ok: false, text: result.error });
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
        <li>
          Abre el{' '}
          <a
            href="https://developers.facebook.com/tools/explorer/"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-accent hover:underline"
          >
            Graph API Explorer
          </a>{' '}
          de Meta (en otra pestaña).
        </li>
        <li>
          A la derecha, en <strong className="text-fg">Meta App</strong>, elige <strong className="text-fg">ComparaTech Publicador</strong>.
        </li>
        <li>
          En <strong className="text-fg">User or Page</strong>, elige <strong className="text-fg">Get User Access Token</strong>.
        </li>
        <li>
          En <strong className="text-fg">Permissions</strong>, con <em>Add a Permission</em>, agrega uno por uno:{' '}
          <span className="break-words font-mono text-xs text-fg">{scopes.join(', ')}</span>.
        </li>
        <li>
          Toca <strong className="text-fg">Generate Access Token</strong>. En la ventana de Meta sigue con tu cuenta, marca
          la página <strong className="text-fg">ComparaTech</strong> y la cuenta de Instagram, y acepta.
        </li>
        <li>
          Copia el token (el texto largo que empieza con <span className="font-mono">EAA</span>, con el ícono de copiar) y
          pégalo aquí. Dura 1 hora: pégalo de inmediato. <strong className="text-fg">No lo pegues en ningún chat.</strong>
        </li>
      </ol>

      <label className="flex flex-col gap-1 text-xs text-muted">
        Token del Graph API Explorer
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="EAA…"
          className={INPUT_CLASS}
        />
      </label>

      {choices && (
        <fieldset className="flex flex-col gap-2 rounded-lg border border-border bg-surface2 p-3">
          <legend className="px-1 text-xs text-muted">¿Qué página conectar?</legend>
          {choices.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm text-fg">
              <input type="radio" name="meta-page" checked={pageId === c.id} onChange={() => setPageId(c.id)} />
              {c.name}
              {c.igUsername && <span className="text-muted">· Instagram @{c.igUsername}</span>}
            </label>
          ))}
        </fieldset>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={handleConnect} disabled={isPending || !token.trim()} className={PRIMARY}>
          {isPending ? 'Conectando…' : 'Conectar'}
        </button>
        {message && <p className={`text-sm ${message.ok ? 'text-accent' : 'text-red-400'}`}>{message.text}</p>}
      </div>
    </div>
  );
}

/** Probar (solo lectura) y desconectar. */
export function MetaConnectedActions() {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleTest() {
    setMessage(null);
    startTransition(async () => {
      const result = await testMeta();
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      const quota =
        result.used !== null && result.total !== null
          ? ` Instagram lleva ${result.used} de ${result.total} publicaciones por API en las últimas 24 horas.`
          : '';
      setMessage({ ok: true, text: `La conexión funciona.${quota}` });
    });
  }

  function handleDisconnect() {
    if (!window.confirm('¿Desconectar Meta? El sitio dejará de poder publicar en Instagram y Facebook hasta que vuelvas a conectar.')) {
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await disconnectMeta();
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <button onClick={handleTest} disabled={isPending} className={PRIMARY}>
          {isPending ? 'Revisando…' : 'Probar conexión'}
        </button>
        <button onClick={handleDisconnect} disabled={isPending} className={SECONDARY}>
          Desconectar
        </button>
      </div>
      <p className="text-xs text-muted">Probar conexión solo lee datos: no publica nada.</p>
      {message && <p className={`text-sm ${message.ok ? 'text-accent' : 'text-red-400'}`}>{message.text}</p>}
    </div>
  );
}
