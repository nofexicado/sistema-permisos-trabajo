require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const authRoutes = require('./src/routes/auth');
const usuariosRoutes = require('./src/routes/usuarios');
const permisosRoutes = require('./src/routes/permisos');
const adjuntosRoutes = require('./src/routes/adjuntos');
const catalogoRoutes = require('./src/routes/catalogo');

const app = express();
const BASE_PATH = process.env.BASE_PATH || '/PDT';
const PORT = process.env.PORT || 4000;

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// --- API ---
app.use(`${BASE_PATH}/api/auth`, authRoutes);
app.use(`${BASE_PATH}/api/usuarios`, usuariosRoutes);
app.use(`${BASE_PATH}/api/permisos/:id/adjuntos`, adjuntosRoutes);
app.use(`${BASE_PATH}/api/permisos`, permisosRoutes);
app.use(`${BASE_PATH}/api/catalogo`, catalogoRoutes);

// --- Frontend estático (index.html, logo.png) ---
app.use(BASE_PATH, express.static(path.join(__dirname, 'public')));

// Manejo de errores de multer (archivo demasiado grande, etc.)
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: `El archivo supera el tamaño máximo permitido (${process.env.MAX_FILE_SIZE_MB || 8}MB).` });
        }
        return res.status(400).json({ error: 'Error al subir el archivo: ' + err.message });
    }
    console.error('Error no manejado:', err);
    res.status(500).json({ error: 'Error interno del servidor.' });
});

app.listen(PORT, () => {
    console.log(`PDT backend escuchando en http://127.0.0.1:${PORT}${BASE_PATH}`);
});
