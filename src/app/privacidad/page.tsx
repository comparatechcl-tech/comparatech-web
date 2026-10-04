import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Política de privacidad',
  alternates: { canonical: '/privacidad' },
  description: 'Qué datos registra ComparaTech, para qué los usa y con quién se comparten. En simple.',
};

const CONTACT_EMAIL = 'comparatech.cl@gmail.com';

/**
 * Escrita en lenguaje simple a propósito: tiene que poder leerla cualquier
 * persona, no solo un abogado. Si cambia lo que mide el sitio (/api/e,
 * Vercel Analytics, UtmCapture), esta página se actualiza junto con el código.
 */
export default function PrivacidadPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="font-heading text-2xl font-bold">Política de privacidad</h1>
      <p className="mt-2 text-xs text-muted">Última actualización: octubre de 2026</p>

      <div className="mt-6 space-y-4 text-sm leading-relaxed text-muted">
        <p className="rounded-xl border border-border bg-surface p-4 text-fg">
          En corto: no te pedimos cuenta, no guardamos tu IP y no usamos cookies propias. Solo contamos, de forma
          anónima, cuántas visitas tiene el sitio y cuántas veces se abre un producto en Mercado Libre.
        </p>

        <h2 className="pt-2 font-heading text-lg font-semibold text-fg">Qué registramos</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="text-fg">Clics hacia Mercado Libre.</strong> Cuando tocas &quot;Ver en Mercado
            Libre&quot; guardamos qué producto fue, desde qué parte del sitio (portada, ofertas, la ficha, etc.), el
            tipo de link, si llegaste desde alguna red social o campaña (por ejemplo, Telegram) y si la pantalla era
            de celular. Nada más: ni tu IP, ni tu navegador, ni nada que te identifique.
          </li>
          <li>
            <strong className="text-fg">Visitas agregadas.</strong> Usamos Vercel Analytics, que cuenta páginas
            vistas, países y tipos de dispositivo en totales, sin cookies y sin seguirte entre sitios.
          </li>
          <li>
            <strong className="text-fg">En tu propio navegador.</strong> Mientras tengas la pestaña abierta,
            recordamos de dónde llegaste y qué productos ya abriste, para no contar dos veces el mismo clic. También
            recordamos si prefieres el modo claro u oscuro. Eso queda en tu navegador (no es una cookie) y puedes
            borrarlo cuando quieras desde su configuración.
          </li>
        </ul>
        <p>
          No tenemos cuentas de usuario ni listas de correo: no te pedimos nombre, correo ni teléfono.
        </p>

        <h2 className="pt-2 font-heading text-lg font-semibold text-fg">Para qué</h2>
        <p>
          Para saber qué productos y secciones te sirven, decidir qué comparar después y revisar que los links de
          afiliado funcionen. ComparaTech se financia con las comisiones del Programa de Afiliados de Mercado Libre
          (ver{' '}
          <Link href="/terminos" className="text-accent hover:underline">
            términos
          </Link>
          ), y estos totales son la forma de saber si el sitio está funcionando. No vendemos ni arrendamos datos a
          nadie, y no los usamos para mostrarte publicidad.
        </p>

        <h2 className="pt-2 font-heading text-lg font-semibold text-fg">Terceros</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="text-fg">Vercel</strong> aloja el sitio y entrega las estadísticas de visitas. Como
            cualquier servidor web, recibe tu IP para poder mostrarte la página.
          </li>
          <li>
            <strong className="text-fg">Supabase</strong> es la base de datos donde quedan los productos y los clics
            anónimos.
          </li>
          <li>
            <strong className="text-fg">Mercado Libre</strong>: al seguir un link, entras a su sitio y desde ese
            momento rigen su política de privacidad y sus cookies. Mercado Libre sabe que llegaste desde ComparaTech,
            porque así nos asigna la comisión.
          </li>
        </ul>

        <h2 className="pt-2 font-heading text-lg font-semibold text-fg">Tus derechos</h2>
        <p>
          Tratamos los datos según la legislación chilena de protección de datos personales, incluida la Ley 21.719,
          que moderniza la Ley 19.628. Puedes pedirnos acceso, rectificación, supresión u oposición, y cualquier
          consulta sobre esta política. Como los clics y las visitas que registramos son anónimos, en general no hay
          forma de asociarlos a ti; si nos escribes, te contamos exactamente qué hay.
        </p>

        <h2 className="pt-2 font-heading text-lg font-semibold text-fg">Contacto</h2>
        <p>
          Escríbenos a{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent hover:underline">
            {CONTACT_EMAIL}
          </a>
          . Si cambiamos algo importante de esta política, lo publicamos en esta misma página con la fecha de
          actualización.
        </p>
      </div>
    </div>
  );
}
