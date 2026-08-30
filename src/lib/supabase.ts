import { createClient } from '@supabase/supabase-js';

// CAFE MOCA 행사 전용 Supabase.
// Vite 환경변수가 있으면 우선 사용하고, 행사장 공용 기기에서 .env가 누락되더라도
// MOCA의 공개용 publishable key로 정상 연결되도록 fallback을 둡니다.
const DEFAULT_SUPABASE_URL = 'https://zragjgtvwoeezmtjdafw.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_elae86qYZuQRSEIShb_dPg_HvcF_AXn';

const supabaseUrl = (
  import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL
) as string;

const supabaseKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  DEFAULT_SUPABASE_PUBLISHABLE_KEY
) as string;

const normalizedUrl = supabaseUrl.trim();
const normalizedKey = supabaseKey.trim();

export const hasSupabaseConfig = Boolean(normalizedUrl && normalizedKey);

export const supabase = createClient(normalizedUrl, normalizedKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
