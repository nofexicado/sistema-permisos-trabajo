-- =====================================================================
-- Sistema de Permisos de Trabajo (PT) - Anexo I
-- Esquema de base de datos para PostgreSQL 18
-- =====================================================================
-- Diseñado para correr dentro de una base de datos NUEVA y separada
-- ("permisos_trabajo", propiedad de "pdt_user") — no toca ni comparte
-- nada con la base del otro proyecto que ya corre en este servidor.
--
-- Cómo ejecutarlo: crear primero la base "permisos_trabajo" y el usuario
-- "pdt_user" desde pgAdmin 4 (ver instrucciones aparte), después con esa
-- base seleccionada abrir el Query Tool, pegar este archivo entero y
-- ejecutarlo (F5). También se puede correr por consola:
--   psql -U pdt_user -d permisos_trabajo -f schema.sql
--
-- Última resincronización contra la base de producción: 2026-09-01,
-- a partir de un pg_dump --schema-only real (Postgres 18.4) de la base
-- en uso, no solo de una consulta a information_schema. Incorpora lo que
-- habían agregado migraciones sueltas que no estaban reflejadas acá:
-- tipos_permiso / tipo_permiso_otro, anexo1 / anexo2 / anexo3, la tabla
-- completa "catalogo_riesgos" (Anexo 1) y la columna "categoria" de
-- permiso_adjuntos. De ahora en más, cada migración nueva se suma
-- también a este archivo en el mismo momento en que se aplica.
--
-- 2026-09-03: sumadas las columnas "revalidaciones" (migración 005,
-- revalidación diaria de asistencia) y "autorizacion_provisoria"
-- (migración 006, autorización de excepción cuando el autorizante
-- titular no puede loguearse) — ver comentarios de columna más abajo.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS permisos;
SET search_path TO permisos, public;

-- Extensión usada por gen_random_uuid() (IDs de las tablas)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================================
-- ENUMS
-- =====================================================================

CREATE TYPE permisos.tipo_permiso AS ENUM (
    'Caliente',
    'Fría',
    'Ingreso a Espacio Confinado',
    'Eléctrica'
);

CREATE TYPE permisos.estado_permiso AS ENUM (
    'Borrador',
    'Autorizado',
    'Cerrado',
    'Suspendido',
    'No Iniciado'
);

CREATE TYPE permisos.zona_riesgo AS ENUM (
    'Riesgo',
    'No Riesgo'
);

CREATE TYPE permisos.rol_usuario AS ENUM (
    'admin',            -- Seguridad e Higiene (control total del sistema)
    'responsable',      -- Producción / Procesos / Mantenimiento y Almacén (acceso total a vistas)
    'operario'          -- Solo puede generar Permisos de Trabajo
);

-- =====================================================================
-- USUARIOS Y ÁREAS
-- =====================================================================

CREATE TABLE permisos.areas (
    id              SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre          TEXT NOT NULL UNIQUE   -- Producción, Mantenimiento y Almacén, Procesos, Seguridad e Higiene
);

INSERT INTO permisos.areas (nombre) VALUES
    ('Producción'),
    ('Mantenimiento y Almacén'),
    ('Procesos'),
    ('Seguridad e Higiene')
ON CONFLICT DO NOTHING;

CREATE TABLE permisos.usuarios (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario         TEXT NOT NULL UNIQUE,      -- login. Ej: Mfigueroa (1ra letra nombre + apellido)
    nombre          TEXT NOT NULL DEFAULT '',
    apellido        TEXT NOT NULL,
    area_id         SMALLINT REFERENCES permisos.areas(id),
    rol             permisos.rol_usuario NOT NULL DEFAULT 'operario',
    cargo           TEXT,                      -- ej: "Responsable de Producción"
    password_hash   TEXT,                      -- NULL hasta que se active login real (bcrypt/pgcrypto crypt())
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usuarios_area ON permisos.usuarios(area_id);
CREATE INDEX idx_usuarios_rol ON permisos.usuarios(rol);

-- Seed inicial según lo relevado en "solicitante no puede terminar como...txt"
-- (usuario = primera letra del nombre + apellido; completar nombres de pila
--  faltantes -- Carrizo, Molina, Sosa, Ríos -- antes de habilitarlos)
INSERT INTO permisos.usuarios (usuario, nombre, apellido, area_id, rol, cargo) VALUES
    ('Jgonzalez',   'Juan',    'González',   (SELECT id FROM permisos.areas WHERE nombre='Seguridad e Higiene'),        'admin',       'Responsable de Seguridad e Higiene'),
    ('Ldominguez',  'Laura',     'Domínguez',  (SELECT id FROM permisos.areas WHERE nombre='Producción'),                 'responsable', 'Responsable de Producción'),
    ('Mfernandez',   'Matías', 'Fernández',   (SELECT id FROM permisos.areas WHERE nombre='Procesos'),                   'responsable', 'Responsable de Procesos'),
    ('Ppaez',   'Pablo',   'Páez',   (SELECT id FROM permisos.areas WHERE nombre='Mantenimiento y Almacén'),    'responsable', 'Responsable de Mantenimiento y Almacén'),
    ('Dcarrizo',   'Diego',     'Carrizo',  (SELECT id FROM permisos.areas WHERE nombre='Producción'),                 'operario',    'Operario de Producción'),
    ('Amolina',  'Alfredo',   'Molina', (SELECT id FROM permisos.areas WHERE nombre='Producción'),                 'operario',    'Operario de Producción'),
    ('Esosa',   'Emiliano',  'Sosa',  (SELECT id FROM permisos.areas WHERE nombre='Producción'),                 'operario',    'Operario de Producción'),
    ('Lrios',   'Leonardo',  'Ríos',  (SELECT id FROM permisos.areas WHERE nombre='Producción'),                 'operario',    'Operario de Producción'),
    ('Fgimenez',    'Fabricio',  'Giménez',    (SELECT id FROM permisos.areas WHERE nombre='Mantenimiento y Almacén'),    'operario',    'Operario de Mantenimiento'),
    ('Cvega',    'Cristian',  'Vega',    (SELECT id FROM permisos.areas WHERE nombre='Mantenimiento y Almacén'),    'operario',    'Operario de Mantenimiento'),
    ('Gcastro',     'Gabriel',   'Castro',     (SELECT id FROM permisos.areas WHERE nombre='Mantenimiento y Almacén'),    'operario',    'Operario de Mantenimiento')
ON CONFLICT (usuario) DO NOTHING;

-- =====================================================================
-- PERMISOS DE TRABAJO
-- =====================================================================
-- Los bloques repetitivos del formulario (aplicación del trabajo,
-- precauciones, condiciones particulares, gases, incendio/EPP, cierre)
-- se guardan en columnas JSONB: son formularios de checklist que
-- cambian poco pero cuya forma interna puede evolucionar sin migrar
-- la tabla. Los campos que sí necesitan filtrarse/reportarse (estado,
-- tipo, fechas, responsables) quedan como columnas propias.

-- Secuencia para generar el código visible del permiso (PT-<año>-<0001>).
-- La usa el backend al crear un permiso nuevo.
CREATE SEQUENCE IF NOT EXISTS permisos.permiso_codigo_seq START 1;

CREATE TABLE permisos.permisos_trabajo (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo              TEXT NOT NULL UNIQUE,          -- PT-xxxx visible al usuario

    -- tipo_permiso (singular) queda como columna legacy, ya sin uso real:
    -- el formulario pasó a permitir más de un tipo por permiso, así que
    -- lo vigente es tipos_permiso (JSONB, array) + tipo_permiso_otro más abajo.
    tipo_permiso        permisos.tipo_permiso,
    tipos_permiso       JSONB NOT NULL DEFAULT '[]'::jsonb,   -- array de tipos seleccionados (reemplaza a tipo_permiso)
    tipo_permiso_otro   TEXT,                                  -- texto libre cuando se elige "Otro" en tipos_permiso
    estado              permisos.estado_permiso NOT NULL DEFAULT 'Borrador',
    zona_riesgo         permisos.zona_riesgo NOT NULL DEFAULT 'Riesgo',

    fecha_inicio        DATE NOT NULL,
    hora_inicio         TIME NOT NULL,
    hora_fin            TIME NOT NULL,
    fecha_fin_tarea      DATE,                          -- máx. 14 días desde fecha_inicio (constraint abajo)

    un_tof              TEXT,
    lugar               TEXT,
    equipo              TEXT,
    descripcion_trabajo TEXT,

    -- Aplicación del trabajo / documentación adicional (esquema, procedimientos, P&ID, PCR)
    aplicacion          JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Precauciones 2.1 (array de 20 respuestas SI/NO/NA)
    precauciones        JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Condiciones particulares 2.2 (altura, confinado, electrica, excavacion)
    condiciones         JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Medición de gases 2.3
    gases               JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Incendio y EPP
    incendio            JSONB NOT NULL DEFAULT '{}'::jsonb,
    epp                 JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Responsables (se guarda nombre + referencia a usuario cuando aplica,
    -- porque solicitante/ejecutante pueden ser contratistas sin usuario del sistema)
    solicitante_nombre      TEXT NOT NULL,
    solicitante_dni         TEXT,
    solicitante_visito      BOOLEAN DEFAULT FALSE,

    ejecutante_nombre       TEXT,
    ejecutante_dni          TEXT,
    ejecutante_visito       BOOLEAN DEFAULT FALSE,

    autorizante_usuario_id  UUID REFERENCES permisos.usuarios(id),  -- debe ser un usuario con rol admin/responsable
    autorizante_nombre      TEXT,
    autorizante_dni         TEXT,

    -- Cierre del trabajo
    cierre              JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Anexos digitales (cada uno es un formulario propio, guardado como JSONB
    -- para poder evolucionar su forma interna sin migrar la tabla):
    anexo1              JSONB NOT NULL DEFAULT '[]'::jsonb,   -- Anexo I · items adicionales (array)
    anexo2              JSONB NOT NULL DEFAULT '{}'::jsonb,   -- Anexo II · Aislamiento de Energías
    anexo3              JSONB NOT NULL DEFAULT '{}'::jsonb,   -- Anexo III · Plan de Izaje

    -- Revalidación diaria de asistencia (permisos Autorizados de varios
    -- días): array de {id, fecha, trabajadores:[{nombre,apellido}],
    -- aprobado:null|{usuarioId,usuario,nombre,apellido,fechaHora}}.
    revalidaciones      JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Autorización de excepción: cuando el autorizante titular no puede
    -- loguearse (licencia, enfermedad, etc.), otro admin/responsable puede
    -- autorizar el permiso "provisoriamente" para no frenar a los
    -- ejecutantes. Queda registrado quién lo hizo y por qué, sin perder de
    -- vista quién era el autorizante titular (autorizante_nombre no cambia).
    -- null cuando el permiso nunca tuvo una autorización provisoria.
    autorizacion_provisoria JSONB,

    creado_por_id       UUID REFERENCES permisos.usuarios(id),
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Regla: fin de tarea no puede superar 14 días desde el inicio
    CONSTRAINT chk_fecha_fin_tarea CHECK (
        fecha_fin_tarea IS NULL OR fecha_fin_tarea <= fecha_inicio + INTERVAL '14 days'
    ),
    -- Regla: el autorizante no puede ser el solicitante ni el ejecutante (self-approval)
    CONSTRAINT chk_autorizante_distinto CHECK (
        autorizante_nombre IS NULL
        OR (
            lower(trim(autorizante_nombre)) IS DISTINCT FROM lower(trim(solicitante_nombre))
            AND lower(trim(autorizante_nombre)) IS DISTINCT FROM lower(trim(ejecutante_nombre))
        )
    )
);

COMMENT ON COLUMN permisos.permisos_trabajo.tipo_permiso IS 'OBSOLETO desde la migración 002. Se conserva solo por compatibilidad con datos históricos. Usar tipos_permiso.';
COMMENT ON COLUMN permisos.permisos_trabajo.tipos_permiso IS 'Lista de tipos de permiso seleccionados (selección múltiple). Ej: ["Trabajo en Caliente","Trabajo Eléctrico"]';
COMMENT ON COLUMN permisos.permisos_trabajo.tipo_permiso_otro IS 'Texto libre cuando "Otro" está incluido en tipos_permiso.';
COMMENT ON COLUMN permisos.permisos_trabajo.anexo1 IS 'Anexo 1 · Matriz de Riesgos (ATS/PCR): array de filas {catalogId, categoria, actividad, peligro, riesgo, nivel, medidas, epp, observaciones}.';
COMMENT ON COLUMN permisos.permisos_trabajo.anexo2 IS 'Anexo 2 · Habilitación de Aislamiento de Energías Peligrosas (LOTO): objeto con los campos digitalizados de la planilla.';
COMMENT ON COLUMN permisos.permisos_trabajo.revalidaciones IS 'Revalidación diaria de asistencia de un permiso Autorizado: array de {id, fecha, trabajadores:[{nombre,apellido}], aprobado:null|{usuarioId,usuario,nombre,apellido,fechaHora}}.';
COMMENT ON COLUMN permisos.permisos_trabajo.autorizacion_provisoria IS 'Autorización de excepción cuando el autorizante titular no puede loguearse: {usuarioId,usuario,nombre,apellido,fechaHora,motivo} o null. El autorizante titular (autorizante_nombre) no cambia.';

CREATE INDEX idx_permisos_estado ON permisos.permisos_trabajo(estado);
CREATE INDEX idx_permisos_tipo ON permisos.permisos_trabajo(tipo_permiso);
CREATE INDEX idx_permisos_fecha ON permisos.permisos_trabajo(fecha_inicio);
CREATE INDEX idx_permisos_creado_por ON permisos.permisos_trabajo(creado_por_id);

-- Solo se puede borrar un permiso si está en Borrador.
-- (La regla también se aplica en el frontend, pero se refuerza acá
--  a nivel de base de datos por si se borra desde otro cliente/admin.)
CREATE OR REPLACE FUNCTION permisos.fn_bloquear_borrado_no_borrador()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.estado <> 'Borrador' THEN
        RAISE EXCEPTION 'Solo se pueden eliminar permisos en estado Borrador (permiso % está en %)', OLD.codigo, OLD.estado;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bloquear_borrado_no_borrador
    BEFORE DELETE ON permisos.permisos_trabajo
    FOR EACH ROW EXECUTE FUNCTION permisos.fn_bloquear_borrado_no_borrador();

CREATE OR REPLACE FUNCTION permisos.fn_actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_permisos_actualizado_en
    BEFORE UPDATE ON permisos.permisos_trabajo
    FOR EACH ROW EXECUTE FUNCTION permisos.fn_actualizar_timestamp();

-- =====================================================================
-- ARCHIVOS ADJUNTOS
-- =====================================================================
-- En el servidor conviene guardar los archivos en disco (o un bucket) y
-- persistir acá solo la referencia (ruta_archivo). El campo "contenido"
-- queda opcional por si en algún momento se prefiere guardarlos
-- directamente en la base (no recomendado para archivos grandes).

CREATE TABLE permisos.permiso_adjuntos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    permiso_id      UUID NOT NULL REFERENCES permisos.permisos_trabajo(id) ON DELETE CASCADE,
    nombre_archivo  TEXT NOT NULL,
    tipo_mime       TEXT,
    tamano_bytes    BIGINT,
    ruta_archivo    TEXT,                -- ruta en disco/servidor (preferido)
    contenido       BYTEA,               -- opcional, solo si no se usa almacenamiento en disco
    subido_por_id   UUID REFERENCES permisos.usuarios(id),
    subido_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    categoria       VARCHAR(30)          -- NULL = adjunto genérico; 'gases' = planilla de medición de gases (2.3)
);

CREATE INDEX idx_adjuntos_permiso ON permisos.permiso_adjuntos(permiso_id);
COMMENT ON COLUMN permisos.permiso_adjuntos.categoria IS 'NULL = adjunto genérico (Aplicación del Trabajo). ''gases'' = planilla de medición de gases (sección 2.3).';

-- =====================================================================
-- AUDITORÍA (trazabilidad de cambios de estado, requerido en seguridad)
-- =====================================================================

CREATE TABLE permisos.permiso_historial (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    permiso_id      UUID NOT NULL REFERENCES permisos.permisos_trabajo(id) ON DELETE CASCADE,
    usuario_id      UUID REFERENCES permisos.usuarios(id),
    accion          TEXT NOT NULL,        -- 'creado', 'editado', 'autorizado', 'cerrado', 'suspendido', 'eliminado'
    estado_anterior permisos.estado_permiso,
    estado_nuevo    permisos.estado_permiso,
    detalle         JSONB,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_historial_permiso ON permisos.permiso_historial(permiso_id);

-- =====================================================================
-- SESIONES (opcional — el backend actual usa JWT sin estado en una cookie
-- httpOnly, así que no la necesita para funcionar. Se deja creada por si
-- más adelante se quiere poder "cerrar sesión en todos los dispositivos"
-- o loguear inicios de sesión; no se usa por ahora.)
-- =====================================================================

CREATE TABLE permisos.sesiones (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id      UUID NOT NULL REFERENCES permisos.usuarios(id),
    token           TEXT NOT NULL UNIQUE,
    ip_origen       INET,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expira_en       TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_sesiones_usuario ON permisos.sesiones(usuario_id);
CREATE INDEX idx_sesiones_token ON permisos.sesiones(token);

-- =====================================================================
-- CATÁLOGO DE RIESGOS (usado por el Anexo 1 · Matriz de Riesgos)
-- =====================================================================
-- Administrado solo por Seguridad e Higiene (rol admin) desde la vista
-- "Catálogo de Riesgos" del frontend (src/routes/catalogo.js). Al armar
-- el Anexo 1 de un permiso, el operario elige filas de acá y el permiso
-- guarda una COPIA de los datos (no una referencia) en su propio anexo1 —
-- por eso desactivar o borrar una entrada del catálogo no afecta permisos
-- ya guardados. Por defecto los endpoints de lectura solo traen las
-- entradas con activo = true.

CREATE TABLE permisos.catalogo_riesgos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    categoria       TEXT NOT NULL,
    actividad       TEXT NOT NULL,
    peligro         TEXT NOT NULL,
    riesgo          TEXT NOT NULL,
    nivel           TEXT NOT NULL,
    medidas         TEXT NOT NULL DEFAULT '',
    epp             TEXT NOT NULL DEFAULT '',
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    creado_por_id   UUID REFERENCES permisos.usuarios(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT catalogo_riesgos_nivel_check CHECK (nivel IN ('Alto', 'Moderado', 'Bajo'))
);

CREATE INDEX idx_catalogo_riesgos_categoria ON permisos.catalogo_riesgos(categoria);
CREATE INDEX idx_catalogo_riesgos_activo ON permisos.catalogo_riesgos(activo);

CREATE TRIGGER trg_catalogo_riesgos_actualizado_en
    BEFORE UPDATE ON permisos.catalogo_riesgos
    FOR EACH ROW EXECUTE FUNCTION permisos.fn_actualizar_timestamp();

-- =====================================================================
-- NOTAS
-- =====================================================================
-- 1. Se ejecuta contra una base de datos NUEVA y separada ("permisos_trabajo",
--    propiedad de "pdt_user") — no toca ni comparte nada con la base del
--    otro proyecto que ya corre en este mismo servidor PostgreSQL.
-- 2. El login real ya está implementado en el backend (pdt-backend):
--    password_hash se genera con bcryptjs (equivalente a crypt(...,
--    gen_salt('bf')) de pgcrypto) desde Node, no hace falta tocarlo a mano
--    en SQL. Correr "npm run set-passwords" en el backend genera las
--    contraseñas iniciales de los 11 usuarios (ver scripts/set-passwords.js).
-- 3. Completar nombres de pila faltantes (Carrizo, Molina, Sosa,
--    Ríos) antes de generarles su contraseña inicial — el script de
--    passwords los va a saltear si nombre está vacío.
-- 4. Los adjuntos se guardan en disco del servidor (carpeta UPLOADS_DIR del
--    backend) y acá solo queda la referencia en "ruta_archivo". Definir
--    con backups del servidor si esa carpeta se incluye en el respaldo.
-- 5. Este archivo se resincronizó el 2026-09-01 contra un pg_dump --schema-only
--    real de producción (no reconstruido a mano), así que además de los
--    anexos también se sumaron: la columna "categoria" de permiso_adjuntos
--    y la tabla completa "catalogo_riesgos". Si en algún momento se
--    sospecha que este archivo volvió a desincronizarse, repetir ese
--    mismo pg_dump --schema-only es más confiable que reconstruirlo
--    consultando tabla por tabla.
