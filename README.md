# Sistema de Gestión de Permisos de Trabajo (PDT)

Aplicación web para digitalizar el circuito de **permisos de trabajo** (Anexo I) que usan
las áreas de Seguridad e Higiene en entornos industriales de riesgo: trabajo en altura,
espacios confinados, trabajos eléctricos, excavación, izaje de cargas y aislamiento de
energías peligrosas.

> Versión generalizada y con datos de ejemplo de un sistema que diseñé y desarrollé para
> el área de Seguridad e Higiene de una empresa industrial, donde está en producción
> desde 2026 gestionando el circuito real de permisos de trabajo.

## Qué resuelve

- Reemplaza el circuito en papel/Excel por un formulario digital con checklist dinámico
  por tipo de tarea (Anexo I / II / III), firmas, adjuntos y estado (borrador, vigente,
  cerrado, revalidado).
- Aplica reglas de negocio del propio procedimiento de seguridad, no solo validaciones de
  formulario:
  - el **Autorizante no puede ser la misma persona que el Solicitante o el Ejecutante**
    (nadie autoaprueba su propio permiso) — validado en el formulario y con un
    `CHECK constraint` en la base;
  - un permiso no puede quedar abierto más de 14 días desde su fecha de inicio;
  - solo se pueden eliminar permisos en estado "Borrador" (UI + trigger en la base);
  - historial de auditoría de cada cambio de estado.
- Control de acceso por rol: personal con acceso total al registro completo de permisos
  vs. personal que solo puede generar/ver los suyos.
- Pensado para usarse tanto desde PC como desde el celular en planta (diseño responsive
  con foco explícito en mobile).

## Stack

- **Backend:** Node.js + Express, PostgreSQL (JSONB para los checklists dinámicos de cada
  tipo de permiso), JWT en cookies httpOnly, bcrypt para contraseñas.
- **Frontend:** Vue 3 + Tailwind CSS, single-page, sin build step.
- **Despliegue de referencia:** Windows Server + nginx como reverse proxy + PM2.

## Estructura

```
server.js                 Punto de entrada Express
src/routes/                Endpoints (auth, permisos, usuarios, adjuntos, catálogo)
src/middleware/auth.js     Verificación de JWT / control de rol
src/mappers/permit.js      Mapeo entre el JSON del formulario y las columnas JSONB
src/db/pool.js             Pool de conexión a PostgreSQL
db/schema.sql              Esquema completo + seed de usuarios de ejemplo
db/migracion_*.sql         Migraciones incrementales aplicadas sobre el esquema base
public/index.html          Frontend (Vue 3 + Tailwind, un solo archivo)
scripts/                   Utilidades de administración (alta de contraseñas, reset)
```

## Correrlo localmente

Requisitos: Node.js 18+, PostgreSQL 14+.

```bash
npm install

# 1. Crear la base y el usuario de la app (ejemplo con psql)
createdb permisos_trabajo
psql -d permisos_trabajo -c "CREATE USER pdt_user WITH PASSWORD 'cambiar_esto';"

# 2. Cargar el esquema (incluye usuarios de ejemplo)
psql -U pdt_user -d permisos_trabajo -f db/schema.sql

# 3. Configurar variables de entorno
cp .env.example .env
# completar DB_*, JWT_SECRET, etc.

# 4. Generar contraseñas para los usuarios de ejemplo (se muestran una sola vez en consola)
npm run set-passwords

# 5. Levantar el servidor
npm start
```

La app queda disponible en `http://localhost:4000` (o el `BASE_PATH` configurado).
Los usuarios de ejemplo cargados por `schema.sql` usan la convención
`primera letra del nombre + apellido` (ej. `Jgonzalez`), pensada para que el área de
Seguridad e Higiene pueda dar de alta gente sin fricción.

## Nota sobre este repositorio

Este repo es una versión saneada del proyecto original para portfolio: nombre de
empresa, logo, personal y referencias a clientes/normativa interna fueron reemplazados
por datos de ejemplo. La lógica, el esquema de base de datos y las reglas de negocio son
las mismas que corren en producción.

---
Diseñado y desarrollado por Mauricio Figueroa.
