const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { signToken, setAuthCookie, clearAuthCookie, requireAuth, isFullAccess } = require('../middleware/auth');

const router = express.Router();

function publicUser(row) {
    return {
        usuario: row.usuario,
        nombre: row.nombre,
        apellido: row.apellido,
        rol: row.rol,
        cargo: row.cargo,
        area: row.area_nombre || null,
        fullAccess: isFullAccess(row.rol),
        // No expone el hash, solo si ya tiene una contraseña configurada.
        // El frontend usa esto para decidir si mostrar "Ingresar" (pide la
        // contraseña existente) o "Crear contraseña" (primer ingreso, o
        // después de que Seguridad e Higiene se la reinició).
        tieneClave: !!row.password_hash,
    };
}

// Listado público (sin autenticar) para poblar el selector de usuario en el
// login y el selector de Autorizante del formulario. No expone password_hash.
router.get('/usuarios-publico', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT u.*, a.nombre AS area_nombre
             FROM usuarios u
             LEFT JOIN areas a ON a.id = u.area_id
             WHERE u.activo = true
             ORDER BY u.apellido`
        );
        res.json({ usuarios: rows.map(publicUser) });
    } catch (err) {
        console.error('Error al listar usuarios públicos:', err);
        res.status(500).json({ error: 'Error interno.' });
    }
});

// Autoregistro de nuevos usuarios: piden nombre y apellido, el sistema
// genera el usuario (1ra letra del nombre + apellido, igual que los ya
// cargados) y ellos eligen su contraseña en el momento. Quedan siempre con
// rol "operario": solo pueden cargar permisos propios y ver el estado de
// los que ya cargaron (ver requireFullAccess / GET /permisos/mios).
function soloLetras(s) {
    return (s || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // saca acentos
        .replace(/[^a-zA-Z]/g, '');
}

router.post('/registrar', async (req, res) => {
    const { nombre, apellido, password, confirmPassword } = req.body || {};
    if (!nombre || !String(nombre).trim() || !apellido || !String(apellido).trim() || !password || !confirmPassword) {
        return res.status(400).json({ error: 'Completá nombre, apellido y contraseña.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    }
    if (password !== confirmPassword) {
        return res.status(400).json({ error: 'Las contraseñas no coinciden.' });
    }

    const nombreTrim = String(nombre).trim();
    const apellidoTrim = String(apellido).trim();
    const base = soloLetras(nombreTrim).slice(0, 1).toUpperCase() + soloLetras(apellidoTrim).toLowerCase();
    if (!base) {
        return res.status(400).json({ error: 'Nombre y apellido inválidos.' });
    }

    try {
        // Si ya existe un usuario activo con el mismo nombre y apellido, no
        // creamos un duplicado (esto pasó de verdad: alguien se olvidó la
        // contraseña y se volvió a registrar, quedando con dos cuentas para
        // la misma persona). En vez de eso, avisamos y lo mandamos a pedir
        // el reseteo por el canal correcto.
        const { rows: dup } = await pool.query(
            `SELECT usuario FROM usuarios
             WHERE activo = true
               AND lower(trim(nombre)) = lower(trim($1))
               AND lower(trim(apellido)) = lower(trim($2))
             LIMIT 1`,
            [nombreTrim, apellidoTrim]
        );
        if (dup[0]) {
            return res.status(409).json({
                error: `Ya existe un usuario registrado con ese nombre y apellido (usuario: ${dup[0].usuario}). Si es tu cuenta y olvidaste la contraseña, pedile a Seguridad e Higiene que te la resetee — no te registres de nuevo.`,
            });
        }

        // Usuario libre: Fgodoy, Fgodoy2, Fgodoy3, ...
        let usuario = base;
        let n = 2;
        for (;;) {
            const { rows } = await pool.query('SELECT 1 FROM usuarios WHERE lower(usuario) = lower($1)', [usuario]);
            if (!rows[0]) break;
            usuario = base + n;
            n += 1;
        }

        const hash = await bcrypt.hash(password, 10);
        const { rows: created } = await pool.query(
            `INSERT INTO usuarios (usuario, nombre, apellido, rol, cargo, password_hash, activo)
             VALUES ($1, $2, $3, 'operario', NULL, $4, true)
             RETURNING *`,
            [usuario, nombreTrim, apellidoTrim, hash]
        );

        const token = signToken(created[0]);
        setAuthCookie(res, token);
        res.status(201).json({ user: publicUser({ ...created[0], area_nombre: null }) });
    } catch (err) {
        console.error('Error al registrar usuario:', err);
        res.status(500).json({ error: 'Error interno al crear el usuario.' });
    }
});

// Primer ingreso (o después de que Seguridad e Higiene reinició la clave):
// el usuario todavía no tiene password_hash, así que en vez de "iniciar
// sesión" lo que hace es CREAR su contraseña. No requiere estar autenticado
// (todavía no puede estarlo), pero solo funciona si password_hash está
// vacío — no sirve para pisarle la contraseña a alguien que ya tiene una.
router.post('/crear-clave', async (req, res) => {
    const { usuario, password, confirmPassword } = req.body || {};
    if (!usuario || !password || !confirmPassword) {
        return res.status(400).json({ error: 'Faltan datos.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    }
    if (password !== confirmPassword) {
        return res.status(400).json({ error: 'Las contraseñas no coinciden.' });
    }

    try {
        const { rows } = await pool.query(
            `SELECT u.*, a.nombre AS area_nombre
             FROM usuarios u
             LEFT JOIN areas a ON a.id = u.area_id
             WHERE lower(u.usuario) = lower($1)`,
            [usuario.trim()]
        );
        const user = rows[0];
        if (!user || !user.activo) {
            return res.status(401).json({ error: 'Usuario no encontrado o deshabilitado.' });
        }
        if (user.password_hash) {
            return res.status(409).json({ error: 'Este usuario ya tiene una contraseña configurada. Si la olvidaste, pedile a Seguridad e Higiene que te la reinicie.' });
        }

        const hash = await bcrypt.hash(password, 10);
        const { rows: updated } = await pool.query(
            'UPDATE usuarios SET password_hash = $1, actualizado_en = now() WHERE id = $2 RETURNING *',
            [hash, user.id]
        );

        const token = signToken(updated[0]);
        setAuthCookie(res, token);
        res.status(201).json({ user: publicUser({ ...updated[0], area_nombre: user.area_nombre }) });
    } catch (err) {
        console.error('Error al crear contraseña:', err);
        res.status(500).json({ error: 'Error interno al crear la contraseña.' });
    }
});

router.post('/login', async (req, res) => {
    const { usuario, password } = req.body || {};
    if (!usuario || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
    }

    try {
        const { rows } = await pool.query(
            `SELECT u.*, a.nombre AS area_nombre
             FROM usuarios u
             LEFT JOIN areas a ON a.id = u.area_id
             WHERE lower(u.usuario) = lower($1)`,
            [usuario.trim()]
        );
        const user = rows[0];

        if (!user || !user.activo) {
            return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
        }
        if (!user.password_hash) {
            return res.status(401).json({ error: 'Este usuario todavía no configuró su contraseña. Volvé a elegirlo en el selector para crearla.' });
        }

        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) {
            return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
        }

        const token = signToken(user);
        setAuthCookie(res, token);
        res.json({ user: publicUser(user) });
    } catch (err) {
        console.error('Error en login:', err);
        res.status(500).json({ error: 'Error interno al iniciar sesión.' });
    }
});

router.post('/logout', (req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT u.*, a.nombre AS area_nombre
             FROM usuarios u
             LEFT JOIN areas a ON a.id = u.area_id
             WHERE u.id = $1`,
            [req.user.sub]
        );
        const user = rows[0];
        if (!user || !user.activo) {
            clearAuthCookie(res);
            return res.status(401).json({ error: 'Usuario deshabilitado.' });
        }
        res.json({ user: publicUser(user) });
    } catch (err) {
        console.error('Error en /me:', err);
        res.status(500).json({ error: 'Error interno.' });
    }
});

router.put('/password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Faltan datos.' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
    }
    try {
        const { rows } = await pool.query('SELECT * FROM usuarios WHERE id = $1', [req.user.sub]);
        const user = rows[0];
        if (!user) return res.status(401).json({ error: 'No autenticado.' });

        const ok = await bcrypt.compare(currentPassword, user.password_hash || '');
        if (!ok) return res.status(401).json({ error: 'La contraseña actual no es correcta.' });

        const newHash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE usuarios SET password_hash = $1, actualizado_en = now() WHERE id = $2', [newHash, user.id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('Error al cambiar password:', err);
        res.status(500).json({ error: 'Error interno.' });
    }
});

module.exports = router;
