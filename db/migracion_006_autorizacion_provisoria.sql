-- =====================================================================
-- Migración 006: Autorización provisoria (excepción del autorizante)
-- =====================================================================
-- Cuando el autorizante titular de un permiso no puede loguearse (está
-- de licencia, se enfermó, etc.), otro admin/responsable puede autorizar
-- el permiso "provisoriamente" para no frenar a los ejecutantes. Queda
-- registrado quién lo hizo, cuándo y por qué motivo — sin perder de vista
-- quién era el autorizante titular (esa columna no se toca).
--
-- Forma del valor:
--   null  -- nunca se usó la autorización provisoria en este permiso
--   {
--     "usuarioId": "<uuid>", "usuario": "Mfernandez",
--     "nombre": "Matías", "apellido": "Fernández",
--     "fechaHora": "2026-09-03T14:33:00.000Z",
--     "motivo": "El autorizante titular está de licencia hasta el viernes."
--   }
--
-- Cómo correrlo: pgAdmin -> base de producción -> Query Tool ->
-- pegar esto entero -> F5.
-- =====================================================================

SET search_path TO permisos, public;

ALTER TABLE permisos_trabajo
    ADD COLUMN IF NOT EXISTS autorizacion_provisoria JSONB;

COMMENT ON COLUMN permisos_trabajo.autorizacion_provisoria IS 'Autorización de excepción cuando el autorizante titular no puede loguearse: {usuarioId,usuario,nombre,apellido,fechaHora,motivo} o null. El autorizante titular (autorizante_nombre) no cambia.';

-- Verificación
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'permisos' AND table_name = 'permisos_trabajo' AND column_name = 'autorizacion_provisoria';
