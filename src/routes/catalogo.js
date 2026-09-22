const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const NIVELES_VALIDOS = ['Alto', 'Moderado', 'Bajo'];

function toEntry(row) {
    return {
        id: row.id,
        categoria: row.categoria,
        actividad: row.actividad,
        peligro: row.peligro,
        riesgo: row.riesgo,
        nivel: row.nivel,
        medidas: row.medidas || '',
        epp: row.epp || '',
        activo: row.activo,
        creadoEn: row.creado_en,
        actualizadoEn: row.actualizado_en,
    };
}

function validateBody(body) {
    const b = body || {};
    const categoria = (b.categoria || '').trim();
    const actividad = (b.actividad || '').trim();
    const peligro = (b.peligro || '').trim();
    const riesgo = (b.riesgo || '').trim();
    const nivel = (b.nivel || '').trim();
    const medidas = (b.medidas || '').trim();
    const epp = (b.epp || '').trim();

    if (!categoria || !actividad || !peligro || !riesgo || !nivel) {
        return { error: 'Completá categoría, actividad, peligro, riesgo y nivel.' };
    }
    if (!NIVELES_VALIDOS.includes(nivel)) {
        return { error: 'El nivel debe ser Alto, Moderado o Bajo.' };
    }
    return { fields: { categoria, actividad, peligro, riesgo, nivel, medidas, epp } };
}

// LISTADO — cualquier usuario autenticado (lo necesita el selector del
// Anexo 1 al armar la matriz de riesgos de un permiso). Por defecto solo
// trae las activas; ?incluirInactivas=1 trae todo (lo usa la pantalla de
// administración del catálogo, que además está protegida por rol admin
// en el frontend y en los endpoints de escritura de acá abajo).
router.get('/', requireAuth, async (req, res) => {
    try {
        const incluirInactivas = req.query.incluirInactivas === '1';
        const { rows } = await pool.query(
            `SELECT * FROM catalogo_riesgos
             ${incluirInactivas ? '' : 'WHERE activo = true'}
             ORDER BY categoria, actividad`
        );
        res.json({ catalogo: rows.map(toEntry) });
    } catch (err) {
        console.error('Error al listar catálogo de riesgos:', err);
        res.status(500).json({ error: 'Error interno al listar el catálogo de riesgos.' });
    }
});

// CREAR — solo Seguridad e Higiene (rol admin)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
    const { error, fields } = validateBody(req.body);
    if (error) return res.status(400).json({ error });
    try {
        const { rows } = await pool.query(
            `INSERT INTO catalogo_riesgos (categoria, actividad, peligro, riesgo, nivel, medidas, epp, creado_por_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [fields.categoria, fields.actividad, fields.peligro, fields.riesgo, fields.nivel, fields.medidas, fields.epp, req.user.sub]
        );
        res.status(201).json({ entrada: toEntry(rows[0]) });
    } catch (err) {
        console.error('Error al crear entrada del catálogo:', err);
        res.status(500).json({ error: 'Error interno al crear la entrada.' });
    }
});

// EDITAR — solo Seguridad e Higiene (rol admin)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
    const { error, fields } = validateBody(req.body);
    if (error) return res.status(400).json({ error });
    try {
        const activo = req.body.activo !== undefined ? !!req.body.activo : true;
        const { rows } = await pool.query(
            `UPDATE catalogo_riesgos SET
                categoria=$1, actividad=$2, peligro=$3, riesgo=$4, nivel=$5, medidas=$6, epp=$7, activo=$8
             WHERE id = $9
             RETURNING *`,
            [fields.categoria, fields.actividad, fields.peligro, fields.riesgo, fields.nivel, fields.medidas, fields.epp, activo, req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Entrada no encontrada.' });
        res.json({ entrada: toEntry(rows[0]) });
    } catch (err) {
        console.error('Error al editar entrada del catálogo:', err);
        res.status(500).json({ error: 'Error interno al editar la entrada.' });
    }
});

// ACTIVAR / DESACTIVAR (sin tocar el resto de los campos) — solo admin.
// Se usa para "borrar" entradas del catálogo sin perder el historial:
// los permisos que ya copiaron una actividad a su Anexo 1 no se ven
// afectados, porque guardan una copia de los datos, no una referencia.
router.patch('/:id/activo', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `UPDATE catalogo_riesgos SET activo = $1 WHERE id = $2 RETURNING *`,
            [!!req.body.activo, req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Entrada no encontrada.' });
        res.json({ entrada: toEntry(rows[0]) });
    } catch (err) {
        console.error('Error al cambiar estado de la entrada del catálogo:', err);
        res.status(500).json({ error: 'Error interno.' });
    }
});

// ELIMINAR — solo Seguridad e Higiene (rol admin). Elimina definitivamente
// la fila del catálogo; no afecta permisos ya guardados (ver comentario
// arriba). Se recomienda usar "desactivar" salvo que sea un error de carga.
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { rowCount } = await pool.query('DELETE FROM catalogo_riesgos WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: 'Entrada no encontrada.' });
        res.json({ ok: true });
    } catch (err) {
        console.error('Error al eliminar entrada del catálogo:', err);
        res.status(500).json({ error: 'Error interno al eliminar la entrada.' });
    }
});

module.exports = router;
