'use client';

/**
 * Último recurso: falló el layout raíz (y con él el encabezado, los estilos
 * y el tema). Tiene que funcionar sin nada de eso, así que lleva su propio
 * <html> y estilos en línea.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es-CL">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#0A0E17',
          color: '#F5F7FA',
          textAlign: 'center',
          padding: '24px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.5rem', margin: '0 0 12px' }}>Tuvimos un problema al cargar ComparaTech</h1>
          <p style={{ margin: '0 0 20px', opacity: 0.75 }}>Prueba de nuevo en unos segundos.</p>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: '10px 18px',
              borderRadius: 12,
              border: 0,
              background: '#087EFF',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
              marginRight: 8,
            }}
          >
            Reintentar
          </button>
          {/* <a> y no <Link>: si falló el layout, mejor una carga completa. */}
          <a href="/ofertas" style={{ color: '#00D4FF' }}>
            Ver ofertas de hoy
          </a>
        </div>
      </body>
    </html>
  );
}
