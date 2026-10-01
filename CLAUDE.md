# Scanner Inventaire CDF — Brief Claude Code

## Contexte du projet

Maxime gère l'entrepôt du **Centre de Foire de Québec (CDF)** pour le compte de son client **Solotech inc.**
Solotech a son propre système d'inventaire à leur entrepôt central, mais rien n'existe pour suivre le matériel
physiquement présent au CDF.

Le problème concret :
- Lors de grosses demandes (gros événements), le stock permanent gardé au CDF ne suffit pas.
- Solotech envoie alors du matériel en **surplus** depuis leur entrepôt pour combler le manque.
- Au démontage de l'événement, une partie de ce surplus est **retournée à Solotech**, une autre partie est
  **gardée en stock permanent au CDF** pour les besoins futurs.
- Actuellement, il n'y a **aucun outil pour scanner et confirmer ces mouvements** au CDF. Résultat : des erreurs
  de quantités/retours surviennent régulièrement et **brisent l'inventaire de Solotech de leur côté**.

**Objectif de l'appli** : un scanner de codes-barres, utilisable par **tout le personnel présent au CDF** (pas
juste Maxime), qui tient à jour le stock réellement présent au CDF — indépendamment du système de Solotech —
pour que Maxime sache rapidement quoi ranger après un démontage, en quelle quantité, et puisse fournir un
décompte fiable et rapide à Solotech quand nécessaire.

## Philosophie de développement

- **Simple avant tout** — code lisible, pas de sur-ingénierie
- **Gratuit et durable** — pas de dépendances payantes
- **Fiabilité du comptage > esthétique** — le vrai problème métier, c'est les erreurs humaines de quantités qui
  brisent l'inventaire de Solotech. Toute décision de conception doit d'abord répondre à : *est-ce que ça réduit
  le risque d'erreur de compte ?*
- **Stack** : HTML + JavaScript vanilla + Supabase + GitHub Pages — même stack éprouvée que le projet perso de
  Maxime `inventaire-outils`, mais **projet Supabase séparé** (données d'un client business, ne pas mélanger
  avec l'appli d'outils personnels)

Différences importantes avec `inventaire-outils` :
- **Vrai multi-utilisateur** dès le départ (pas juste "prévu pour V2") : tout le monde sur le site doit pouvoir
  scanner et écrire dans la même base en même temps.
- **Vrai scan de codes-barres nécessaire** (pas des QR codes qu'on contrôle) : on lit les codes-barres déjà
  imprimés sur le matériel de Solotech. Il faut donc une vraie librairie de lecture de codes-barres via la
  caméra (le "scanner QR retiré" de l'autre projet ne s'applique pas ici).

---

## Décisions prises par défaut — à valider avec Maxime avant/pendant l'implémentation

Ce sont des choix raisonnables faits pour pouvoir avancer, mais ce sont de vrais choix d'architecture :
à confirmer avec Maxime plutôt qu'à considérer comme acquis.

1. **Authentification** : aucun vrai login. Accès ouvert par lien (ajouté en raccourci sur l'écran d'accueil des
   téléphones au CDF), comme pour `inventaire-outils`. Au premier lancement sur un appareil, on demande un
   prénom (stocké en `localStorage`), attaché à chaque mouvement scanné — utile pour enquêter en cas d'erreur,
   sans être une vraie authentification.
2. **Sécurité des données** : RLS désactivé ou policy "allow all" (même logique que l'autre projet). Le contenu
   exposé (noms d'équipement, quantités) n'est pas jugé sensible — à confirmer avec Maxime si Solotech aurait
   une objection à ce que ces données soient techniquement accessibles via la clé publique Supabase.
3. **Portée du suivi** : l'appli suit uniquement **ce qui est physiquement au CDF** (stock permanent + surplus
   non retourné). Ce n'est **pas** une resynchronisation avec le système de Solotech — on ne touche jamais à
   leur système directement (c'est justement la source des erreurs actuelles). Cette appli devient la source de
   vérité du CDF ; un décompte/rapport peut être communiqué à Solotech séparément (format à définir plus tard).
4. **Codes-barres inconnus** : la première fois qu'un item de Solotech est scanné, sa fiche n'existe probablement
   pas encore dans notre base. Prévoir un flux "code-barre inconnu → créer la fiche à la volée" (nom minimal,
   catégorie facultative) plutôt que de bloquer le scan.

---

## Structure de la base de données (proposition de départ)

### Table `articles`
Catalogue du matériel rencontré (le nôtre et celui de Solotech confondus, distingués par les mouvements).

| Champ | Type | Description |
|-------|------|-------------|
| id | uuid | Automatique |
| code_barre | text | **Unique**, lu par le scanner |
| nom | text | Complété à la première rencontre du code-barre |
| categorie | text | Optionnel |
| notes | text | Optionnel |
| created_at | timestamp | Automatique |

### Table `mouvements`
Journal de chaque scan. C'est la pièce centrale : elle sert d'historique/preuve en cas d'erreur à débattre
avec Solotech, et le stock courant en est dérivé (voir plus bas).

| Champ | Type | Description |
|-------|------|-------------|
| id | uuid | Automatique |
| article_id | uuid | FK → articles |
| type | text | `reception_surplus` (reçu de Solotech), `retour_solotech` (renvoyé à Solotech), `retour_stock_cdf` (gardé au CDF après démontage), `sortie_stock_cdf` (sorti du stock permanent pour un événement) |
| quantite | integer | Quantité scannée dans ce mouvement |
| evenement | text | Optionnel — nom/numéro de l'événement concerné |
| utilisateur | text | Prénom saisi (voir décision d'authentification ci-dessus), pas un vrai compte |
| note | text | Optionnel |
| created_at | timestamp | Automatique |

### Stock courant
**Calculé** (vue SQL), pas stocké en colonne dupliquée : `stock_cdf = SUM(entrées) - SUM(sorties)` par article.
Éviter une colonne "quantité actuelle" maintenue à la main, qui recréerait exactement le risque de
désynchronisation qu'on essaie de régler ici.

---

## Flux d'utilisation typique

1. **Réception de surplus** : Maxime (ou un collègue) scanne chaque item reçu de Solotech pour un événement →
   mouvement `reception_surplus`.
2. **Pendant l'événement** (optionnel, peut être V2) : sortie du stock permanent CDF pour compléter le surplus →
   mouvement `sortie_stock_cdf`.
3. **Démontage** : on scanne chaque item qui revient.
   - Mode "Retour Solotech" → mouvement `retour_solotech`.
   - Mode "Garder au CDF" → mouvement `retour_stock_cdf`.
4. L'appli affiche en tout temps le **stock actuel par article**, recherchable/filtrable, pour que Maxime sache
   quoi ranger et en quelle quantité.

Idée d'UX pour limiter les erreurs : un "mode session" où on choisit l'événement + le type de mouvement
**une seule fois**, puis on scanne en rafale sans reconfirmer à chaque item (feedback sonore/visuel de
confirmation par scan).

---

## UI / UX

- **Mobile first**, gros boutons (utilisation en entrepôt, parfois avec des gants)
- Accès caméra direct pour scanner en rafale
- Feedback immédiat (son + visuel) à chaque scan réussi, et signal distinct si le code-barre est inconnu
- Langue de l'interface : **Français**
- HTTPS obligatoire pour l'accès caméra (GitHub Pages le fournit nativement)

---

## Règles de développement

- Pas de frameworks (pas de React, Vue, etc.)
- Pas de build tools (pas de webpack, vite, etc.)
- Chaque page fonctionne indépendamment
- JS commenté en français
- Préférer la simplicité à l'élégance
- Tester sur mobile à chaque étape (vrai scan caméra, pas juste desktop)

---

## Setup initial — à faire en premier

1. **Créer un nouveau projet Supabase dédié** (ne pas réutiliser celui d'`inventaire-outils` — séparer les
   données d'un client business des outils personnels de Maxime)
2. Dans Supabase Dashboard → SQL Editor, coller et exécuter `supabase-tables.sql`
3. RLS déjà géré dans le script SQL (désactivé — voir décision de sécurité ci-dessus)
4. Remplacer `SUPABASE_URL` et `SUPABASE_ANON_KEY` dans `js/supabase.js` par les vraies valeurs du projet
   (Dashboard → Project Settings → API)
5. Ajouter les mêmes valeurs comme secrets GitHub du repo, pour le workflow anti-pause (voir section
   "Supabase en veille" plus bas) :
   ```
   gh secret set SUPABASE_URL --body "https://xxxxx.supabase.co"
   gh secret set SUPABASE_ANON_KEY --body "sb_publishable_xxxxx"
   ```
6. GitHub Pages pour héberger (repo → Settings → Pages → Deploy from branch → main → /) — l'URL devient le lien
   à ajouter en raccourci sur les téléphones du personnel du CDF

---

## Structure des fichiers à créer

```
ScannerInvetaireCDF/
├── index.html              # Scanner principal (caméra + choix du mode/événement)
├── stock.html              # Vue du stock actuel au CDF, recherche/filtre
├── historique.html         # Journal des mouvements, filtrable par événement
├── css/
│   └── style.css
├── js/
│   ├── supabase.js         # Config et client Supabase
│   ├── utils.js            # Types de mouvement, toast, prénom utilisateur, get-or-create article
│   ├── scanner.js          # Intégration librairie de scan + logique de mouvement
│   ├── stock.js            # Logique vue stock
│   └── historique.js       # Logique journal
├── .github/workflows/
│   └── keep-supabase-awake.yml  # Ping hebdomadaire pour éviter la pause Supabase (voir plus bas)
├── supabase-tables.sql     # Script SQL
└── CLAUDE.md               # Ce fichier
```

---

## Supabase en veille (projets gratuits) — quoi faire

Un projet Supabase gratuit se **met en pause après ~7 jours sans activité API** (pas de suppression, juste une
pause). Pour une appli utilisée par du personnel sur un site d'événements, l'usage peut être très irrégulier
(rien entre deux gros events) → risque réel de tomber sur une appli en pause au pire moment.

**Ce qui est déjà en place pour éviter ça** : `.github/workflows/keep-supabase-awake.yml` fait un ping léger
vers Supabase chaque lundi via GitHub Actions (gratuit, aucune action manuelle requise une fois les secrets
`SUPABASE_URL`/`SUPABASE_ANON_KEY` configurés — voir Setup initial). Tant que ce workflow tourne, le projet ne
devrait jamais se mettre en pause.

**Si l'appli affiche quand même une erreur de connexion** (le workflow a pu échouer, ou le projet vient d'être
créé) :
1. Va sur https://supabase.com/dashboard → ouvre le projet → s'il affiche "Paused", clique sur
   **"Restore project"**. Ça prend 1-2 minutes, **aucune donnée n'est perdue**.
2. Vérifie que le workflow tourne bien : repo GitHub → onglet **Actions** → "Garder Supabase actif" → s'il est
   en échec (❌), c'est probablement que les secrets ne sont pas configurés ou plus à jour.
3. En dernier recours, un projet Supabase gratuit resté en pause trop longtemps peut finir par être
   **supprimé** (politique de Supabase, pas garanti indéfiniment) — c'est une raison de plus de garder le
   workflow actif plutôt que de compter sur une pause "sans risque".

---

## État actuel du déploiement

*Section tenue à jour par Claude au fil des sessions — source de vérité pour reprendre le travail, peu importe
la machine utilisée.*

- **Scaffold du code créé** : `index.html` (scanner), `stock.html`, `historique.html`, `css/style.css`,
  `js/supabase.js`, `js/utils.js`, `js/scanner.js`, `js/stock.js`, `js/historique.js`, `supabase-tables.sql`,
  `.github/workflows/keep-supabase-awake.yml`.
- Scan de codes-barres via la librairie `html5-qrcode` (CDN jsDelivr, testé et répond bien) — formats supportés :
  Code128, Code39, EAN-13/8, UPC-A/E, Codabar, ITF, QR. Torche caméra activée si l'appareil le supporte.
- **Repo GitHub** : `maximesavard-hue/ScannerInvetaireCDF`, créé **en privé** pour l'instant —
  https://github.com/maximesavard-hue/ScannerInvetaireCDF (voir "Bloqué — action requise" ci-dessous pour
  pourquoi ce n'est pas encore public)
- **Reste à faire avant utilisation réelle** :
  1. Rendre le repo public (ou passer à GitHub Pro) pour pouvoir activer GitHub Pages gratuitement
  2. ~~Créer le projet Supabase dédié~~ ✅ fait (`zpixbecqyhuphjtzzfia`) — **reste à exécuter
     `supabase-tables.sql`** dans le SQL Editor (tables absentes au 2026-10-01)
  3. ~~Remplacer les valeurs placeholder dans `js/supabase.js`~~ ✅ fait
  4. ~~Configurer les secrets GitHub~~ ✅ fait (2026-10-01)
  5. Activer GitHub Pages
  6. Tester le scan sur un vrai téléphone avec un vrai code-barre Solotech (le rendu caméra/permissions ne se
     teste pas fiablement autrement)

## Bloqué — action requise de Maxime

Deux actions ont été bloquées par un filtre de sécurité automatique de Claude Code (pas un choix de Claude) :
1. **Rendre le repo public** — nécessaire pour héberger gratuitement sur GitHub Pages (Pages privé = payant).
2. **Ouvrir un navigateur pour créer le projet Supabase** — Claude n'a aucun accès/jeton Supabase sur cette
   machine ; sans navigateur, il ne peut pas créer le projet lui-même.

Pour débloquer, une des options suivantes :
- Créer le projet Supabase soi-même (2 min sur supabase.com/dashboard → New Project) et donner à Claude l'URL +
  la clé anon publique (Project Settings → API) → Claude peut alors tout faire depuis là (SQL, secrets, config).
- Ou donner à Claude un token d'accès personnel Supabase (supabase.com/dashboard/account/tokens) pour qu'il
  pilote tout via le CLI/API sans navigateur.
- Rendre le repo public soi-même (Settings → Danger Zone → Change visibility) une fois prêt.
- Thème visuel repris d'`inventaire-outils` (industriel-luxe : charbon `#0c0d0c` + doré `#cda449`, Oswald +
  JetBrains Mono) pour une cohérence visuelle entre les deux apps de Maxime.

---

## Notes de collaboration avec Claude

- Maxime ne connaît pas le développement web ni Supabase — expliquer les décisions techniques en langage simple
  plutôt que d'exécuter silencieusement.
- Une fois Supabase/`gh` authentifiés sur la machine utilisée, agir de façon autonome pour git/gh/supabase
  (commits, push, requêtes SQL, déploiement) sans redemander confirmation à chaque étape. Rester attentif
  seulement si une action est structurellement ambiguë.
- Avant d'implémenter, valider les 4 points de la section "Décisions prises par défaut" avec Maxime — ce sont
  des choix d'architecture, pas des détails.

---

## V2 — Features prévues (ne pas implémenter maintenant)

- Export/rapport imprimable ou PDF à envoyer à Solotech après chaque démontage
- Suivi du stock permanent CDF sorti pour un événement (mouvement `sortie_stock_cdf`), si pas fait dès le départ
- Alerte si un item scanné en `retour_stock_cdf` n'a jamais été vu en `reception_surplus` (incohérence possible)
- Photos des items
- Vrai compte utilisateur par employé (si le suivi par prénom en `localStorage` devient insuffisant)
