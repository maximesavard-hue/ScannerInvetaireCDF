// Logique de la page Historique (historique.html)
// Journal brut des mouvements — sert de preuve/référence en cas d'erreur à débattre
// avec Solotech (voir CLAUDE.md).

const elListeHistorique = document.getElementById('liste-historique')
const elFiltreEvenement = document.getElementById('filtre-evenement')
const elFiltreType = document.getElementById('filtre-type')
const elFiltreCoffre = document.getElementById('filtre-coffre')
const elBtnRafraichir = document.getElementById('btn-rafraichir')

const LIMITE = 300

let mouvements = []

async function chargerHistorique() {
  elListeHistorique.innerHTML = '<li class="loading">Chargement...</li>'

  const { data, error } = await window.supabase
    .from('mouvements')
    .select('*, articles(nom, code_barre)')
    .order('created_at', { ascending: false })
    .limit(LIMITE)

  if (error) {
    console.error(error)
    elListeHistorique.innerHTML = '<li class="vide">Erreur de chargement. Vérifie la connexion.</li>'
    return
  }

  mouvements = data
  construireFiltreEvenements()
  construireFiltreTypes()
  construireFiltreCoffres()
  rendreListe()
}

function construireFiltreEvenements() {
  const evenementActuel = elFiltreEvenement.value
  const evenements = [...new Set(mouvements.map((m) => m.evenement).filter(Boolean))].sort()

  elFiltreEvenement.innerHTML = '<option value="">Tous les événements</option>'
  evenements.forEach((ev) => {
    const option = document.createElement('option')
    option.value = ev
    option.textContent = ev
    elFiltreEvenement.appendChild(option)
  })
  elFiltreEvenement.value = evenementActuel
}

function construireFiltreCoffres() {
  const coffreActuel = elFiltreCoffre.value
  const coffres = [...new Set(mouvements.map((m) => m.coffre).filter(Boolean))].sort()

  elFiltreCoffre.innerHTML = '<option value="">Tous les coffres</option>'
  coffres.forEach((c) => {
    const option = document.createElement('option')
    option.value = c
    option.textContent = c
    elFiltreCoffre.appendChild(option)
  })
  elFiltreCoffre.value = coffreActuel
}

function construireFiltreTypes() {
  if (elFiltreType.children.length > 1) return // déjà construit
  Object.entries(TYPES_MOUVEMENT).forEach(([cle, info]) => {
    const option = document.createElement('option')
    option.value = cle
    option.textContent = info.label
    elFiltreType.appendChild(option)
  })
}

function rendreListe() {
  const evenementFiltre = elFiltreEvenement.value
  const typeFiltre = elFiltreType.value
  const coffreFiltre = elFiltreCoffre.value

  const filtres = mouvements.filter((m) => {
    if (evenementFiltre && m.evenement !== evenementFiltre) return false
    if (typeFiltre && m.type !== typeFiltre) return false
    if (coffreFiltre && m.coffre !== coffreFiltre) return false
    return true
  })

  if (filtres.length === 0) {
    elListeHistorique.innerHTML = '<li class="vide">Aucun mouvement trouvé.</li>'
    return
  }

  elListeHistorique.innerHTML = ''
  filtres.forEach((m) => {
    const typeInfo = TYPES_MOUVEMENT[m.type]
    const nomArticle = m.articles ? m.articles.nom : 'Article supprimé'
    const codeBarre = m.articles ? m.articles.code_barre : ''

    const li = document.createElement('li')
    li.className = 'carte'
    li.innerHTML = `
      <div class="carte-corps">
        <div class="carte-nom">${echapperHtml(nomArticle)}</div>
        <div class="carte-meta">
          <span class="badge" style="background:${typeInfo.couleur}22;color:${typeInfo.couleur};">${typeInfo.label}</span>
          · ${m.quantite}x · ${formatDateHeure(m.created_at)}
        </div>
        <div class="carte-meta">${echapperHtml(codeBarre)}${m.evenement ? ' · ' + echapperHtml(m.evenement) : ''}${m.coffre ? ' · 🧳 ' + echapperHtml(m.coffre) : ''}${m.utilisateur ? ' · ' + echapperHtml(m.utilisateur) : ''}</div>
      </div>
      <button class="btn-icon" data-role="supprimer" aria-label="Supprimer ce mouvement">🗑️</button>
    `

    li.querySelector('[data-role="supprimer"]').addEventListener('click', () => supprimerMouvement(m, li))

    elListeHistorique.appendChild(li)
  })
}

async function supprimerMouvement(m, li) {
  if (!window.confirm('Supprimer ce mouvement ? Cela va changer le stock calculé de l\'article.')) return

  const { error } = await window.supabase.from('mouvements').delete().eq('id', m.id)

  if (error) {
    showToast('Impossible de supprimer ce mouvement', 'erreur')
    return
  }

  mouvements = mouvements.filter((x) => x.id !== m.id)
  li.remove()
  showToast('Mouvement supprimé', 'ok')
}

elFiltreEvenement.addEventListener('change', rendreListe)
elFiltreType.addEventListener('change', rendreListe)
elFiltreCoffre.addEventListener('change', rendreListe)
elBtnRafraichir.addEventListener('click', chargerHistorique)

chargerHistorique()
