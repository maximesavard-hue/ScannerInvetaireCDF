// Fonctions partagées entre les pages (scanner, stock, historique)

// ---------- Types de mouvement ----------
// Source de vérité pour les libellés/couleurs des 4 types de mouvement possibles.
const TYPES_MOUVEMENT = {
  reception_surplus: { label: 'Réception surplus', court: 'Surplus reçu', couleur: '#4a90d9', sens: '+' },
  retour_solotech:   { label: 'Retour à Solotech',  court: 'Retour Solotech', couleur: '#d9583f', sens: '-' },
  retour_stock_cdf:  { label: 'Gardé au CDF',       court: 'Gardé au CDF', couleur: '#5fbf6b', sens: '+' },
  sortie_stock_cdf:  { label: 'Sorti pour un événement', court: 'Sorti (événement)', couleur: '#e0954a', sens: '-' },
}

// ---------- Utilisateur (prénom, pas un vrai login) ----------
function getUtilisateur() {
  return localStorage.getItem('scanner_cdf_utilisateur') || ''
}

function setUtilisateur(nom) {
  localStorage.setItem('scanner_cdf_utilisateur', nom.trim())
}

// Demande le prénom si jamais saisi. Bloque tant qu'un prénom valide n'est pas fourni,
// car chaque mouvement doit pouvoir être retracé à quelqu'un (voir CLAUDE.md).
function assurerUtilisateur() {
  let nom = getUtilisateur()
  while (!nom) {
    nom = window.prompt('Ton prénom (pour tracer qui a fait quoi) :')
    if (nom && nom.trim()) {
      setUtilisateur(nom)
      nom = getUtilisateur()
    } else {
      nom = ''
    }
  }
  return nom
}

// ---------- Toast (feedback visuel) ----------
let toastTimer = null
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast')
  if (!toast) return
  toast.textContent = message
  toast.className = 'toast toast-' + type + ' show'
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.classList.remove('show')
  }, 2200)
}

// ---------- Articles : trouver ou créer par code-barre ----------
// Ne jamais écraser le nom d'un article déjà nommé : on sélectionne d'abord,
// on ne crée que si le code-barre est réellement inconnu.
async function getOrCreateArticle(codeBarre) {
  const { data: existant, error: erreurLecture } = await window.supabase
    .from('articles')
    .select('*')
    .eq('code_barre', codeBarre)
    .maybeSingle()

  if (erreurLecture) throw erreurLecture
  if (existant) return { article: existant, nouveau: false }

  const { data: cree, error: erreurCreation } = await window.supabase
    .from('articles')
    .insert({ code_barre: codeBarre })
    .select()
    .single()

  if (erreurCreation) {
    // Cas rare : deux scans simultanés du même nouveau code-barre (conflit sur l'unicité).
    // On retente une lecture simple plutôt que d'échouer le scan.
    const { data: retenter } = await window.supabase
      .from('articles')
      .select('*')
      .eq('code_barre', codeBarre)
      .maybeSingle()
    if (retenter) return { article: retenter, nouveau: false }
    throw erreurCreation
  }

  return { article: cree, nouveau: true }
}

// ---------- Divers ----------
function formatDateHeure(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('fr-CA') + ' ' + d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })
}

function echapperHtml(texte) {
  const div = document.createElement('div')
  div.textContent = texte ?? ''
  return div.innerHTML
}

// Vibration courte de confirmation (silencieux si non supporté, ex. iPhone)
function vibrerConfirmation() {
  if (navigator.vibrate) navigator.vibrate(80)
}

// ---------- Sons de confirmation ----------
// Un son distinct par résultat, pour savoir sans regarder l'écran si le scan a pris.
let contexteAudio = null

// À appeler pendant un clic de l'utilisateur : les navigateurs bloquent le son sinon
function activerSon() {
  try {
    if (!contexteAudio) contexteAudio = new (window.AudioContext || window.webkitAudioContext)()
    if (contexteAudio.state === 'suspended') contexteAudio.resume()
  } catch (e) { /* pas de son sur cet appareil */ }
}

function jouerNote(frequence, debut, duree) {
  const osc = contexteAudio.createOscillator()
  const volume = contexteAudio.createGain()
  osc.type = 'square'
  osc.frequency.value = frequence
  volume.gain.value = 0.15
  osc.connect(volume).connect(contexteAudio.destination)
  const t = contexteAudio.currentTime + debut
  osc.start(t)
  osc.stop(t + duree)
}

// type : 'ok' (bip aigu court), 'inconnu' (deux bips), 'erreur' (son grave)
function bip(type) {
  if (!contexteAudio) return
  try {
    if (type === 'ok') jouerNote(1800, 0, 0.09)
    else if (type === 'inconnu') { jouerNote(1200, 0, 0.09); jouerNote(1200, 0.15, 0.09) }
    else jouerNote(220, 0, 0.35)
  } catch (e) { /* ignore */ }
}
