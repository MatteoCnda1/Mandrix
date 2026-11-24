// Outils d'administration : `node server/dist/cli.js <commande>` (ou `npm run cli -w server -- <commande>`).
import { eq, or } from 'drizzle-orm';
import { db, schema, sql } from './db/index.js';
import { hashPassword, randomToken } from './lib/auth.js';
import { importPool } from './lib/poolImport.js';

const [cmd, arg, arg2, arg3] = process.argv.slice(2);

async function findUser(login: string) {
  const [u] = await db
    .select()
    .from(schema.users)
    .where(or(eq(schema.users.email, login.toLowerCase()), eq(schema.users.username, login.toLowerCase())))
    .limit(1);
  if (!u) throw new Error(`Utilisateur introuvable : ${login}`);
  return u;
}

async function main() {
  switch (cmd) {
    case 'reset-password': {
      if (!arg) throw new Error('Usage : reset-password <email|pseudo> [nouveau-mot-de-passe]');
      const u = await findUser(arg);
      const pw = arg2 ?? randomToken().slice(0, 14);
      await db.update(schema.users).set({ passwordHash: await hashPassword(pw) }).where(eq(schema.users.id, u.id));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, u.id));
      console.log(`Mot de passe de @${u.username} réinitialisé : ${pw}`);
      break;
    }
    case 'make-admin': {
      if (!arg) throw new Error('Usage : make-admin <email|pseudo>');
      const u = await findUser(arg);
      await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, u.id));
      console.log(`@${u.username} est maintenant administrateur.`);
      break;
    }
    case 'import-pool': {
      // Toutes les images d'un dossier rejoignent le pool du jeu (public par défaut), au nom d'un membre.
      if (!arg || !arg2) throw new Error('Usage : import-pool <dossier> <email|pseudo> [public|friends]');
      const u = await findUser(arg2);
      const scope = arg3 === 'friends' ? 'friends' : 'public';
      const r = await importPool(arg, u.id, scope, (line) => console.log(line));
      console.log(`Pool ${scope === 'public' ? 'public' : 'amis'} : ${r.imported} image(s) ajoutée(s) au nom de @${u.username}, ${r.skipped} déjà importée(s), ${r.failed.length} échec(s).`);
      if (r.failed.length) process.exitCode = 1;
      break;
    }
    case 'users': {
      const rows = await db.select({ username: schema.users.username, email: schema.users.email, admin: schema.users.isAdmin }).from(schema.users);
      console.table(rows);
      break;
    }
    default:
      console.log('Commandes : reset-password <email|pseudo> [mdp] · make-admin <email|pseudo> · users · import-pool <dossier> <email|pseudo> [public|friends]');
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => sql.end({ timeout: 2 }));
