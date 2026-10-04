'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { weekStartOf } from '@/lib/clicks';
import { saveAffiliateReport } from './actions';

export interface AffiliateReportRow {
  week_start: string;
  ml_clicks: number | null;
  ml_sales: number | null;
  ml_pending_clp: number | null;
  ml_approved_clp: number | null;
  notes: string | null;
}

type Fields = {
  mlClicks: string;
  mlSales: string;
  mlPendingClp: string;
  mlApprovedClp: string;
  notes: string;
};

function fieldsFor(report: AffiliateReportRow | undefined): Fields {
  const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
  return {
    mlClicks: str(report?.ml_clicks),
    mlSales: str(report?.ml_sales),
    mlPendingClp: str(report?.ml_pending_clp),
    mlApprovedClp: str(report?.ml_approved_clp),
    notes: report?.notes ?? '',
  };
}

const INPUT_CLASS =
  'rounded-md border border-border bg-surface2 px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none';

/**
 * Formulario semanal de la Central de Afiliados. Al elegir una semana que ya
 * se cargó, trae sus números para corregirlos en vez de partir de cero.
 */
export function AffiliateReportForm({
  reports,
  defaultWeek,
}: {
  reports: AffiliateReportRow[];
  defaultWeek: string;
}) {
  const router = useRouter();
  const byWeek = new Map(reports.map((r) => [r.week_start, r]));

  const [week, setWeek] = useState(defaultWeek);
  const [fields, setFields] = useState<Fields>(() => fieldsFor(byWeek.get(defaultWeek)));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const monday = weekStartOf(week);
  const existing = monday ? byWeek.get(monday) : undefined;

  function changeWeek(value: string) {
    setWeek(value);
    setMessage(null);
    const start = weekStartOf(value);
    setFields(fieldsFor(start ? byWeek.get(start) : undefined));
  }

  function set<K extends keyof Fields>(key: K, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  function handleSave() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveAffiliateReport({ week, ...fields });
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setMessage({ ok: true, text: `Guardado: semana del ${formatWeek(result.weekStart)}.` });
      router.refresh();
    });
  }

  return (
    <div className="mt-5 flex flex-col gap-4 border-t border-border pt-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Semana (cualquier día; se guarda de lunes a domingo)
          <input type="date" value={week} onChange={(e) => changeWeek(e.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Clics en ML
          <input
            value={fields.mlClicks}
            onChange={(e) => set('mlClicks', e.target.value)}
            inputMode="numeric"
            placeholder="Ej: 230"
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Ventas
          <input
            value={fields.mlSales}
            onChange={(e) => set('mlSales', e.target.value)}
            inputMode="numeric"
            placeholder="Ej: 4"
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Comisión pendiente ($)
          <input
            value={fields.mlPendingClp}
            onChange={(e) => set('mlPendingClp', e.target.value)}
            inputMode="numeric"
            placeholder="Ej: 12.500"
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Comisión aprobada ($)
          <input
            value={fields.mlApprovedClp}
            onChange={(e) => set('mlApprovedClp', e.target.value)}
            inputMode="numeric"
            placeholder="Ej: 8.000"
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Notas (opcional)
          <input
            value={fields.notes}
            onChange={(e) => set('notes', e.target.value)}
            maxLength={500}
            placeholder="Ej: semana del Cyber"
            className={INPUT_CLASS}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleSave}
          disabled={isPending || !monday}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPending ? 'Guardando…' : existing ? 'Actualizar semana' : 'Guardar semana'}
        </button>
        {monday && (
          <p className="text-xs text-muted">
            {existing ? 'Ya hay datos de la semana del ' : 'Semana del '}
            {formatWeek(monday)}
          </p>
        )}
        {message && <p className={`text-xs ${message.ok ? 'text-accent' : 'text-red-400'}`}>{message.text}</p>}
      </div>
    </div>
  );
}

/** "lunes 29/09" a partir de AAAA-MM-DD. */
function formatWeek(weekStart: string): string {
  const [, m, d] = weekStart.split('-');
  return `lunes ${d}/${m}`;
}
