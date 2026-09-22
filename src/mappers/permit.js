// Convierte entre las filas de la tabla permisos_trabajo (snake_case, JSONB)
// y el objeto "currentPermit" tal como lo maneja el frontend (camelCase, anidado).

const ANEXO2_DEFAULTS = {
    permisoAsociado: '', magnitud: '', razon: 'Original', energias: [], puntosIngreso: '',
    detalles: [],
    aislarOk: [false, false, false, false, false, false], aislarNombre: '', aislarDni: '', aislarFecha: '', aislarAutorizante: '', aislarFirma: '',
    retirarOk: [false, false, false, false, false, false], retirarNombre: '', retirarDni: '', retirarFecha: '', retirarAutorizante: '', retirarFirma: '',
    prolNombre: '', prolApellido: '', prolDni: '', prolFecha: '', prolFirma: '',
};

// Anexo 3 (Plan de Izaje): igual que Anexo 2, se guarda entero como un solo
// JSONB, así que no hace falta migrar su forma interna si cambia de a poco.
const ANEXO3_DEFAULTS = {
    fecha: '', areaSector: '', locacion: '', pozo: '', descripcionCarga: '', obra: '', descripcionManiobra: '',
    contratistaEquipo: '', contratistaResponsable: '', procedimientoIzaje: '',
    equipo1: { tipoModelo: '', nInterno: '', capacidad: '', normativa: '', certInspeccion: '', fechaVencimiento: '', certPuenteGrua: '' },
    equipo2: { tipoModelo: '', nInterno: '', capacidad: '', normativa: '', certInspeccion: '', fechaVencimiento: '', certPuenteGrua: '' },
    operador1: { nombre: '', credencial: '', entidad: '', normativa: '', tipoEquipo: '', carga: '', fechaVencimiento: '' },
    operador2: { nombre: '', credencial: '', entidad: '', normativa: '', tipoEquipo: '', carga: '', fechaVencimiento: '' },
    senalero: { nombre: '', credencial: '', entidad: '', normativa: '', fechaVencimiento: '' },
    eslingador1: { nombre: '', credencial: '', entidad: '', normativa: '', fechaVencimiento: '' },
    eslingador2: { nombre: '', credencial: '', entidad: '', normativa: '', fechaVencimiento: '' },
    elementos: [],
    anguloEslingado: '',
    tipoIzaje: 'No Crítico',
    pesoCarga: '', largoCarga: '', anchoCarga: '', altoCarga: '',
    cuadrante: [],
    porcentajeEstabilizadores: '', personalNecesario: '',
    posInicial: { radioOperativo: '', alturaPluma: '', telescopicos: '', reenvios: '', capacidadIzaje: '' },
    posFinal: { radioOperativo: '', alturaPluma: '', telescopicos: '', reenvios: '', capacidadIzaje: '' },
    izajePersonas: false,
    examenesMedicos: false,
    guindola: { fabricante: '', modelo: '', nSerie: '', pesoPropio: '', certificado: '', fechaVencimiento: '', fechaFabricacion: '', capacidadCarga: '', cantidadPersonas: '' },
    calc: { pesoCarga: '', pesoElementos: '', pesoGanchoPpal: '', pesoGanchoAux: '', pesoAguilon: '', pesoCable: '', pesoGuindola: '', pesoPersonas: '', capacidadGrua: '' },
    validacion: {
        operador: { nombre: '', firma: '', dni: '', fecha: '' },
        supervisorContratista: { nombre: '', firma: '', dni: '', fecha: '' },
        supervisorEmpresa: { nombre: '', firma: '', dni: '', fecha: '' },
    },
    checklist: {
        sector: '', contratista: '', fecha: '', equipo: '', instalacionPozo: '', hora: '',
        items: Array(27).fill('NA'),
        observaciones: '',
        conformidad: {
            operador: { firma: '', aclaracion: '', dni: '' },
            supervisorIzaje: { firma: '', aclaracion: '', dni: '' },
            supervisorEmpresa: { firma: '', aclaracion: '', dni: '' },
        },
    },
};

function dbRowToPermit(row, archivos = []) {
    const aplicacion = row.aplicacion || {};
    const condiciones = row.condiciones || {};
    return {
        id: row.id,
        code: row.codigo,
        fecha: toDateStr(row.fecha_inicio),
        fechaFinTarea: toDateStr(row.fecha_fin_tarea),
        horaInicio: toTimeStr(row.hora_inicio),
        horaFin: toTimeStr(row.hora_fin),
        unTof: row.un_tof || '',
        lugar: row.lugar || '',
        equipo: row.equipo || '',
        tipoPermiso: row.tipo_permiso,
        tiposPermiso: Array.isArray(row.tipos_permiso) ? row.tipos_permiso : [],
        tipoPermisoOtro: row.tipo_permiso_otro || '',
        anexo1: Array.isArray(row.anexo1) ? row.anexo1 : [],
        anexo2: { ...ANEXO2_DEFAULTS, ...(row.anexo2 && typeof row.anexo2 === 'object' ? row.anexo2 : {}) },
        anexo3: { ...ANEXO3_DEFAULTS, ...(row.anexo3 && typeof row.anexo3 === 'object' ? row.anexo3 : {}) },
        // Revalidación diaria de asistencia (permisos Autorizados). Se administra
        // aparte, con su propio endpoint (PUT /:id/revalidaciones) — no pasa por
        // el guardado general del formulario, así que acá solo se lee.
        revalidaciones: Array.isArray(row.revalidaciones) ? row.revalidaciones : [],
        // Autorización de excepción (el autorizante titular no podía
        // loguearse). Se administra aparte, con su propio endpoint
        // (PUT /:id/autorizar-provisorio) — acá solo se lee.
        autorizacionProvisoria: (row.autorizacion_provisoria && typeof row.autorizacion_provisoria === 'object') ? row.autorizacion_provisoria : null,
        descripcionTrabajo: row.descripcion_trabajo || '',
        zonaRiesgo: row.zona_riesgo,
        creadoPor: row.creado_por_usuario || '',
        aplicacion: {
            esquema: !!aplicacion.esquema,
            procedimientos: !!aplicacion.procedimientos,
            pAndId: !!aplicacion.pAndId,
            pcr: !!aplicacion.pcr,
            archivos,
        },
        precauciones: Array.isArray(row.precauciones) && row.precauciones.length ? row.precauciones : Array(20).fill('SI'),
        condiciones: {
            altura: condiciones.altura || { activo: false, resps: Array(6).fill('SI') },
            confinado: condiciones.confinado || { activo: false, resps: Array(7).fill('SI') },
            electrica: condiciones.electrica || { activo: false, resps: Array(7).fill('SI') },
            excavacion: condiciones.excavacion || { activo: false, resps: Array(5).fill('SI') },
        },
        gases: row.gases || {},
        incendio: row.incendio || {},
        epp: row.epp || {},
        solicitante: {
            nombre: row.solicitante_nombre || '',
            dni: row.solicitante_dni || '',
            visitoLugar: !!row.solicitante_visito,
        },
        ejecutante: {
            nombre: row.ejecutante_nombre || '',
            dni: row.ejecutante_dni || '',
            visitoLugar: !!row.ejecutante_visito,
        },
        autorizante: {
            nombre: row.autorizante_nombre || '',
            dni: row.autorizante_dni || '',
        },
        estado: row.estado,
        cierre: row.cierre || {},
        creadoEn: row.creado_en,
        actualizadoEn: row.actualizado_en,
    };
}

function toDateStr(value) {
    if (!value) return '';
    if (typeof value === 'string') return value.slice(0, 10);
    return new Date(value).toISOString().slice(0, 10);
}

function toTimeStr(value) {
    if (!value) return '';
    if (typeof value === 'string') return value.slice(0, 5);
    return String(value).slice(0, 5);
}

// Toma el body enviado por el frontend y arma los valores listos para el
// INSERT/UPDATE (en el mismo orden que usan las rutas).
function permitBodyToDbFields(body) {
    const b = body || {};
    const solicitante = b.solicitante || {};
    const ejecutante = b.ejecutante || {};
    const autorizante = b.autorizante || {};
    const cierre = b.cierre || {};
    const aplicacion = b.aplicacion || {};

    return {
        tipos_permiso: JSON.stringify(Array.isArray(b.tiposPermiso) ? b.tiposPermiso : []),
        tipo_permiso_otro: b.tipoPermisoOtro || null,
        anexo1: JSON.stringify(Array.isArray(b.anexo1) ? b.anexo1 : []),
        anexo2: JSON.stringify(b.anexo2 || {}),
        anexo3: JSON.stringify(b.anexo3 || {}),
        estado: b.estado || 'Borrador',
        zona_riesgo: b.zonaRiesgo || 'Riesgo',
        fecha_inicio: b.fecha || null,
        hora_inicio: b.horaInicio || null,
        hora_fin: b.horaFin || null,
        fecha_fin_tarea: b.fechaFinTarea || null,
        un_tof: b.unTof || null,
        lugar: b.lugar || null,
        equipo: b.equipo || null,
        descripcion_trabajo: b.descripcionTrabajo || null,
        aplicacion: JSON.stringify({
            esquema: !!aplicacion.esquema,
            procedimientos: !!aplicacion.procedimientos,
            pAndId: !!aplicacion.pAndId,
            pcr: !!aplicacion.pcr,
        }),
        precauciones: JSON.stringify(Array.isArray(b.precauciones) ? b.precauciones : []),
        condiciones: JSON.stringify(b.condiciones || {}),
        gases: JSON.stringify(b.gases || {}),
        incendio: JSON.stringify(b.incendio || {}),
        epp: JSON.stringify(b.epp || {}),
        solicitante_nombre: solicitante.nombre || '',
        solicitante_dni: solicitante.dni || null,
        solicitante_visito: !!solicitante.visitoLugar,
        ejecutante_nombre: ejecutante.nombre || null,
        ejecutante_dni: ejecutante.dni || null,
        ejecutante_visito: !!ejecutante.visitoLugar,
        autorizante_nombre: autorizante.nombre || null,
        autorizante_dni: autorizante.dni || null,
        cierre: JSON.stringify({
            estadoEjecutante: cierre.estadoEjecutante || 'Completado',
            obsEjecutante: cierre.obsEjecutante || '',
            estadoAutorizante: cierre.estadoAutorizante || 'Aprobado',
            obsAutorizante: cierre.obsAutorizante || '',
        }),
    };
}

module.exports = { dbRowToPermit, permitBodyToDbFields };
