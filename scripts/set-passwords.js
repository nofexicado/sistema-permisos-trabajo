// Genera contraseñas iniciales para los usuarios que todavía no tienen
// (password_hash IS NULL) y las guarda hasheadas en la base.
// Las muestra UNA sola vez por consola para que las repartas — no quedan
// guardadas en ningún archivo ni se pueden volver a ver después.
//
// Uso:
//   npm run set-passwords            -> solo usuarios sin password todavía
//   npm run set-passwords -- --force -> pisa también los que ya tenían

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../src/db/pool');

const FORCE = process.argv.includes('--force');
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; // sin 0/O/1/l/I para evitar confusiones

function randomPassword(length = 10) {
    const bytes = require('crypto').randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
        out += CHARSET[bytes[i] % CHARSET.length];
    }
    return out;
}

async function main() {
    const { rows } = await pool.query(
        `SELECT id, usuario, nombre, apellido, password_hash
         FROM usuarios
         WHERE activo = true
         ${FORCE ? '' : 'AND password_hash IS NULL'}
         ORDER BY apellido`
    );

    if (!rows.length) {
        console.log('No hay usuarios pendientes de contraseña (usá --force para regenerar todas).');
        await pool.end();
        return;
    }

    const results = [];
    for (const user of rows) {
        if (!user.nombre || !user.nombre.trim()) {
            console.log(`⚠ Salteado ${user.usuario}: falta cargarle el nombre de pila en la tabla usuarios.`);
            continue;
        }
        const plain = randomPassword(10);
        const hash = await bcrypt.hash(plain, 10);
        await pool.query('UPDATE usuarios SET password_hash = $1, actualizado_en = now() WHERE id = $2', [hash, user.id]);
        results.push({ usuario: user.usuario, nombre: `${user.nombre} ${user.apellido}`, password: plain });
    }

    console.log('\n=== CONTRASEÑAS INICIALES — repartir por un canal seguro y no guardar este texto ===\n');
    console.table(results.map(({ usuario, nombre, password }) => ({ usuario, nombre, password })));
    console.log('\nPedile a cada persona que la cambie la primera vez que entra (opción "Cambiar contraseña" en el header).\n');

    await pool.end();
}

main().catch((err) => {
    console.error('Error generando contraseñas:', err);
    process.exit(1);
});
