const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireFullAccess } = require('../middleware/auth');
const { dbRowToPermit, permitBodyToDbFields } = require('../mappers/permit');

const router = express.Router();

const BASE_PATH = process.env.BASE_PATH || '/PDT';

function friendlyDbError(err) {
    if (err.code === '23514' && err.constraint === 'chk_fecha_fin_tarea') {
        return { status: 400, message: 'La fecha de fin de tarea no puede superar los 14 días desde la fecha de inicio.' };
    }
    if (err.code === '23514' && err.constraint === 'chk_autorizante_distinto') {
        return { status: 400, message: 'El autorizante no puede ser la misma persona que el solicitante o el ejecutante.' };
    }
    if (err.code === '23505') {
        return { status: 409, message: 'Ya existe un permiso con ese código. Probá guardar de nuevo.' };
    }
    if (err.code === 'P0001') {
        // RAISE EXCEPTION del trigger (ej: borrar un permiso que no está en Borrador)
        return { status: 403, message: err.message };
    }
    return null;
}

async function attachmentsFor(permisoId) {
    const { rows } = await pool.query(
        `SELECT id, nombre_archivo, tipo_mime, tamano_bytes
         FROM permiso_adjuntos WHERE permiso_id = $1 ORDER BY subido_en`,
        [permisoId]
    );
    return rows.map((r) => ({
        id: r.id,
        nombre: r.nombre_archivo,
        tipo: r.tipo_mime,
        size: Number(r.tamano_bytes) || 0,
        url: `${BASE_PATH}/api/permisos/${permisoId}/adjuntos/${r.id}`,
    }));
}

// LISTADO — solo responsables / admin (igual que el botón "Registro de Permisos")
router.get('/', requireAuth, requireFullAccess, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT p.*, u.usuario AS creado_por_usuario
             FROM permisos_trabajo p
             LEFT JOIN usuarios u ON u.id = p.creado_por_id
             ORDER BY p.creado_en DESC`
        );
        const permisos = await Promise.all(
            rows.map(async (row) => dbRowToPermit(row, await attachmentsFor(row.id)))
        );
        res.json({ permisos });
    } catch (err) {
        console.error('Error al listar permisos:', err);
        res.status(500).json({ error: 'Error interno al listar los permisos.' });
    }
});

// LISTADO PROPIO — cualquier usuario autenticado, solo sus propios permisos.
// Es la forma que tienen los operarios (y cualquiera sin fullAccess) de ver
// en qué estado quedó lo que cargaron, ya que GET / está limitado a
// responsables/admin. Debe ir ANTES de GET /:id: si no, Express interpreta
// "mios" como si fuera el :id de esa otra ruta.
router.get('/mios', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT p.*, u.usuario AS creado_por_usuario
             FROM permisos_trabajo p
             LEFT JOIN usuarios u ON u.id = p.creado_por_id
             WHERE p.creado_por_id = $1
             ORDER BY p.creado_en DESC`,
            [req.user.sub]
        );
        const permisos = await Promise.all(
            rows.map(async (row) => dbRowToPermit(row, await attachmentsFor(row.id)))
        );
        res.json({ permisos });
    } catch (err) {
        console.error('Error al listar mis permisos:', err);
        res.status(500).json({ error: 'Error interno al listar los permisos.' });
    }
});

// RESUMEN DE NOTIFICACIONES — badge del header para responsables/admin.
// Suma dos cosas: permisos en Borrador donde YO figuro como autorizante
// (esperando que los pase a Autorizado), y revalidaciones diarias de HOY
// que todavía nadie confirmó en permisos Autorizados (cualquier admin o
// responsable puede confirmarlas, no hace falta ser el autorizante titular
// de ese permiso puntual). Debe ir ANTES de GET /:id por el mismo motivo
// que /mios.
router.get('/notificaciones/resumen', requireAuth, requireFullAccess, async (req, res) => {
    try {
        const borradorRes = await pool.query(
            `SELECT id, codigo, lugar FROM permisos_trabajo
             WHERE estado = 'Borrador' AND autorizante_usuario_id = $1
             ORDER BY creado_en DESC`,
            [req.user.sub]
        );

        const activosRes = await pool.query(
            `SELECT id, codigo, lugar, revalidaciones, fecha_inicio, fecha_fin_tarea
             FROM permisos_trabajo WHERE estado = 'Autorizado'`
        );

        const hoy = new Date().toISOString().slice(0, 10);
        const revalidacionItems = [];
        for (const row of activosRes.rows) {
            const inicio = row.fecha_inicio ? new Date(row.fecha_inicio).toISOString().slice(0, 10) : null;
            const fin = row.fecha_fin_tarea ? new Date(row.fecha_fin_tarea).toISOString().slice(0, 10) : inicio;
            if (!inicio || hoy < inicio || (fin && hoy > fin)) continue; // el trabajo no está en curso hoy
            const revs = Array.isArray(row.revalidaciones) ? row.revalidaciones : [];
            const deHoy = revs.find((r) => r.fecha === hoy);
            if (!deHoy || !deHoy.aprobado) revalidacionItems.push({ id: row.id, codigo: row.codigo, lugar: row.lugar });
        }

        const borradorItems = borradorRes.rows.map(r => ({ id: r.id, codigo: r.codigo, lugar: r.lugar }));
        res.json({
            borrador: borradorItems.length,
            borradorItems,
            revalidacion: revalidacionItems.length,
            revalidacionItems,
            total: borradorItems.length + revalidacionItems.length,
        });
    } catch (err) {
        console.error('Error al calcular notificaciones:', err);
        res.status(500).json({ error: 'Error interno al calcular notificaciones.' });
    }
});

// UNO POR ID — responsables siempre; operarios solo si es un permiso propio
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT p.*, u.usuario AS creado_por_usuario
             FROM permisos_trabajo p
             LEFT JOIN usuarios u ON u.id = p.creado_por_id
             WHERE p.id = $1`,
            [req.params.id]
        );
        const row = rows[0];
        if (!row) return res.status(404).json({ error: 'Permiso no encontrado.' });
        if (!req.user.fullAccess && row.creado_por_id !== req.user.sub) {
            return res.status(403).json({ error: 'No tenés acceso a este permiso.' });
        }
        const permit = dbRowToPermit(row, await attachmentsFor(row.id));
        res.json({ permiso: permit });
    } catch (err) {
        console.error('Error al obtener permiso:', err);
        res.status(500).json({ error: 'Error interno.' });
    }
});

async function resolveAutorizante(nombre) {
    if (!nombre) return null;
    // Solo "responsable" puede ser autorizante de un permiso. El rol "admin"
    // (Seguridad e Higiene) tiene acceso a todo el sistema por soporte y
    // mantenimiento, pero no es responsable de ninguna instalación puntual,
    // así que no debe poder figurar como autorizante ni aparecer en el
    // desplegable de selección (ver también el filtro en el frontend).
    const { rows } = await pool.query(
        `SELECT id FROM usuarios
         WHERE activo = true AND rol = 'responsable'
           AND (nombre || ' ' || apellido) = $1`,
        [nombre]
    );
    return rows[0] ? rows[0].id : null;
}

// Un permiso solo puede pasar a "Autorizado" si quien está guardando es
// exactamente la persona seleccionada como autorizante, logueada con su
// propio usuario — nadie puede autorizar en nombre de otro, ni siquiera
// otro responsable o el admin. Se compara por id de usuario (ya resuelto
// arriba), no por nombre, para que no dependa de coincidencias de texto.
function verificarAutoAutorizacion(fields, req, estadoAnterior = null) {
    if (fields.estado !== 'Autorizado') return null;
    if (estadoAnterior === 'Autorizado') return null; // ya estaba Autorizado, no es una autorización nueva
    if (!fields.autorizante_usuario_id || fields.autorizante_usuario_id !== req.user.sub) {
        return 'Solo la persona seleccionada como autorizante puede autorizar este permiso, y tiene que hacerlo desde su propia sesión.';
    }
    return null;
}

// CREAR
router.post('/', requireAuth, async (req, res) => {
    try {
        const fields = permitBodyToDbFields(req.body);

        if (JSON.parse(fields.tipos_permiso).length === 0) {
            return res.status(400).json({ error: 'Seleccioná al menos un tipo de permiso.' });
        }

        if (fields.autorizante_nombre) {
            const autorizanteId = await resolveAutorizante(fields.autorizante_nombre);
            if (!autorizanteId) {
                return res.status(400).json({ error: 'El autorizante debe ser un responsable registrado del sistema.' });
            }
            fields.autorizante_usuario_id = autorizanteId;
        } else {
            fields.autorizante_usuario_id = null;
        }

        const errorAutoAutorizacion = verificarAutoAutorizacion(fields, req);
        if (errorAutoAutorizacion) return res.status(403).json({ error: errorAutoAutorizacion });

        const seq = await pool.query("SELECT nextval('permisos.permiso_codigo_seq') AS n");
        const codigo = `PT-${new Date().getFullYear()}-${String(seq.rows[0].n).padStart(4, '0')}`;

        const { rows } = await pool.query(
            `INSERT INTO permisos_trabajo (
                codigo, tipos_permiso, tipo_permiso_otro, estado, zona_riesgo, fecha_inicio, hora_inicio, hora_fin,
                fecha_fin_tarea, un_tof, lugar, equipo, descripcion_trabajo,
                aplicacion, precauciones, condiciones, gases, incendio, epp,
                solicitante_nombre, solicitante_dni, solicitante_visito,
                ejecutante_nombre, ejecutante_dni, ejecutante_visito,
                autorizante_usuario_id, autorizante_nombre, autorizante_dni,
                cierre, anexo1, anexo2, anexo3, creado_por_id
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,
                $9,$10,$11,$12,$13,
                $14,$15,$16,$17,$18,$19,
                $20,$21,$22,
                $23,$24,$25,
                $26,$27,$28,
                $29,$30,$31,$32,$33
            ) RETURNING *`,
            [
                codigo, fields.tipos_permiso, fields.tipo_permiso_otro, fields.estado, fields.zona_riesgo, fields.fecha_inicio, fields.hora_inicio, fields.hora_fin,
                fields.fecha_fin_tarea, fields.un_tof, fields.lugar, fields.equipo, fields.descripcion_trabajo,
                fields.aplicacion, fields.precauciones, fields.condiciones, fields.gases, fields.incendio, fields.epp,
                fields.solicitante_nombre, fields.solicitante_dni, fields.solicitante_visito,
                fields.ejecutante_nombre, fields.ejecutante_dni, fields.ejecutante_visito,
                fields.autorizante_usuario_id, fields.autorizante_nombre, fields.autorizante_dni,
                fields.cierre, fields.anexo1, fields.anexo2, fields.anexo3, req.user.sub,
            ]
        );

        await pool.query(
            `INSERT INTO permiso_historial (permiso_id, usuario_id, accion, estado_nuevo, detalle)
             VALUES ($1,$2,'creado',$3,$4)`,
            [rows[0].id, req.user.sub, rows[0].estado, JSON.stringify({ usuario: req.user.usuario })]
        );

        const permit = dbRowToPermit({ ...rows[0], creado_por_usuario: req.user.usuario }, []);
        res.status(201).json({ permiso: permit });
    } catch (err) {
        const friendly = friendlyDbError(err);
        if (friendly) return res.status(friendly.status).json({ error: friendly.message });
        console.error('Error al crear permiso:', err);
        res.status(500).json({ error: 'Error interno al crear el permiso.' });
    }
});

// EDITAR
router.put('/:id', requireAuth, async (req, res) => {
    try {
        const existing = await pool.query('SELECT * FROM permisos_trabajo WHERE id = $1', [req.params.id]);
        const current = existing.rows[0];
        if (!current) return res.status(404).json({ error: 'Permiso no encontrado.' });
        if (!req.user.fullAccess) {
            if (current.creado_por_id !== req.user.sub) {
                return res.status(403).json({ error: 'No tenés acceso a este permiso.' });
            }
            if (current.estado !== 'Borrador') {
                return res.status(403).json({ error: 'Este permiso ya fue enviado y no se puede modificar. Solo podés ver su estado.' });
            }
        }

        const fields = permitBodyToDbFields(req.body);

        if (JSON.parse(fields.tipos_permiso).length === 0) {
            return res.status(400).json({ error: 'Seleccioná al menos un tipo de permiso.' });
        }

        if (fields.autorizante_nombre) {
            const autorizanteId = await resolveAutorizante(fields.autorizante_nombre);
            if (!autorizanteId) {
                return res.status(400).json({ error: 'El autorizante debe ser un responsable registrado del sistema.' });
            }
            fields.autorizante_usuario_id = autorizanteId;
        } else {
            fields.autorizante_usuario_id = null;
        }

        const errorAutoAutorizacion = verificarAutoAutorizacion(fields, req, current.estado);
        if (errorAutoAutorizacion) return res.status(403).json({ error: errorAutoAutorizacion });

        // Si esto es una autorización nueva y legítima (el propio autorizante
        // titular la está haciendo), cualquier autorización provisoria vieja
        // queda obsoleta — se limpia para no mostrar un aviso de "provisorio"
        // sobre un permiso que ya tiene el OK real de su autorizante.
        const limpiaAutorizacionProvisoria = fields.estado === 'Autorizado' && current.estado !== 'Autorizado' && fields.autorizante_usuario_id === req.user.sub;
        const autorizacionProvisoriaValue = limpiaAutorizacionProvisoria ? null : (current.autorizacion_provisoria ? JSON.stringify(current.autorizacion_provisoria) : null);

        const { rows } = await pool.query(
            `UPDATE permisos_trabajo SET
                tipos_permiso=$1, tipo_permiso_otro=$2, estado=$3, zona_riesgo=$4, fecha_inicio=$5, hora_inicio=$6, hora_fin=$7,
                fecha_fin_tarea=$8, un_tof=$9, lugar=$10, equipo=$11, descripcion_trabajo=$12,
                aplicacion=$13, precauciones=$14, condiciones=$15, gases=$16, incendio=$17, epp=$18,
                solicitante_nombre=$19, solicitante_dni=$20, solicitante_visito=$21,
                ejecutante_nombre=$22, ejecutante_dni=$23, ejecutante_visito=$24,
                autorizante_usuario_id=$25, autorizante_nombre=$26, autorizante_dni=$27,
                cierre=$28, anexo1=$29, anexo2=$30, anexo3=$31, autorizacion_provisoria=$32
             WHERE id = $33
             RETURNING *`,
            [
                fields.tipos_permiso, fields.tipo_permiso_otro, fields.estado, fields.zona_riesgo, fields.fecha_inicio, fields.hora_inicio, fields.hora_fin,
                fields.fecha_fin_tarea, fields.un_tof, fields.lugar, fields.equipo, fields.descripcion_trabajo,
                fields.aplicacion, fields.precauciones, fields.condiciones, fields.gases, fields.incendio, fields.epp,
                fields.solicitante_nombre, fields.solicitante_dni, fields.solicitante_visito,
                fields.ejecutante_nombre, fields.ejecutante_dni, fields.ejecutante_visito,
                fields.autorizante_usuario_id, fields.autorizante_nombre, fields.autorizante_dni,
                fields.cierre, fields.anexo1, fields.anexo2, fields.anexo3, autorizacionProvisoriaValue, req.params.id,
            ]
        );

        if (current.estado !== rows[0].estado) {
            await pool.query(
                `INSERT INTO permiso_historial (permiso_id, usuario_id, accion, estado_anterior, estado_nuevo, detalle)
                 VALUES ($1,$2,'editado',$3,$4,$5)`,
                [req.params.id, req.user.sub, current.estado, rows[0].estado, JSON.stringify({ usuario: req.user.usuario })]
            );
        }

        const archivos = await attachmentsFor(req.params.id);
        const creadorRow = await pool.query('SELECT usuario FROM usuarios WHERE id = $1', [rows[0].creado_por_id]);
        const permit = dbRowToPermit({ ...rows[0], creado_por_usuario: creadorRow.rows[0] ? creadorRow.rows[0].usuario : '' }, archivos);
        res.json({ permiso: permit });
    } catch (err) {
        const friendly = friendlyDbError(err);
        if (friendly) return res.status(friendly.status).json({ error: friendly.message });
        console.error('Error al editar permiso:', err);
        res.status(500).json({ error: 'Error interno al editar el permiso.' });
    }
});

// AUTORIZACIÓN PROVISORIA — excepción al candado de auto-autorización de
// arriba: cuando el autorizante titular no puede loguearse (licencia,
// enfermedad, etc.), CUALQUIER OTRO admin/responsable puede autorizar el
// permiso para no frenar a los ejecutantes, pero queda un registro
// explícito de que fue una autorización de excepción — quién la hizo,
// cuándo y por qué motivo — sin borrar quién era el autorizante titular.
router.put('/:id/autorizar-provisorio', requireAuth, requireFullAccess, async (req, res) => {
    try {
        const existing = await pool.query(
            'SELECT estado, autorizante_usuario_id, autorizante_nombre FROM permisos_trabajo WHERE id = $1',
            [req.params.id]
        );
        const current = existing.rows[0];
        if (!current) return res.status(404).json({ error: 'Permiso no encontrado.' });
        if (current.estado !== 'Borrador') {
            return res.status(403).json({ error: 'La autorización provisoria solo aplica a permisos en Borrador.' });
        }
        if (!current.autorizante_usuario_id) {
            return res.status(400).json({ error: 'Este permiso todavía no tiene un autorizante asignado.' });
        }
        if (current.autorizante_usuario_id === req.user.sub) {
            return res.status(403).json({ error: 'Vos sos el autorizante de este permiso — autorizalo directamente en vez de usar la autorización provisoria.' });
        }
        const motivo = String((req.body && req.body.motivo) || '').trim();
        if (!motivo) {
            return res.status(400).json({ error: 'Tenés que indicar el motivo de la autorización provisoria (por qué el autorizante titular no puede hacerlo).' });
        }

        const autorizacionProvisoria = {
            usuarioId: req.user.sub,
            usuario: req.user.usuario,
            nombre: req.user.nombre || '',
            apellido: req.user.apellido || '',
            fechaHora: new Date().toISOString(),
            motivo,
        };

        const { rows } = await pool.query(
            `UPDATE permisos_trabajo SET estado = 'Autorizado', autorizacion_provisoria = $1 WHERE id = $2 RETURNING *`,
            [JSON.stringify(autorizacionProvisoria), req.params.id]
        );

        await pool.query(
            `INSERT INTO permiso_historial (permiso_id, usuario_id, accion, estado_anterior, estado_nuevo, detalle)
             VALUES ($1,$2,'autorizado_provisorio','Borrador','Autorizado',$3)`,
            [req.params.id, req.user.sub, JSON.stringify({ usuario: req.user.usuario, autorizanteTitular: current.autorizante_nombre, motivo })]
        );

        const archivos = await attachmentsFor(req.params.id);
        const creadorRow = await pool.query('SELECT usuario FROM usuarios WHERE id = $1', [rows[0].creado_por_id]);
        const permit = dbRowToPermit({ ...rows[0], creado_por_usuario: creadorRow.rows[0] ? creadorRow.rows[0].usuario : '' }, archivos);
        res.json({ permiso: permit });
    } catch (err) {
        console.error('Error al autorizar provisoriamente:', err);
        res.status(500).json({ error: 'Error interno al autorizar provisoriamente el permiso.' });
    }
});

// REVALIDACIÓN DIARIA — guardado aparte del formulario general, para que
// confirmar la asistencia de un día quede grabado al toque y no dependa de
// que alguien guarde el permiso entero. Cualquier admin/responsable puede
// cargar días y personal presente (no hace falta ser el autorizante titular
// de ese permiso). La única restricción es al APROBAR: el solicitante de
// ese permiso puntual no puede dar su propio OK (self-approval), aunque sí
// puede seguir cargando días/trabajadores — ver chequeo abajo.
router.put('/:id/revalidaciones', requireAuth, requireFullAccess, async (req, res) => {
    try {
        const existing = await pool.query(
            'SELECT estado, solicitante_nombre, revalidaciones FROM permisos_trabajo WHERE id = $1',
            [req.params.id]
        );
        if (!existing.rows[0]) return res.status(404).json({ error: 'Permiso no encontrado.' });
        if (existing.rows[0].estado !== 'Autorizado') {
            return res.status(403).json({ error: 'La revalidación diaria solo aplica a permisos Autorizados.' });
        }

        const revalidaciones = Array.isArray(req.body.revalidaciones) ? req.body.revalidaciones : [];

        // Mismo criterio de self-approval que usamos al crear el permiso
        // (chk_autorizante_distinto): el solicitante no puede dar el OK de
        // su propia tarea, aunque sea admin/responsable. Se compara por
        // nombre completo porque "solicitante" es un campo de texto libre,
        // no un usuario del sistema. Solo bloqueamos si este guardado
        // introduce una aprobación NUEVA (día que antes no estaba aprobado)
        // — cargar días o editar trabajadores sigue permitido siempre.
        const solicitante = (existing.rows[0].solicitante_nombre || '').trim().toLowerCase();
        const usuarioLogueado = `${req.user.nombre || ''} ${req.user.apellido || ''}`.trim().toLowerCase();
        const esSolicitante = !!(solicitante && usuarioLogueado && solicitante === usuarioLogueado);
        if (esSolicitante) {
            const previamenteAprobados = new Set(
                (existing.rows[0].revalidaciones || []).filter(d => d && d.aprobado).map(d => d.id)
            );
            const introduceAprobacionNueva = revalidaciones.some(d => d && d.aprobado && !previamenteAprobados.has(d.id));
            if (introduceAprobacionNueva) {
                return res.status(403).json({ error: 'No podés aprobar la revalidación de un permiso del que sos el solicitante.' });
            }
        }

        const { rows } = await pool.query(
            `UPDATE permisos_trabajo SET revalidaciones = $1 WHERE id = $2 RETURNING revalidaciones`,
            [JSON.stringify(revalidaciones), req.params.id]
        );

        await pool.query(
            `INSERT INTO permiso_historial (permiso_id, usuario_id, accion, detalle)
             VALUES ($1,$2,'revalidacion_diaria',$3)`,
            [req.params.id, req.user.sub, JSON.stringify({ usuario: req.user.usuario, dias: revalidaciones.length })]
        );

        res.json({ revalidaciones: rows[0].revalidaciones });
    } catch (err) {
        console.error('Error al guardar la revalidación diaria:', err);
        res.status(500).json({ error: 'Error interno al guardar la revalidación diaria.' });
    }
});

// ELIMINAR — solo responsables/admin, y solo si está en Borrador (reforzado por trigger en DB)
router.delete('/:id', requireAuth, requireFullAccess, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT estado FROM permisos_trabajo WHERE id = $1', [req.params.id]);
        if (!rows[0]) return res.status(404).json({ error: 'Permiso no encontrado.' });
        if (rows[0].estado !== 'Borrador') {
            return res.status(403).json({ error: 'Solo se pueden eliminar permisos que estén en estado Borrador.' });
        }
        await pool.query('DELETE FROM permisos_trabajo WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        const friendly = friendlyDbError(err);
        if (friendly) return res.status(friendly.status).json({ error: friendly.message });
        console.error('Error al eliminar permiso:', err);
        res.status(500).json({ error: 'Error interno al eliminar el permiso.' });
    }
});

module.exports = router;
