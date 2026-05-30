const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const atlasRoutes = require('./routes/atlas');

const app  = express();
const PORT = process.env.PORT || 5001;

const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL, 'http://localhost:5173']
  : ['http://localhost:5173', 'https://localhost:5173'];

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET'],
  credentials: false
}));

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'NeuroAtlas API', version: '1.0.0' });
});

app.use('/api', atlasRoutes);

app.listen(PORT, () => {
  console.log(`\n  NeuroAtlas API v1.0`);
  console.log(`  -------------------`);
  console.log(`  Server:  http://localhost:${PORT}`);
  console.log(`  Source:  Allen Brain Atlas (api.brain-map.org)`);
  console.log(`  Cache:   Ontology 24 h TTL`);
  console.log(`  -------------------\n`);
});
