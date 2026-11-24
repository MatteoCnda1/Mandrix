import { sql, type SQL } from 'drizzle-orm';

/** Recherche sans accents ni casse (« cafe » trouve « Café ») : même repli côté JavaScript et côté PostgreSQL. */
const FOLD_FROM = 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ';
const FOLD_TO = 'aaaaaaceeeeiiiinooooouuuuyy';

export const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Colonne repliée (minuscules, sans accents). */
export const foldSql = (col: SQL) => sql`translate(lower(${col}), ${FOLD_FROM}, ${FOLD_TO})`;

/** Motif LIKE « contient », jokers échappés, texte replié. */
export const likePattern = (q: string) => `%${fold(q).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
