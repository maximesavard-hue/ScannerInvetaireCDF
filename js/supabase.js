// Configuration Supabase
// À REMPLACER par les infos de VOTRE projet Supabase (voir CLAUDE.md, section Setup initial)
// Dashboard → Project Settings → API
const SUPABASE_URL = 'https://zpixbecqyhuphjtzzfia.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_zoF38wpl3JmlnaScMSrMrg_K_JSavqr'

// Client Supabase (chargé via CDN dans chaque page HTML)
// Remplace l'objet librairie global par le client initialisé (évite une redéclaration
// de `const supabase` qui entrerait en conflit avec le global déjà défini par le CDN)
window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
