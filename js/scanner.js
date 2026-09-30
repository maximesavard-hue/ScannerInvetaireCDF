// Logique de la page Scanner (index.html)

const elTypeGrid = document.getElementById('type-grid')
const elEvenement = document.getElementById('input-evenement')
const elAfficheUtilisateur = document.getElementById('affiche-utilisateur')
const elBtnChangerUtilisateur = document.getElementById('btn-changer-utilisateur')
const elBtnToggleScan = document.getElementById('btn-toggle-scan')
const elBtnTorch = document.getElementById('btn-torch')
const elScannerEtat = document.getElementById('scanner-etat')
const elListeScans = document.getElementById('liste-scans')
const elCountScans = document.getElementById('count-scans')

let typeActuel = null
let html5QrCode = null
let scanEnCours = false
let torchActif = false
let scansSession = [] // le plus récent en premier
let dernierCodeScanne = null
let dernierCodeTimestamp = 0
const DELAI_ANTI_DOUBLON_MS = 2500

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

function demarrerScan() {
  if (!typeActuel) {
    showToast('Choisis un type de mouvement d\'abord', 'warning')
    return
  }

  html5QrCode = new Html5Qrcode('reader', {
    formatsToSupport: [
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.CODABAR,
      Html5QrcodeSupportedFormats.ITF,
      Html5QrcodeSupportedFormats.QR_CODE,
    ],
    verbose: false,
  })

  const config = { fps: 10, qrbox: { width: 260, height: 160 } }

  html5QrCode
    .start({ facingMode: 'environment' }, config, onScanSuccess, () => {})
    .then(() => {
      scanEnCours = true
      elBtnToggleScan.textContent = '⏸️ Arrêter le scan'
      elScannerEtat.textContent = 'Scan en cours — vise le code-barre.'
      verifierTorche()
    })
    .catch((err) => {
      console.error(err)
      showToast('Impossible d\'accéder à la caméra', 'erreur')
    })
}

function arreterScan() {
  if (!html5QrCode) return
  html5QrCode
    .stop()
    .then(() => html5QrCode.clear())
    .catch(() => {})
    .finally(() => {
      scanEnCours = false
      torchActif = false
      elBtnTorch.classList.add('hidden')
      elBtnToggleScan.textContent = '▶️ Démarrer le scan'
      elScannerEtat.textContent = 'Scan arrêté.'
    })
}

function verifierTorche() {
  try {
    const capacites = html5QrCode.getRunningTrackCapabilities()
    if (capacites && capacites.torch) {
      elBtnTorch.classList.remove('hidden')
    }
  } catch (e) {
    // Torche non supportée sur cet appareil, on l'ignore simplement.
  }
}

elBtnTorch.addEventListener('click', async () => {
  if (!html5QrCode) return
  torchActif = !torchActif
  try {
    await html5QrCode.applyVideoConstraints({ advanced: [{ torch: torchActif }] })
  } catch (e) {
    showToast('Lampe torche non disponible', 'warning')
    torchActif = !torchActif
  }
})

// ---------- Traitement d'un code-barre scanné ----------

function onScanSuccess(codeBarre) {
  const maintenant = Date.now()
  if (codeBarre === dernierCodeScanne && maintenant - dernierCodeTimestamp < DELAI_ANTI_DOUBLON_MS) {
    return // même code tenu devant la caméra, on ignore le doublon
  }
  dernierCodeScanne = codeBarre
  dernierCodeTimestamp = maintenant
  traiterScan(codeBarre)
}

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
      showToast(`Nouveau code-barre — nomme l'article ci-dessous`, 'warning')
    } else {
      showToast(`${TYPES_MOUVEMENT[typeActuel].court} — ${article.nom}`, 'ok')
    }
  } catch (err) {
    console.error(err)
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
