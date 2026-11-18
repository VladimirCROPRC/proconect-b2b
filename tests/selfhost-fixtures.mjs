import { migrationFiles } from '../server/selfhost/migrations.mjs';
import { DatabaseSync } from 'node:sqlite';

export function fixtureSql() {
  return migrationFiles().map(migration => migration.sql).join('\n') + `
INSERT INTO app_users(id,username,name,role,password_hash,password_salt,password_iterations,password_reset_required,active,jobs,created_at,updated_at) VALUES ('u1','tech','Technician','Tehnician','copied-hash','copied-salt',100000,1,1,7,1,2),('u2','admin','Administrator','Admin','hash','salt',100000,0,1,0,1,2);
INSERT INTO projects(id,activity_type,client,address,contact,phone,email,requirements,technician,technician_username,cpe,cpe_requires_grounding,sfp,mc,terminal_box,status,scheduled_label,ipwo,splice,created_by,created_at,updated_at) VALUES('RID1','Instalare','Client','Address','Contact','07','','','Technician','tech','CPE',0,0,0,0,'Finalizat','1 Nov','','','admin',1,2);
INSERT INTO project_files(id,project_id,section,category,original_name,content_type,byte_size,storage_key,captured_at,uploaded_by,created_at) VALUES('photo','RID1','client','overview','photo.jpg','image/jpeg',4,'RID1/client/photo.jpg',100,'tech',200);
INSERT INTO app_sessions(id,user_id,token_hash,created_at,expires_at) VALUES('old','u1','old-token',1,9999999999999);
INSERT INTO onedrive_connection(id) VALUES('onedrive');
INSERT INTO onedrive_jobs(id,kind,item_id,revision,done_revision,attempts,next_at,last_error) VALUES('job','file','photo',1,0,0,0,'');
INSERT INTO project_field_documentation(project_id,content_json,updated_by,updated_at) VALUES('RID1','{}','tech',200);
`;
}

export function d1StyleFixtureSql() {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(fixtureSql());
    const literal = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
    const tables = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const output = ['PRAGMA defer_foreign_keys=TRUE;'];
    for (const table of tables) {
      output.push(table.sql + ';');
      for (const row of db.prepare(`SELECT * FROM "${table.name}"`).all()) output.push(`INSERT INTO "${table.name}" VALUES(${Object.values(row).map(literal).join(',')});`);
    }
    output.push(...db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all().map(row => row.sql + ';'));
    return output.join('\n');
  } finally { db.close(); }
}

