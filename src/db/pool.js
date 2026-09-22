const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'permisos_trabajo',
    user: process.env.DB_USER || 'pdt_user',
    password: process.env.DB_PASSWORD,
    max: 10,
    idleTimeoutMillis: 30000,
    // Fija el search_path como parámetro de arranque de la conexión (no una
    // query aparte) para que quede aplicado ANTES de que el pool entregue el
    // cliente a la app — evita la carrera de "primera consulta corre antes
    // del SET search_path" que se daba con pool.on('connect', ...).
    options: '-c search_path=permisos,public',
});

pool.on('error', (err) => {
    // Un cliente inactivo del pool tiró un error inesperado (conexión caída, etc.)
    console.error('Error inesperado en el pool de PostgreSQL:', err);
});

module.exports = pool;
