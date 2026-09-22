const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || './uploads');
const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 8);

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(UPLOADS_DIR, req.params.id);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const safeName = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, safeName);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
});

async function canAccessPermiso(req, res, next) {
    try {
        const { rows } = await pool.query('SELECT creado_por_id FROM permisos_trabajo WHERE id = $1', [req.params.id]);
        if (!rows[0]) return res.status(404).json({ error: 'Permiso no encontrado.' });
        if (!req.user.fullAccess && rows[0].creado_por_id !== req.user.sub) {
            return res.status(403).json({ error: 'No tenés acceso a este permiso.' });
        }
        next();
    } catch (err) {
        console.error('Error verificando acceso al permiso:', err);
        res.status(500).json({ error: 'Error interno.' });
    }
}

// SUBIR uno o más archivos
router.post('/', requireAuth, canAccessPermiso, upload.array('archivos', 10), async (req, res) => {
    try {
        const files = req.files || [];
        const inserted = [];
        for (const file of files) {
            const { rows } = await pool.query(
                `INSERT INTO permiso_adjuntos (permiso_id, nombre_archivo, tipo_mime, tamano_bytes, ruta_archivo, subido_por_id)
                 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, nombre_archivo, tipo_mime, tamano_bytes`,
                [req.params.id, file.originalname, file.mimetype, file.size, file.path, req.user.sub]
            );
            const row = rows[0];
            inserted.push({
                id: row.id,
                nombre: row.nombre_archivo,
                tipo: row.tipo_mime,
                size: Number(row.tamano_bytes),
                url: `${process.env.BASE_PATH || '/PDT'}/api/permisos/${req.params.id}/adjuntos/${row.id}`,
            });
        }
        res.status(201).json({ archivos: inserted });
    } catch (err) {
        console.error('Error al subir adjuntos:', err);
        res.status(500).json({ error: 'Error interno al subir los archivos.' });
    }
});

// DESCARGAR uno
router.get('/:adjuntoId', requireAuth, canAccessPermiso, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM permiso_adjuntos WHERE id = $1 AND permiso_id = $2',
            [req.params.adjuntoId, req.params.id]
        );
        const adjunto = rows[0];
        if (!adjunto || !adjunto.ruta_archivo || !fs.existsSync(adjunto.ruta_archivo)) {
            return res.status(404).json({ error: 'Archivo no encontrado.' });
        }
        res.download(adjunto.ruta_archivo, adjunto.nombre_archivo);
    } catch (err) {
        console.error('Error al descargar adjunto:', err);
        res.status(500).json({ error: 'Error interno.' });
    }
});

// ELIMINAR uno
router.delete('/:adjuntoId', requireAuth, canAccessPermiso, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM permiso_adjuntos WHERE id = $1 AND permiso_id = $2',
            [req.params.adjuntoId, req.params.id]
        );
        const adjunto = rows[0];
        if (!adjunto) return res.status(404).json({ error: 'Archivo no encontrado.' });
        await pool.query('DELETE FROM permiso_adjuntos WHERE id = $1', [adjunto.id]);
        if (adjunto.ruta_archivo && fs.existsSync(adjunto.ruta_archivo)) {
            fs.unlink(adjunto.ruta_archivo, () => {});
        }
        res.json({ ok: true });
    } catch (err) {
        console.error('Error al eliminar adjunto:', err);
        res.status(500).json({ error: 'Error interno.' });
    }
});

module.exports = router;
