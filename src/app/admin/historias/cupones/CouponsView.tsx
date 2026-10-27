'use client';

/* eslint-disable @next/next/no-img-element -- la vista previa es la imagen firmada tal cual: sin optimizar */
import { useState } from 'react';
import { Check, ClipboardPaste, Copy, Download, ExternalLink, Loader2, Plus, Send, Trash2 } from 'lucide-react';
import {
  COUPON_MAX,
  COUPON_NOTE_MAX,
  COUPON_TARGETS,
  COUPON_TARGET_LABEL,
  parseCouponText,
  type Coupon,
  type CouponTarget,
} from '@/lib/social/coupons';
import { prepareCoupons, publishCouponsOnMeta, type PreparedCoupons, type TargetResult } from './actions';

/**
 * Cupones del canal de afiliados: pegar el aviso, revisar los códigos, armar
 * la imagen y publicarla en Instagram (feed e historia) y Facebook.
 */

interface Row {
  code: string;
  kind: Coupon['kind'];
  value: string;
  cap: string;
  min: string;
  minWord: Coupon['minWord'];
  note: string;
}

const EMPTY: Row = { code: '', kind: 'monto', value: '', cap: '', min: '', minWord: 'desde', note: '' };
const INPUT =
  'min-h-11 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-muted/60 focus:border-accent focus:outline-none';
const BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg transition hover:border-accent/50 disabled:opacity-50';

const digits = (s: string) => Number(s.replace(/\D/g, '') || '0');
const toRow = (c: Coupon): Row => ({
  code: c.code,
  kind: c.kind,
  value: c.value ? String(c.value) : '',
  cap: c.cap ? String(c.cap) : '',
  min: c.min ? String(c.min) : '',
  minWord: c.minWord,
  note: c.note,
});
const toCoupon = (r: Row): Coupon => ({
  code: r.code.trim().toUpperCase(),
  kind: r.kind,
  value: digits(r.value),
  cap: r.kind === 'porcentaje' ? digits(r.cap) : 0,
  min: digits(r.min),
  minWord: r.minWord,
  note: r.note.trim(),
});
const peso = (s: string) => {
  const n = digits(s);
  return n ? `$${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}` : '';
};

export function CouponsView({ metaReady }: { metaReady: boolean }) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[]>([{ ...EMPTY }]);
  const [readNote, setReadNote] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedCoupons | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<CouponTarget[]>([...COUPON_TARGETS]);
  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState<Partial<Record<CouponTarget, TargetResult>>>({});
  const [copied, setCopied] = useState<string | null>(null);

  // Cualquier cambio en los cupones deja la imagen armada sin efecto: se publica solo lo que se vio.
  function change(next: Row[]) {
    setRows(next);
    setPrepared(null);
    setResults({});
    setError(null);
  }
  const edit = (i: number, patch: Partial<Row>) => change(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function readText() {
    const found = parseCouponText(text);
    if (found.length === 0) {
      setReadNote('No encontré códigos en el texto. Escríbelos abajo, uno por cupón.');
      return;
    }
    setReadNote(`Encontré ${found.length} ${found.length === 1 ? 'cupón' : 'cupones'}. Revisa que cada dato calce con el aviso.`);
    change(found.map(toRow));
  }

  async function prepare() {
    setPreparing(true);
    setError(null);
    try {
      const r = await prepareCoupons({ coupons: rows.map(toCoupon) });
      if (!r.ok) setError(r.error);
      else setPrepared(r);
    } catch {
      setError('Se cortó la conexión con el sitio. Prueba otra vez.');
    } finally {
      setPreparing(false);
    }
  }

  async function copy(what: 'instagram' | 'facebook') {
    if (!prepared) return;
    try {
      await navigator.clipboard.writeText(prepared.captions[what]);
      setCopied(what);
    } catch {
      setError('El teléfono no dejó copiar. Mantén apretado el texto de abajo y cópialo a mano.');
    }
  }

  // Lo que falta: sin intentar, o que falló con un error claro. Lo incierto no se reintenta desde aquí.
  const pendingTargets = targets.filter((t) => {
    const r = results[t];
    return !r || (!r.ok && !r.uncertain);
  });

  async function publish() {
    if (!prepared || pendingTargets.length === 0) return;
    const where = pendingTargets.map((t) => COUPON_TARGET_LABEL[t]).join(', ');
    if (!window.confirm(`¿Publicar ahora los cupones en: ${where}? Sale de inmediato.`)) return;
    setPublishing(true);
    setError(null);
    try {
      const r = await publishCouponsOnMeta({ coupons: rows.map(toCoupon), targets: pendingTargets });
      if (!r.ok) setError(r.error);
      else setResults((prev) => ({ ...prev, ...r.results }));
    } catch {
      setError('Se cortó la conexión con el sitio. Antes de volver a intentar, mira en Instagram y Facebook si salió.');
    } finally {
      setPublishing(false);
    }
  }

  const doneAll = COUPON_TARGETS.filter((t) => targets.includes(t)).every((t) => results[t]?.ok);

  return (
    <div className="mt-6 flex flex-col gap-5">
      <section className="rounded-xl border border-border bg-surface p-3 sm:p-4">
        <h2 className="text-sm font-semibold text-fg">1. Pega el aviso del canal</h2>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="Ejemplo: ORBITA45 $45.000 de descuento en compras sobre $500.000"
          className={`${INPUT} mt-2 min-h-28`}
        />
        <button type="button" onClick={readText} disabled={!text.trim()} className={`${BUTTON} mt-2 w-full sm:w-auto`}>
          <ClipboardPaste size={15} aria-hidden /> Leer cupones
        </button>
        {readNote && <p className="mt-2 text-sm text-muted">{readNote}</p>}
      </section>

      <section className="rounded-xl border border-border bg-surface p-3 sm:p-4">
        <h2 className="text-sm font-semibold text-fg">2. Revisa los cupones</h2>
        <ul className="mt-2 flex flex-col gap-3">
          {rows.map((r, i) => (
            <li key={i} className="rounded-lg border border-border bg-bg p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="col-span-2 text-xs text-muted">
                  Código
                  <input
                    value={r.code}
                    onChange={(e) => edit(i, { code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                    autoCapitalize="characters"
                    autoComplete="off"
                    maxLength={20}
                    placeholder="ORBITA45"
                    className={`${INPUT} mt-1 font-semibold tracking-wide`}
                  />
                </label>
                <label className="text-xs text-muted">
                  Descuento en
                  <select value={r.kind} onChange={(e) => edit(i, { kind: e.target.value as Row['kind'] })} className={`${INPUT} mt-1`}>
                    <option value="monto">Pesos ($)</option>
                    <option value="porcentaje">Porcentaje (%)</option>
                  </select>
                </label>
                <label className="text-xs text-muted">
                  {r.kind === 'monto' ? 'Cuántos pesos' : 'Qué porcentaje'}
                  <input
                    value={r.value}
                    onChange={(e) => edit(i, { value: e.target.value.replace(/\D/g, '') })}
                    inputMode="numeric"
                    placeholder={r.kind === 'monto' ? '45000' : '10'}
                    className={`${INPUT} mt-1`}
                  />
                  {r.kind === 'monto' && peso(r.value) && <span className="mt-0.5 block text-fg">{peso(r.value)}</span>}
                </label>
                {r.kind === 'porcentaje' && (
                  <label className="col-span-2 text-xs text-muted">
                    Tope en pesos (si el aviso lo dice)
                    <input
                      value={r.cap}
                      onChange={(e) => edit(i, { cap: e.target.value.replace(/\D/g, '') })}
                      inputMode="numeric"
                      placeholder="20000"
                      className={`${INPUT} mt-1`}
                    />
                    {peso(r.cap) && <span className="mt-0.5 block text-fg">{peso(r.cap)}</span>}
                  </label>
                )}
                <label className="text-xs text-muted">
                  Compra mínima
                  <select
                    value={r.minWord}
                    onChange={(e) => edit(i, { minWord: e.target.value as Row['minWord'] })}
                    className={`${INPUT} mt-1`}
                  >
                    <option value="desde">desde</option>
                    <option value="sobre">sobre</option>
                  </select>
                </label>
                <label className="text-xs text-muted">
                  Pesos (vacío si no hay)
                  <input
                    value={r.min}
                    onChange={(e) => edit(i, { min: e.target.value.replace(/\D/g, '') })}
                    inputMode="numeric"
                    placeholder="500000"
                    className={`${INPUT} mt-1`}
                  />
                  {peso(r.min) && <span className="mt-0.5 block text-fg">{peso(r.min)}</span>}
                </label>
                <label className="col-span-2 text-xs text-muted">
                  Aclaración (opcional)
                  <input
                    value={r.note}
                    onChange={(e) => edit(i, { note: e.target.value.slice(0, COUPON_NOTE_MAX) })}
                    placeholder="compras internacionales"
                    className={`${INPUT} mt-1`}
                  />
                </label>
              </div>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => change(rows.filter((_, j) => j !== i))}
                  className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm text-red-400"
                >
                  <Trash2 size={15} aria-hidden /> Quitar este cupón
                </button>
              )}
            </li>
          ))}
        </ul>
        {rows.length < COUPON_MAX && (
          <button type="button" onClick={() => change([...rows, { ...EMPTY }])} className={`${BUTTON} mt-3 w-full sm:w-auto`}>
            <Plus size={15} aria-hidden /> Agregar otro cupón
          </button>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-3 sm:p-4">
        <h2 className="text-sm font-semibold text-fg">3. Arma la imagen</h2>
        <button
          type="button"
          onClick={() => void prepare()}
          disabled={preparing}
          className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-ink transition hover:bg-accent/90 disabled:opacity-50"
        >
          {preparing && <Loader2 size={15} className="animate-spin" aria-hidden />}
          {prepared ? 'Volver a armar' : 'Armar imágenes'}
        </button>
        {prepared && (
          <>
            <p className="mt-3 text-sm text-muted">Cupones para hoy, {prepared.dayLabel}. Así se van a ver:</p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <figure>
                <img src={prepared.feed} alt="Imagen de cupones para el feed" className="w-full rounded-lg border border-border" />
                <figcaption className="mt-1 text-xs text-muted">Feed (Instagram y Facebook)</figcaption>
              </figure>
              <figure>
                <img src={prepared.historia} alt="Imagen de cupones para la historia" className="w-full rounded-lg border border-border" />
                <figcaption className="mt-1 text-xs text-muted">Historia</figcaption>
                <a href={prepared.historia} download="cupones-historia.jpg" className={`${BUTTON} mt-2 w-full`}>
                  <Download size={15} aria-hidden /> Guardar historia
                </a>
              </figure>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(['instagram', 'facebook'] as const).map((what) => (
                <button key={what} type="button" onClick={() => void copy(what)} className={BUTTON}>
                  {copied === what ? <Check size={15} className="text-accent" aria-hidden /> : <Copy size={15} aria-hidden />}
                  {copied === what ? 'Copiado' : `Copiar texto (${what === 'instagram' ? 'Instagram' : 'Facebook'})`}
                </button>
              ))}
            </div>
            <details className="mt-2">
              <summary className="min-h-11 cursor-pointer py-2 text-sm text-muted">Ver el texto de Instagram</summary>
              <p className="select-all whitespace-pre-wrap break-words rounded-md border border-border bg-bg p-2 text-xs text-fg">
                {prepared.captions.instagram}
              </p>
            </details>
          </>
        )}
      </section>

      {prepared && (
        <section className="rounded-xl border border-accent/40 bg-accent/5 p-3 sm:p-4">
          <h2 className="text-sm font-semibold text-fg">4. Publica</h2>
          {!metaReady ? (
            <p className="mt-1 text-sm text-muted">
              Meta no está conectado: guarda la historia y copia el texto para subirlo a mano, o conéctalo en Configuración →
              Instagram y Facebook.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Sale de inmediato, sin sticker: el código se ingresa al pagar en Mercado Libre, no necesita link.
              </p>
              <div className="mt-2 flex flex-col gap-1">
                {COUPON_TARGETS.map((t) => (
                  <label key={t} className="flex min-h-11 items-center gap-2 text-sm text-fg">
                    <input
                      type="checkbox"
                      checked={targets.includes(t)}
                      disabled={publishing || Boolean(results[t]?.ok)}
                      onChange={(e) => setTargets(e.target.checked ? [...targets, t] : targets.filter((x) => x !== t))}
                      className="h-5 w-5 accent-accent"
                    />
                    {COUPON_TARGET_LABEL[t]}
                  </label>
                ))}
              </div>
              {!doneAll && (
                <button
                  type="button"
                  onClick={() => void publish()}
                  disabled={publishing || pendingTargets.length === 0}
                  className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-ink transition hover:bg-accent/90 disabled:opacity-50"
                >
                  {publishing ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Send size={15} aria-hidden />}
                  {publishing ? 'Publicando… (puede tardar un minuto)' : 'Publicar'}
                </button>
              )}
              {publishing && <p className="mt-2 text-xs text-muted">No cierres esta página hasta que termine.</p>}
              {COUPON_TARGETS.some((t) => results[t]) && (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {COUPON_TARGETS.map((t) => {
                    const r = results[t];
                    if (!r) return null;
                    return r.ok ? (
                      <li key={t} className="flex flex-wrap items-center gap-2 text-accent">
                        <Check size={15} aria-hidden /> {COUPON_TARGET_LABEL[t]}: {r.already ? 'ya estaba publicado' : 'publicado'}
                        {r.permalink && (
                          <a href={r.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline">
                            Ver <ExternalLink size={13} aria-hidden />
                          </a>
                        )}
                      </li>
                    ) : (
                      <li key={t} className={r.uncertain ? 'font-medium text-amber-400' : 'text-red-400'}>
                        {COUPON_TARGET_LABEL[t]}: {r.error}
                      </li>
                    );
                  })}
                </ul>
              )}
              {doneAll && <p className="mt-2 text-sm font-medium text-fg">Listo: no te queda nada por subir de estos cupones.</p>}
            </>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
