// Titik masuk Vercel (serverless function). Semua jalur dinamis (/pasar/..., /api/...) dialihkan ke sini
// oleh vercel.json. File statis di folder public/ dilayani langsung oleh Vercel.
const { createGameApp } = require('../server.js');

let app;
module.exports = (req, res) => (app ||= createGameApp())(req, res);
