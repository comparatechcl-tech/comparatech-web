'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveAttributionTest } from './actions';

type Status = 'pendiente' | 'confirmada' | 'fallida';

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'confirmada', label: 'Apareció en la Central de Afiliados' },
  { value: 'fallida', label: 'No apareció tras 72 h' },
];

const INPUT_CLASS =
  'rounded-md border border-border bg-surface2 px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none';

export function AttributionTestForm({
  initial,
}: {
  initial: {
    status: Status;
    clickedAt?: string;
    purchasedAt?: string;
    orderRef?: string;
    notes?: string;
    updatedAt?: string;
  };
}) {
  const router = useRouter();
  const [clickedAt, setClickedAt] = useState(initial.clickedAt ?? '');
  const [purchasedAt, setPurchasedAt] = useState(initial.purchasedAt ?? '');
  const [orderRef, setOrderRef] = useState(initial.orderRef ?? '');
  const [status, setStatus] = useState<Status>(initial.status);
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveAttributionTest({ clickedAt, purchasedAt, orderRef, status, notes });
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setMessage({ ok: true, text: 'Guardado.' });
      router.refresh();
    });
  }

  return (
    <div className="mt-5 flex flex-col gap-4 border-t border-border pt-5">
      <p className="rounded-lg bg-surface2 px-3 py-2 text-xs leading-relaxed text-muted">
        Lo más seguro es pedir confirmación escrita al soporte de Afiliados. Si haces una compra de prueba, que sea de
        alguien de otro hogar (otro celular, otra red y otra dirección). ML desaconseja compras de familiares y personas
        cercanas. Si la venta aparece, aunque sea como Rechazada - Cuenta vinculada, la atribución queda comprobada.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Fecha y hora del clic de prueba
          <input
            type="datetime-local"
            value={clickedAt}
            onChange={(e) => setClickedAt(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Fecha de compra
          <input
            type="date"
            value={purchasedAt}
            onChange={(e) => setPurchasedAt(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          N° de orden (opcional)
          <input value={orderRef} onChange={(e) => setOrderRef(e.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Resultado
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className={INPUT_CLASS}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted">
        Notas
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Quién hizo la compra, qué respondió el soporte, etc."
          className={INPUT_CLASS}
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPending ? 'Guardando…' : 'Guardar resultado'}
        </button>
        {message && (
          <p className={`text-xs ${message.ok ? 'text-accent' : 'text-red-400'}`}>{message.text}</p>
        )}
      </div>
    </div>
  );
}
