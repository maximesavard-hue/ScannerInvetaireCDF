// Logique de la page Scanner (index.html)

const elTypeGrid = document.getElementById('type-grid')
const elEvenement = document.getElementById('input-evenement')
const elAfficheUtilisateur = document.getElementById('affiche-utilisateur')
const elBtnChangerUtilisateur = document.getElementById('btn-changer-utilisateur')
const elBtnToggleScan = document.getElementById('btn-toggle-scan')
const elBtnTorch = document.getElementById('btn-torch')
const elBtnZoom = document.getElementById('btn-zoom')
const elReader = document.getElementById('reader')
const elVideo = document.getElementById('video')
const elScannerEtat = document.getElementById('scanner-etat')
const elListeScans = document.getElementById('liste-scans')
const elCountScans = document.getElementById('count-scans')
const elFormManuel = document.getElementById('form-manuel')
const elInputCodeManuel = document.getElementById('input-code-manuel')

let typeActuel = null
let scanEnCours = false
let flux = null // flux vidéo de la caméra
let piste = null // piste vidéo (pour la torche et le zoom)
let detecteur = null
let torchActif = false
let niveauxZoom = []
let indexZoom = 0
let scansSession = [] // le plus récent en premier
let dernierCodeScanne = null
let dernierCodeTimestamp = 0
const DELAI_ANTI_DOUBLON_MS = 2500

// Pour éviter les fausses lectures, un code doit être lu 2 fois de suite avant d'être accepté
let lectureCandidate = null
let lectureCandidateTimestamp = 0

const FORMATS_VOULUS = [
  'code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'upc_a', 'upc_e',
  'codabar', 'itf', 'qr_code', 'data_matrix',
]

// ---------- Initialisation ----------

function init() {
  elAfficheUtilisateur.textContent = assurerUtilisateur()
  construireTypeGrid()
}

function construireTypeGrid() {
  elTypeGrid.innerHTML = ''
  Object.entries(TYPES_MOUVEMENT).forEach(([cle, info]) => {
    const btn = document.createElement('button')
    btn.className = 'type-btn'
    btn.textContent = info.court
    btn.style.setProperty('--type-couleur', info.couleur)
    btn.addEventListener('click', () => choisirType(cle))
    btn.dataset.type = cle
    elTypeGrid.appendChild(btn)
  })
}

function choisirType(cle) {
  typeActuel = cle
  document.querySelectorAll('.type-btn').forEach((btn) => {
    btn.classList.toggle('actif', btn.dataset.type === cle)
  })
  elScannerEtat.textContent = scanEnCours
    ? 'Scan en cours — vise le code-barre.'
    : 'Prêt. Appuie sur "Démarrer le scan".'
}

elBtnChangerUtilisateur.addEventListener('click', () => {
  const nom = window.prompt('Ton prénom :', getUtilisateur())
  if (nom && nom.trim()) {
    setUtilisateur(nom)
    elAfficheUtilisateur.textContent = getUtilisateur()
  }
})

// ---------- Démarrage / arrêt du scan caméra ----------

elBtnToggleScan.addEventListener('click', () => {
  if (scanEnCours) {
    arreterScan()
  } else {
    demarrerScan()
  }
})

async function demarrerScan() {
  if (!typeActuel) {
    showToast('Choisis un type de mouvement d\'abord', 'warning')
    return
  }
  if (!window.ClasseLecteur) {
    showToast('Lecteur en chargement — réessaie dans 2 secondes', 'warning')
    return
  }

  activerSon() // doit se faire pendant un clic, sinon l'iPhone bloque le son

  try {
    if (!detecteur) {
      const formatsDispo = await window.ClasseLecteur.getSupportedFormats()
      const formats = FORMATS_VOULUS.filter((f) => formatsDispo.includes(f))
      detecteur = new window.ClasseLecteur({ formats })
    }

    // Haute résolution : les codes-barres 1D ont des barres fines, la résolution
    // par défaut (640x480) est la cause principale des lectures ratées.
    flux = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    })
  } catch (err) {
    console.error(err)
    showToast('Impossible d\'accéder à la caméra', 'erreur')
    return
  }

  piste = flux.getVideoTracks()[0]
  elVideo.srcObject = flux
  elReader.classList.remove('hidden')
  await elVideo.play().catch(() => {})

  scanEnCours = true
  elBtnToggleScan.textContent = '⏸️ Arrêter le scan'
  elScannerEtat.textContent = 'Scan en cours — vise le code-barre.'

  configurerCamera()
  boucleDetection()
}

function arreterScan() {
  scanEnCours = false
  if (flux) flux.getTracks().forEach((t) => t.stop())
  flux = null
  piste = null
  elVideo.srcObject = null
  elReader.classList.add('hidden')
  torchActif = false
  elBtnTorch.classList.add('hidden')
  elBtnZoom.classList.add('hidden')
  elBtnToggleScan.textContent = '▶️ Démarrer le scan'
  elScannerEtat.textContent = 'Scan arrêté.'
}

// Mise au point continue + boutons torche/zoom si le téléphone les supporte
function configurerCamera() {
  const capacites = piste.getCapabilities ? piste.getCapabilities() : {}

  if (capacites.focusMode && capacites.focusMode.includes('continuous')) {
    piste.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {})
  }

  if (capacites.torch) elBtnTorch.classList.remove('hidden')

  // Le zoom permet de tenir le téléphone plus loin : beaucoup de caméras
  // n'arrivent pas à faire la mise au point de très près sur une petite étiquette.
  if (capacites.zoom && capacites.zoom.max >= 2) {
    niveauxZoom = [1, 2, 3].filter((z) => z >= capacites.zoom.min && z <= capacites.zoom.max)
    indexZoom = 0
    elBtnZoom.textContent = '🔍 1x'
    elBtnZoom.classList.remove('hidden')
  }
}

elBtnTorch.addEventListener('click', async () => {
  if (!piste) return
  torchActif = !torchActif
  try {
    await piste.applyConstraints({ advanced: [{ torch: torchActif }] })
  } catch (e) {
    showToast('Lampe torche non disponible', 'warning')
    torchActif = !torchActif
  }
})

elBtnZoom.addEventListener('click', async () => {
  if (!piste || niveauxZoom.length === 0) return
  indexZoom = (indexZoom + 1) % niveauxZoom.length
  const zoom = niveauxZoom[indexZoom]
  try {
    await piste.applyConstraints({ advanced: [{ zoom }] })
    elBtnZoom.textContent = `🔍 ${zoom}x`
  } catch (e) {
    showToast('Zoom non disponible', 'warning')
  }
})

// Analyse les images de la caméra en continu, environ 10 fois par seconde
async function boucleDetection() {
  if (!scanEnCours) return

  if (elVideo.readyState >= 2) {
    try {
      const codes = await detecteur.detect(elVideo)
      if (codes.length > 0) onCodeDetecte(choisirCodeCentral(codes).rawValue)
    } catch (e) {
      // Image illisible : on passe simplement à la suivante
    }
  }

  setTimeout(boucleDetection, 100)
}

// Si plusieurs codes sont visibles (étiquette avec plusieurs codes), on garde celui
// le plus près du centre de l'image, là où l'utilisateur vise.
function choisirCodeCentral(codes) {
  const cx = elVideo.videoWidth / 2
  const cy = elVideo.videoHeight / 2
  const distance = (c) => {
    const b = c.boundingBox
    return Math.hypot(b.x + b.width / 2 - cx, b.y + b.height / 2 - cy)
  }
  return codes.reduce((meilleur, c) => (distance(c) < distance(meilleur) ? c : meilleur))
}

// ---------- Traitement d'un code-barre scanné ----------

function onCodeDetecte(codeBarre) {
  const maintenant = Date.now()

  // Confirmation : même code lu deux fois de suite en moins d'une seconde
  if (codeBarre !== lectureCandidate || maintenant - lectureCandidateTimestamp > 1000) {
    lectureCandidate = codeBarre
    lectureCandidateTimestamp = maintenant
    return
  }
  lectureCandidateTimestamp = maintenant

  if (codeBarre === dernierCodeScanne && maintenant - dernierCodeTimestamp < DELAI_ANTI_DOUBLON_MS) {
    // Même code toujours devant la caméra : on ignore, et le délai repart à zéro tant qu'il
    // reste visible (sinon un code tenu longtemps serait compté plusieurs fois).
    dernierCodeTimestamp = maintenant
    return
  }
  dernierCodeScanne = codeBarre
  dernierCodeTimestamp = maintenant

  // Flash vert du viseur
  elReader.classList.add('lu')
  setTimeout(() => elReader.classList.remove('lu'), 300)

  traiterScan(codeBarre)
}

// ---------- Saisie manuelle (ou lecteur USB/Bluetooth qui tape le code + Entrée) ----------

elFormManuel.addEventListener('submit', (e) => {
  e.preventDefault()
  activerSon()
  const code = elInputCodeManuel.value.trim()
  if (!code) return
  elInputCodeManuel.value = ''
  traiterScan(code)
})

async function traiterScan(codeBarre) {
  if (!typeActuel) {
    showToast('Choisis un type de mouvement d\'abord', 'warning')
    return
  }

  vibrerConfirmation()

  try {
    const { article, nouveau } = await getOrCreateArticle(codeBarre)

    const { data: mouvement, error } = await window.supabase
      .from('mouvements')
      .insert({
        article_id: article.id,
        type: typeActuel,
        quantite: 1,
        evenement: elEvenement.value.trim() || null,
        utilisateur: getUtilisateur(),
      })
      .select()
      .single()

    if (error) throw error

    ajouterScanAffiche({ mouvement, article })

    if (nouveau) {
      bip('inconnu')
      showToast(`Nouveau code-barre — nomme l'article ci-dessous`, 'warning')
    } else {
      bip('ok')
      showToast(`${TYPES_MOUVEMENT[typeActuel].court} — ${article.nom}`, 'ok')
    }
  } catch (err) {
    console.error(err)
    bip('erreur')
    showToast('Erreur pendant le scan — réessaie', 'erreur')
  }
}

// ---------- Affichage de la liste des scans de cette session ----------

function ajouterScanAffiche({ mouvement, article }) {
  scansSession.unshift({ mouvement, article })
  elCountScans.textContent = scansSession.length
  rendreListeScans()
}

function rendreListeScans() {
  if (scansSession.length === 0) {
    elListeScans.innerHTML = '<li class="vide">Aucun scan pour l\'instant.</li>'
    return
  }

  elListeScans.innerHTML = ''
  scansSession.forEach((item) => {
    const { mouvement, article } = item
    const li = document.createElement('li')
    li.className = 'carte'

    const aNommer = article.nom === 'Article à nommer'
    const typeInfo = TYPES_MOUVEMENT[mouvement.type]

    li.innerHTML = `
      <div class="carte-corps">
        <div class="carte-nom ${aNommer ? 'a-nommer' : ''}" data-role="nom">${aNommer ? '⚠️ ' + echapperHtml(article.nom) : echapperHtml(article.nom)}</div>
        <div class="carte-meta">${echapperHtml(article.code_barre)}
          · <span class="badge" style="background:${typeInfo.couleur}22;color:${typeInfo.couleur};">${typeInfo.court}</span>
          · ${formatDateHeure(mouvement.created_at)}
        </div>
        ${aNommer ? `<input type="text" class="rename-input" placeholder="Nommer cet article…" data-role="rename-input">` : ''}
      </div>
      <div class="quantite-stepper">
        <button data-role="moins">−</button>
        <span class="quantite-badge" data-role="quantite">${mouvement.quantite}</span>
        <button data-role="plus">+</button>
      </div>
      <button class="btn-icon" data-role="supprimer" aria-label="Supprimer ce scan">🗑️</button>
    `

    li.querySelector('[data-role="plus"]').addEventListener('click', () => modifierQuantite(item, 1, li))
    li.querySelector('[data-role="moins"]').addEventListener('click', () => modifierQuantite(item, -1, li))
    li.querySelector('[data-role="supprimer"]').addEventListener('click', () => supprimerScan(item, li))

    const inputRenommer = li.querySelector('[data-role="rename-input"]')
    if (inputRenommer) {
      const valider = () => renommerArticle(item, inputRenommer.value, li)
      inputRenommer.addEventListener('blur', valider)
      inputRenommer.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') inputRenommer.blur()
      })
    }

    elListeScans.appendChild(li)
  })
}

async function modifierQuantite(item, delta, li) {
  const nouvelleQuantite = item.mouvement.quantite + delta
  if (nouvelleQuantite < 1) return

  const { error } = await window.supabase
    .from('mouvements')
    .update({ quantite: nouvelleQuantite })
    .eq('id', item.mouvement.id)

  if (error) {
    showToast('Impossible de modifier la quantité', 'erreur')
    return
  }

  item.mouvement.quantite = nouvelleQuantite
  li.querySelector('[data-role="quantite"]').textContent = nouvelleQuantite
}

async function supprimerScan(item, li) {
  if (!window.confirm('Supprimer ce scan ?')) return

  const { error } = await window.supabase.from('mouvements').delete().eq('id', item.mouvement.id)

  if (error) {
    showToast('Impossible de supprimer ce scan', 'erreur')
    return
  }

  scansSession = scansSession.filter((s) => s.mouvement.id !== item.mouvement.id)
  elCountScans.textContent = scansSession.length
  li.remove()
  if (scansSession.length === 0) rendreListeScans()
  showToast('Scan supprimé', 'ok')
}

async function renommerArticle(item, nom, li) {
  const nomPropre = nom.trim()
  if (!nomPropre) return

  const { error } = await window.supabase.from('articles').update({ nom: nomPropre }).eq('id', item.article.id)

  if (error) {
    showToast('Impossible de renommer l\'article', 'erreur')
    return
  }

  item.article.nom = nomPropre
  // Met à jour aussi tous les autres scans de cette session pour le même article
  scansSession.forEach((s) => {
    if (s.article.id === item.article.id) s.article.nom = nomPropre
  })
  rendreListeScans()
  showToast('Article renommé', 'ok')
}

init()
