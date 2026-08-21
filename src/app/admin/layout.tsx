import Link from 'next/link';

const TABS = [
  { href: '/admin/candidatos', label: 'Candidatos' },
  { href: '/admin/productos', label: 'Productos' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="border-b border-border bg-surface">
        <nav className="mx-auto flex max-w-4xl gap-1 px-4">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="border-b-2 border-transparent px-3 py-3 text-sm font-medium text-muted transition hover:text-fg"
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}
