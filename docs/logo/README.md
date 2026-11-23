# Mandrix — guide d'usage du logo

## 1. Le logo

**Idée :** un mandrill pensif, le poing sous le menton, qui réfléchit avant de poster. C'est la mascotte actuelle de l'appli (singe pensif, main bleue, bulles de pensée) en version low poly. Il porte le nez rouge et les joues bleues de l'image test « Mandrill », aux couleurs de l'appli.

| Version | Fichier | Usage |
|---|---|---|
| Symbole (tuile ciel) | `symbol/mandrix-symbol.svg` | Icône d'appli, avatar, partout où le logo est seul |
| Petite taille (tête seule) | `symbol/mandrix-symbol-small.svg` | Favicon, onglet, tout ce qui fait 32 px ou moins |
| Mascotte sans fond | `symbol/mandrix-symbol-mascot.svg` | Composant `Logo` de l'appli, **fonds clairs uniquement** |
| Plein cadre | `symbol/mandrix-symbol-square.svg` | Icône Apple (iOS arrondit lui-même les coins) |
| Zone sûre | `symbol/mandrix-symbol-safe.svg` | Icône Android « maskable », avatar rond |
| Une couleur | `symbol/mandrix-symbol-ink.svg` · `-white.svg` | Tampon, gravure, impression une couleur, filigrane |
| Une couleur, petite | `symbol/mandrix-symbol-small-ink.svg` · `-small-white.svg` | Badge de notification Android |
| Horizontal | `lockups/mandrix-horizontal*.svg` | En-tête de site, bannières (version principale) |
| Empilé | `lockups/mandrix-stacked*.svg` | Écran de démarrage, formats carrés, affiches |
| Nom seul | `wordmark/mandrix-wordmark-ink.svg` · `-white.svg` | Quand le symbole est déjà visible à côté |

Suffixes : *(aucun)* = couleur sur fond clair · `-reversed` = couleur sur fond sombre · `-ink` = une couleur encre · `-white` = une couleur blanc.

## 2. Zone de protection

Autour du logo, garder un espace vide égal à **la hauteur de la grosse bulle de pensée**, soit environ 9 % de la hauteur du symbole. Cet espace grandit avec le logo, ce n'est jamais une distance fixe.

## 3. Taille minimale

| Version | Écran | Impression |
|---|---|---|
| Symbole complet | 24 px | 8 mm |
| Petite taille (tête) | 16 px | 5 mm |
| Horizontal | 120 px de large | 30 mm de large |
| Empilé | 80 px de large | 20 mm de large |

Sous 24 px, utiliser la tête seule : le poing et les bulles deviennent du bruit.

## 4. Couleurs (jetons de `web/src/index.css`)

| Rôle | Jeton | HEX | RGB |
|---|---|---|---|
| Ciel haut | `--sky` | `#86C5F4` | 134 197 244 |
| Ciel milieu | `--page` | `#C9E5FA` | 201 229 250 |
| Ciel bas | `--sky` | `#EDF6FD` | 237 246 253 |
| Fourrure, nom | `--ink` / `night` | `#0B0F14` | 11 15 20 |
| Nez | `heart` | `#E5484D` | 229 72 77 |
| Joues, main | `brand` · `brand2` · `ice` | `#0E76C6` · `#2A9DF4` · `#6FC0FF` | 14 118 198 · 42 157 244 · 111 192 255 |
| Œil | `ember` | `#FF8A5C` | 255 138 92 |
| Lèvre | `fog` | `#C6D3DF` | 198 211 223 |
| Joue (fourrure claire) | `--phink` | `#3D5A73` | 61 90 115 |
| Nom sur fond sombre | `--ink` (sombre) | `#EEF4FA` | 238 244 250 |

Les facettes font varier légèrement la luminosité de chaque couleur. Les valeurs ci-dessus sont les couleurs de base. Pour l'impression, faire établir les équivalents CMJN et Pantone par l'imprimeur à partir de ces valeurs.

**Associations validées**
- Symbole en tuile : sur n'importe quel fond, la tuile porte son propre ciel.
- Logo horizontal ou empilé en couleur : sur blanc, sur `--page` ou sur le dégradé ciel.
- Version `-reversed` : sur les fonds du mode sombre (`#0B1622`, `#0E2A47`, `#080C11`).
- Version `-ink` : sur fond clair uni.
- Version `-white` : sur fond sombre, sur bleu `brand` ou sur photo (dans une zone calme).

## 5. Typographie

- **Nom :** Yesteryear, la police `--font-script` de l'appli. Dans les fichiers, le nom est vectorisé (des tracés, pas du texte) : il s'affiche à l'identique sans la police. La police est sous licence SIL Open Font 1.1, qui permet son usage dans un logo.
- **Textes autour du logo :** Plus Jakarta Sans, la police `--font-sans` de l'appli.

## 6. À ne pas faire

- Déformer le logo, l'écraser ou le faire tourner.
- Changer les couleurs hors de la palette.
- Ajouter une ombre, un contour ou un effet.
- Retaper le nom avec un clavier : utiliser les fichiers.
- Changer la taille ou la place du nom par rapport au symbole dans un logo.
- Poser la mascotte sans fond sur un fond sombre : la fourrure disparaît. Utiliser la tuile à la place.
- Utiliser le symbole complet sous 24 px.

## 7. Dans l'appli

Les fichiers de `symbol/` sont la source de vérité. `npm run icons` (`web/scripts/gen-icons.mjs`) en tire tout ce qu'utilise l'appli :

| Master | Produit |
|---|---|
| `mandrix-symbol.svg` | `web/src/assets/logo/mandrix-symbol.svg` (composant `Logo`), `web/public/icons/icon-192.png` · `icon-512.png` |
| `mandrix-symbol-small.svg` | `web/public/favicon.svg`, `web/public/favicon.ico` (16, 32, 48 px) |
| `mandrix-symbol-safe.svg` | `web/public/icons/maskable-512.png` |
| `mandrix-symbol-square.svg` | `web/public/icons/apple-touch-icon.png` |
| `mandrix-symbol-small-white.svg` | `web/public/icons/badge-72.png` |

Après une retouche d'un master, lancer `npm run icons` à la racine, puis committer les fichiers produits. La couleur `theme-color` (`#86C5F4` en clair, `#0E2A47` en sombre) ne change pas.

Les diapos `presentation/` montrent le logo final et ses maquettes (icône d'appli, site, profil, onglet, autocollant, cartes de visite).

**Marque :** aucune recherche d'antériorité n'a été faite sur le nom « Mandrix » ni sur le logo. À faire avant un dépôt officiel.
