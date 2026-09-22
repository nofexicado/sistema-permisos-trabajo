// Resetea la base a un estado "recién nacido": borra TODOS los permisos de
// trabajo de prueba (con sus adjuntos e historial) y deja lista la base
// para arrancar con el uso real. NO toca usuarios ni áreas -- esas cuentas
// siguen intactas para poder loguearse después de correr esto.
//
// Antes de correrlo: hacé un backup manual desde pgAdmin
// (click derecho sobre la base "permisos_trabajo" -> Backup...).
//
// Uso:
//   npm run resetear-produccion

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const pool = require('../src/db/pool');

const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || './uploads');

function ask(pregunta) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(pregunta, (resp) => { rl.close(); resolve(resp); }));
}

async function main() {
    const { rows: totales } = await pool.query(`
        SELECT
            (SELECT count(*) FROM permisos_trabajo) AS permisos,
            (SELECT count(*) FROM permiso_adjuntos) AS adjuntos,
            (SELECT count(*) FROM permiso_historial) AS historial
    `);
    const t = totales[0];

    console.log('\n=== RESET DE DATOS DE PRUEBA — PDT ===\n');
    console.log('Esto va a BORRAR de forma permanente:');
    console.log(`  - ${t.permisos} permiso(s) de trabajo`);
    console.log(`  - ${t.adjuntos} archivo(s) adjunto(s) (registro en la base + archivo en disco)`);
    console.log(`  - ${t.historial} entrada(s) de historial/auditoría`);
    console.log('\nNO se van a tocar: usuarios, áreas, ni el catálogo de riesgos.');
    console.log(`Los archivos actuales de la carpeta de adjuntos ("${UPLOADS_DIR}") se van a MOVER`);
    console.log('(no borrar) a una carpeta de backup, y después se deja la carpeta vacía.');
    console.log('\nRecomendado: hacé antes un backup manual de la base desde pgAdmin');
    console.log('(click derecho sobre "permisos_trabajo" -> Backup...).\n');

    const confirm1 = await ask('Escribí BORRAR TODO (en mayúsculas, tal cual) para confirmar: ');
    if (confirm1.trim() !== 'BORRAR TODO') {
        console.log('\nCancelado. No se modificó nada.');
        await pool.end();
        return;
    }

    // --- 1) Mover el contenido actual de uploads/ a una carpeta de backup con fecha ---
    if (fs.existsSync(UPLOADS_DIR) && fs.readdirSync(UPLOADS_DIR).length > 0) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(path.dirname(UPLOADS_DIR), `uploads_backup_${stamp}`);
        fs.renameSync(UPLOADS_DIR, backupDir);
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        console.log(`\nArchivos anteriores movidos a: ${backupDir}`);
    } else {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        console.log('\nLa carpeta de adjuntos ya estaba vacía.');
    }

    // --- 2) Vaciar las tablas de datos de prueba (usuarios y áreas quedan intactos) ---
    await pool.query('TRUNCATE permisos_trabajo, permiso_adjuntos, permiso_historial, sesiones RESTART IDENTITY CASCADE');
    await pool.query('ALTER SEQUENCE permiso_codigo_seq RESTART WITH 1');

    console.log('\nListo. La base quedó sin permisos/adjuntos/historial y la numeración PT-#### arranca de nuevo desde 0001.');
    console.log('Los usuarios y áreas no se tocaron: se puede seguir logueando igual que antes.\n');

    await pool.end();
}

main().catch((err) => {
    console.error('Error al resetear los datos:', err);
    process.exit(1);
});
