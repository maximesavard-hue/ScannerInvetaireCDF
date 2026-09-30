// Logique de la page Stock (stock.html)
// Affiche le stock actuel au CDF, dérivé de la vue SQL `stock_cdf`
// (jamais une colonne maintenue à la main — voir CLAUDE.md).

const elRecherche = document.getElementById('recherche')
const elListeStock = document.getElementById('liste-stock')
const elCountArticles = document.getElementById('count-articles')
const elBtnRafraichir = document.getElementById('btn-rafraichir')

let articlesStock = []

async function chargerStock() {
  elListeStock.innerHTML = '<li class="loading">Chargement...</li>'

  const { data, error } = await window.supabase
    .from('stock_cdf')
    .select('*')
    .order('nom', { ascending: true })

  if (error) {
    console.error(error)
    elListeStock.innerHTML = '<li class="vide">Erreur de chargement. Vérifie la connexion.</li>'
    return
  }

  articlesStock = data
  rendreListe()
}

function rendreListe() {
  const terme = elRecherche.value.trim().toLowerCase()

  const filtres = articlesStock.filter((a) => {
    if (!terme) return true
    return a.nom.toLowerCase().includes(terme) || a.code_barre.toLowerCase().includes(terme)
  })

  elCountArticles.textContent = filtres.length

  if (filtres.length === 0) {
    elListeStock.innerHTML = '<li class="vide">Aucun article trouvé.</li>'
    return
  }

  elListeStock.innerHTML = ''
  filtres.forEach((article) => {
    const li = document.createElement('li')
    li.className = 'carte'

    const aNommer = article.nom === 'Article à nommer'
    let classeQuantite = ''
    if (article.quantite_stock < 0) classeQuantite = 'stock-negatif'
    else if (article.quantite_stock === 0) classeQuantite = 'stock-zero'

    li.innerHTML = `
      <div class="carte-corps">
        <div class="carte-nom ${aNommer ? 'a-nommer' : ''}">${aNommer ? '⚠️ ' + echapperHtml(article.nom) : echapperHtml(article.nom)}</div>
        <div class="carte-meta">${echapperHtml(article.code_barre)}${article.categorie ? ' · ' + echapperHtml(article.categorie) : ''}</div>
      </div>
      <div class="quantite-badge ${classeQuantite}">${article.quantite_stock}</div>
      <button class="btn-icon" data-role="renommer" aria-label="Renommer">✏️</button>
    `

    li.querySelector('[data-role="renommer"]').addEventListener('click', () => renommer(article))

    elListeStock.appendChild(li)
  })
}

async function renommer(article) {
  const nouveauNom = window.prompt('Nom de l\'article :', article.nom === 'Article à nommer' ? '' : article.nom)
  if (!nouveauNom || !nouveauNom.trim()) return

  const { error } = await window.supabase
    .from('articles')
    .update({ nom: nouveauNom.trim() })
    .eq('id', article.article_id)

  if (error) {
    showToast('Impossible de renommer l\'article', 'erreur')
    return
  }

  article.nom = nouveauNom.trim()
  rendreListe()
  showToast('Article renommé', 'ok')
}

elRecherche.addEventListener('input', rendreListe)
elBtnRafraichir.addEventListener('click', chargerStock)

chargerStock()
