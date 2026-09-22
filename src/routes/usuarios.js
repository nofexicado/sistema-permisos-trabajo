const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireAdmin, isFullAccess } = require('../middleware/auth');

const router = express.Router();

// Lista de usuarios activos (sin password_hash). Se usa, entre otras cosas,
// para poblar el combo de "Autorizante" en el formulario.
router.get('/', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT u.usuario, u.nombre, u.apellido, u.rol, u.cargo, a.nombre AS area
             FROM usuarios u
             LEFT JOIN areas a ON a.id = u.area_id
             WHERE u.activo = true
             ORDER BY u.apellido`
        );
        const usuarios = rows.map((r) => ({
            usuario: r.usuario,
            nombre: r.nombre,
            apellido: r.apellido,
            rol: r.rol,
            cargo: r.cargo,
            area: r.area,
            fullAccess: isFullAccess(r.rol),
        }));
        res.json({ usuarios });
    } catch (err) {
        console.error('Error al listar usuarios:', err);
        res.status(500).json({ error: 'Error interno.' });
    }
});

// Lista de áreas activas, para poblar el selector del alta de usuario.
router.get('/areas', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT id, nombre FROM areas ORDER BY nombre');
        res.json({ areas: rows });
    } catch (err) {
        console.error('Error al listar áreas:', err);
        res.status(500).json({ error: 'Error interno.' });
    }
});

const ROLES_VALIDOS = ['operario', 'responsable', 'admin'];

function soloLetras(s) {
    return (s || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // saca acentos
        .replace(/[^a-zA-Z]/g, '');
}

// Busca un usuario ACTIVO que ya tenga el mismo nombre y apellido (sin
// distinguir may\u00fasculas/min\u00fasculas). Se usa tanto en el autoregistro como en
// el alta por parte de Seguridad e Higiene para evitar el caso real que
// pas\u00f3: alguien se olvid\u00f3 la contrase\u00f1a y en vez de pedir un reseteo se
// volvi\u00f3 a registrar, generando un usuario duplicado (Abarrios2) para la
// misma persona.
async function buscarUsuarioDuplicado(nombreTrim, apellidoTrim) {
    if (!nombreTrim || !apellidoTrim) return null; // sin nombre no podemos comparar de forma confiable
    const { rows } = await pool.query(
        `SELECT usuario, rol FROM usuarios
         WHERE activo = true
           AND lower(trim(nombre)) = lower(trim($1))
           AND lower(trim(apellido)) = lower(trim($2))
         LIMIT 1`,
        [nombreTrim, apellidoTrim]
    );
    return rows[0] || null;
}

// Alta de usuario por Seguridad e Higiene (rol "admin"): a diferencia del
// autoregistro (que siempre crea "operario"), acá el admin elige el rol —
// "operario", o "responsable"/"admin" para que la persona pueda actuar como
// Autorizante. Queda sin contraseña (password_hash NULL): la persona la crea
// ella misma en su primer ingreso, con el usuario que le pase el admin —
// mismo mecanismo que el autoregistro y que "resetear-clave".
router.post('/', requireAuth, requireAdmin, async (req, res) => {
    const { nombre, apellido, area_id, rol, cargo } = req.body || {};
    const nombreTrim = String(nombre || '').trim();
    const apellidoTrim = String(apellido || '').trim();
    if (!apellidoTrim) {
        return res.status(400).json({ error: 'El apellido es obligatorio.' });
    }
    const rolFinal = ROLES_VALIDOS.includes(rol) ? rol : 'operario';
    const areaIdFinal = Number.isInteger(Number(area_id)) && area_id ? Number(area_id) : null;

    const base = soloLetras(nombreTrim).slice(0, 1).toUpperCase() + soloLetras(apellidoTrim).toLowerCase();
    if (!base) {
        return res.status(400).json({ error: 'Nombre y apellido inválidos.' });
    }

    try {
        const duplicado = await buscarUsuarioDuplicado(nombreTrim, apellidoTrim);
        if (duplicado) {
            return res.status(409).json({
                error: `Ya existe un usuario activo con ese nombre y apellido: ${duplicado.usuario} (rol: ${duplicado.rol}). Si esta persona necesita volver a entrar, resetéale la contraseña desde "Gestionar usuarios" en vez de crear una cuenta nueva.`,
            });
        }

        // Usuario libre: mismo esquema que el autoregistro (Fgodoy, Fgodoy2, ...)
        let usuario = base;
        let n = 2;
        for (;;) {
            const { rows } = await pool.query('SELECT 1 FROM usuarios WHERE lower(usuario) = lower($1)', [usuario]);
            if (!rows[0]) break;
            usuario = base + n;
            n += 1;
        }

        const { rows: created } = await pool.query(
            `INSERT INTO usuarios (usuario, nombre, apellido, area_id, rol, cargo, password_hash, activo)
             VALUES ($1, $2, $3, $4, $5, $6, NULL, true)
             RETURNING usuario, nombre, apellido, rol, cargo`,
            [usuario, nombreTrim, apellidoTrim, areaIdFinal, rolFinal, (cargo || '').trim() || null]
        );
        res.status(201).json({ usuario: created[0] });
    } catch (err) {
        console.error('Error al crear usuario:', err);
        res.status(500).json({ error: 'Error interno al crear el usuario.' });
    }
});

// Resetear la contrase�a de un usuario: solo Seguridad e Higiene (rol
// "admin"). No genera una contrase�a nueva ni la elige el admin � solo
// borra la que ten�a, para que en su pr�ximo ingreso el sistema le pida
// crear una nueva, igual que la primera vez que entr�.
router.post('/:usuario/resetear-clave', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `UPDATE usuarios SET password_hash = NULL, actualizado_en = now()
             WHERE lower(usuario) = lower($1) AND activo = true
             RETURNING usuario, nombre, apellido`,
            [(req.params.usuario || '').trim()]
        );
        if (!rows[0]) {
            return res.status(404).json({ error: 'Usuario no encontrado o deshabilitado.' });
        }
        res.json({ ok: true, usuario: rows[0].usuario });
    } catch (err) {
        console.error('Error al resetear contrase�a:', err);
        res.status(500).json({ error: 'Error interno.' });
    }
});

// Cambiar el rol de un usuario existente: solo Seguridad e Higiene (rol
// "admin"). Se usa desde el panel de "Gestión de Usuarios", donde el admin
// ve la lista completa y puede corregir el rol de cualquiera sin tener que
// recrear la cuenta.
router.put('/:usuario/rol', requireAuth, requireAdmin, async (req, res) => {
    const { rol } = req.body || {};
    if (!ROLES_VALIDOS.includes(rol)) {
        return res.status(400).json({ error: 'Rol inválido.' });
    }
    try {
        const { rows } = await pool.query(
            `UPDATE usuarios SET rol = $1, actualizado_en = now()
             WHERE lower(usuario) = lower($2) AND activo = true
             RETURNING usuario, nombre, apellido, rol`,
            [rol, (req.params.usuario || '').trim()]
        );
        if (!rows[0]) {
            return res.status(404).json({ error: 'Usuario no encontrado o deshabilitado.' });
        }
        res.json({ ok: true, usuario: rows[0] });
    } catch (err) {
        console.error('Error al cambiar el rol:', err);
        res.status(500).json({ error: 'Error interno.' });
    }
});

// Eliminar (dar de baja) un usuario: solo Seguridad e Higiene (rol "admin").
// Es una baja lógica (activo = false), no un DELETE físico — igual que ya
// se hace con el catálogo de riesgos. Se eligió así porque un usuario puede
// tener permisos, adjuntos, sesiones o historial ya asociados (todos con FK
// a usuarios.id) y un borrado físico rompería esos registros; además deja
// rastro para auditoría. Un usuario dado de baja ya no puede loguearse ni
// aparece en ningún listado ("WHERE activo = true"), así que para quien lo
// usa es exactamente como si estuviera eliminado. Pensado sobre todo para
// limpiar las cuentas duplicadas (el caso "Abarrios2") que quedaron de antes
// de bloquear el autoregistro duplicado.
router.delete('/:usuario', requireAuth, requireAdmin, async (req, res) => {
    const usuarioTarget = (req.params.usuario || '').trim();
    if (usuarioTarget.toLowerCase() === (req.user.usuario || '').toLowerCase()) {
        return res.status(400).json({ error: 'No podés eliminar tu propio usuario.' });
    }
    try {
        const { rows } = await pool.query(
            `UPDATE usuarios SET activo = false, actualizado_en = now()
             WHERE lower(usuario) = lower($1) AND activo = true
             RETURNING usuario, nombre, apellido`,
            [usuarioTarget]
        );
        if (!rows[0]) {
            return res.status(404).json({ error: 'Usuario no encontrado o ya estaba eliminado.' });
        }
        res.json({ ok: true, usuario: rows[0].usuario });
    } catch (err) {
        console.error('Error al eliminar usuario:', err);
        res.status(500).json({ error: 'Error interno.' });
    }
});

module.exports = router;