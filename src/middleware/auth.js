const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'pdt_token';
const FULL_ACCESS_ROLES = ['admin', 'responsable'];

function isFullAccess(rol) {
    return FULL_ACCESS_ROLES.includes(rol);
}

function signToken(user) {
    return jwt.sign(
        {
            sub: user.id,
            usuario: user.usuario,
            nombre: user.nombre,
            apellido: user.apellido,
            rol: user.rol,
            cargo: user.cargo,
            fullAccess: isFullAccess(user.rol),
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
    );
}

function setAuthCookie(res, token) {
    res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        // secure: true, // activar cuando el sitio se sirva por HTTPS
        maxAge: 12 * 60 * 60 * 1000,
        path: '/',
    });
}

function clearAuthCookie(res) {
    res.clearCookie(COOKIE_NAME, { path: '/' });
}

function requireAuth(req, res, next) {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    if (!token) {
        return res.status(401).json({ error: 'No autenticado. Iniciá sesión nuevamente.' });
    }
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.user = payload;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Sesión inválida o expirada. Iniciá sesión nuevamente.' });
    }
}

function requireFullAccess(req, res, next) {
    if (!req.user || !req.user.fullAccess) {
        return res.status(403).json({ error: 'No tenés permisos para esta acción.' });
    }
    next();
}

// Más estricto que requireFullAccess: solo el rol "admin" (Seguridad e
// Higiene), no cualquier responsable. Se usa para resetear contraseñas.
function requireAdmin(req, res, next) {
    if (!req.user || req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Solo Seguridad e Higiene puede realizar esta acción.' });
    }
    next();
}

module.exports = {
    COOKIE_NAME,
    isFullAccess,
    signToken,
    setAuthCookie,
    clearAuthCookie,
    requireAuth,
    requireFullAccess,
    requireAdmin,
};