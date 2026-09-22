-- =====================================================================
-- Migración 005: Revalidación diaria de permisos autorizados
-- =====================================================================
-- Se guarda como una columna JSONB en permisos_trabajo, igual que
-- anexo1/anexo2/anexo3: un array donde cada elemento es un día de
-- trabajo con la lista de personas presentes y, si ya fue confirmado,
-- quién y cuándo dio el OK.
--
-- Forma de cada elemento del array:
--   {
--     "id": "1788300000000",                 -- string, para poder editar/borrar
--     "fecha": "2026-09-02",
--     "trabajadores": [{"nombre":"Juan","apellido":"Pérez"}, ...],
--     "aprobado": null | {
--         "usuarioId": "<uuid>",
--         "usuario": "Mfigueroa",
--         "nombre": "Mauricio", "apellido": "Figueroa",
--         "fechaHora": "2026-09-02T14:33:00.000Z"
--     }
--   }
--
-- Cómo correrlo: pgAdmin -> base de producción -> Query Tool ->
-- pegar esto entero -> F5.
-- =====================================================================

SET search_path TO permisos, public;

ALTER TABLE permisos_trabajo
    ADD COLUMN IF NOT EXISTS revalidaciones JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN permisos_trabajo.revalidaciones IS 'Revalidación diaria de asistencia de un permiso Autorizado: array de {id, fecha, trabajadores:[{nombre,apellido}], aprobado:null|{usuarioId,usuario,nombre,apellido,fechaHora}}.';

-- Verificación
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'permisos' AND table_name = 'permisos_trabajo' AND column_name = 'revalidaciones';
