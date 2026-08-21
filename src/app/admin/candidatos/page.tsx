import { getSupabaseAdmin } from '@/lib/supabase/server';
import { ProductCandidate } from '@/lib/types';
import { CandidatesList } from './CandidatesList';

export const dynamic = 'force-dynamic';

export default async function CandidatosPage() {
  const admin = getSupabaseAdmin();
  const candidates: ProductCandidate[] = admin
    ? ((
        await admin
          .from('product_candidates')
          .select('*')
          .eq('status', 'pending_review')
          .order('prospected_at', { ascending: false })
      ).data ?? [])
    : [];

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="font-heading text-2xl font-bold text-white">Candidatos a revisar</h1>
      <p className="mt-1 text-sm text-muted">
        {candidates.length} producto{candidates.length === 1 ? '' : 's'} esperando aprobación. Agrega el link de
        afiliado real antes de aprobar — sin eso no se puede publicar.
      </p>
      <div className="mt-8">
        <CandidatesList candidates={candidates} />
      </div>
    </main>
  );
}
