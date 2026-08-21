'use server';

import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { RrssStatus } from '@/lib/types';

type ActionResult = { ok: true } | { ok: false; error: string };

export async function setRrssStatus(productId: string, status: RrssStatus): Promise<ActionResult> {
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const { error } = await admin.from('products').update({ rrss_status: status }).eq('id', productId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/productos');
  return { ok: true };
}
