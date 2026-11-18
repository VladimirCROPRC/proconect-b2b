import { resolve } from 'node:path';
import { openDatabase } from './sqlite.mjs';

const [command, username, value] = process.argv.slice(2);
const db = openDatabase(resolve(process.env.PROCONECT_DATA_DIR || '/data', 'app.sqlite'));
try {
  if (command === 'list') console.log(JSON.stringify(db.prepare('SELECT u.username,u.name,u.role,u.active,a.email FROM app_users u LEFT JOIN app_user_access a ON a.user_id=u.id ORDER BY u.name').all(), null, 2));
  else if (command === 'email') {
    const email = (value || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Email invalid.');
    const user = db.prepare('SELECT id FROM app_users WHERE username=?').get(username);
    if (!user) throw new Error('Username-ul nu există în copia importată.');
    db.prepare('INSERT INTO app_user_access(user_id,email) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email').run(user.id, email);
    console.log('Email asociat. Permite adresa și în politica Cloudflare Access.');
  } else throw new Error('Utilizare: users.mjs list | users.mjs email USERNAME EMAIL');
} finally { db.close(); }
