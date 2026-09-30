-- Script SQL à coller dans Supabase Dashboard → SQL Editor
-- Crée les tables nécessaires pour l'app Scanner Inventaire CDF
-- Voir CLAUDE.md pour le contexte métier complet

-- 1. Articles : catalogue du matériel rencontré (identifié par son code-barre)
create table articles (
  id uuid default gen_random_uuid() primary key,
  code_barre text not null unique,
  nom text not null default 'Article à nommer',
  categorie text,
  notes text,
  created_at timestamp with time zone default now()
);

-- 2. Mouvements : journal de chaque scan.
-- C'est la pièce centrale : sert d'historique/preuve en cas d'erreur à débattre avec Solotech,
-- et le stock actuel en est dérivé (jamais stocké/maintenu à la main, pour éviter la
-- désynchronisation qui est justement le problème vécu avec le système de Solotech).
create table mouvements (
  id uuid default gen_random_uuid() primary key,
  article_id uuid not null references articles(id) on delete cascade,
  type text not null check (type in (
    'reception_surplus',  -- reçu de Solotech (arrive au CDF)
    'retour_solotech',    -- renvoyé à Solotech (quitte le CDF)
    'retour_stock_cdf',   -- gardé au CDF après démontage (reste/revient au CDF)
    'sortie_stock_cdf'    -- sorti du stock permanent CDF pour un événement
  )),
  quantite integer not null default 1 check (quantite > 0),
  evenement text,
  utilisateur text,
  note text,
  created_at timestamp with time zone default now()
);

create index mouvements_article_id_idx on mouvements(article_id);
create index mouvements_created_at_idx on mouvements(created_at desc);
create index mouvements_evenement_idx on mouvements(evenement);

-- 3. Vue du stock actuel au CDF, par article.
-- reception_surplus et retour_stock_cdf font entrer du matériel au CDF (+)
-- retour_solotech et sortie_stock_cdf font sortir du matériel du CDF (-)
create view stock_cdf as
select
  a.id as article_id,
  a.code_barre,
  a.nom,
  a.categorie,
  coalesce(sum(
    case when m.type in ('reception_surplus', 'retour_stock_cdf') then m.quantite else 0 end
  ), 0)
  -
  coalesce(sum(
    case when m.type in ('retour_solotech', 'sortie_stock_cdf') then m.quantite else 0 end
  ), 0)
  as quantite_stock,
  max(m.created_at) as dernier_mouvement
from articles a
left join mouvements m on m.article_id = a.id
group by a.id, a.code_barre, a.nom, a.categorie;

-- RLS désactivé volontairement : accès ouvert à tout le personnel du CDF, pas de vrai
-- login (voir "Décisions prises par défaut" dans CLAUDE.md). Les données exposées
-- (noms d'équipement, quantités) ne sont pas jugées sensibles.
alter table articles disable row level security;
alter table mouvements disable row level security;
