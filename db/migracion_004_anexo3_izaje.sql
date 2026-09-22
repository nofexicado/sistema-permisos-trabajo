-- =====================================================================
-- Migración 004: agrega el Anexo 3 · Plan de Izaje
-- =====================================================================
-- Igual que anexo1/anexo2, se guarda como una sola columna JSONB en
-- permisos_trabajo — no hace falta tocar nada más del esquema.
--
-- Cómo correrlo: pgAdmin -> base "permisos_trabajo" -> Query Tool ->
-- pegar esto entero -> F5.
-- =====================================================================

SET search_path TO permisos, public;

ALTER TABLE permisos_trabajo
    ADD COLUMN IF NOT EXISTS anexo3 JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Verificación
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'permisos' AND table_name = 'permisos_trabajo' AND column_name LIKE 'anexo%';
