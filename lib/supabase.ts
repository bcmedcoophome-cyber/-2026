import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ekrdmhcaxudvtupecnnp.supabase.co';
const supabasePublishableKey = 'sb_publishable_6D350sWaQClcDr_ltz0xlA_daI3bR5C';

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
