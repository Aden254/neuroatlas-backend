const express = require('express');
const axios   = require('axios');
const router  = express.Router();

const ALLEN = 'https://api.brain-map.org/api/v2';

// Ontology is large (~900 structures) and rarely changes — cache 24 h
const ontologyCache = new Map(); // key → { data, ts }
const ONTOLOGY_TTL  = 24 * 60 * 60 * 1000;

// Mouse uses ISH imaging; human uses microarray expression datasets
const SPECIES = {
  mouse: { product: 'Mouse',       graphId: 1  },
  human: { product: 'DevHumanISH', graphId: 16 },
};

async function allen(url) {
  const res = await axios.get(url, {
    timeout: 15000,
    headers: { 'User-Agent': 'NeuroAtlas/1.0 (portfolio project)' },
  });
  return res.data;
}

// Sanitise user-supplied gene strings so they can't inject RMA syntax
function sanitiseGene(raw) {
  return String(raw).replace(/[^a-zA-Z0-9\-]/g, '').slice(0, 20);
}

// ─── Gene search ─────────────────────────────────────────────────────────────
// GET /api/genes?q=BDNF
// Searches Allen gene table by acronym (case-insensitive prefix/contains match).
router.get('/genes', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters' });
  }

  const safe = sanitiseGene(q);
  const url  = `${ALLEN}/data/query.json?criteria=model::Gene,rma::criteria,` +
               `[acronym$il'*${safe}*'],rma::options[num_rows$eq15][order$eq'genes.acronym']`;

  try {
    const data = await allen(url);
    res.json({ genes: data.msg || [] });
  } catch (err) {
    console.error('[genes]', err.message);
    res.status(502).json({ error: 'Allen API unreachable' });
  }
});

// ─── Experiments (SectionDataSets) for a gene ────────────────────────────────
// GET /api/experiments?gene=BDNF&species=mouse|human
// Returns up to 5 expression experiments (datasets) for the given gene.
router.get('/experiments', async (req, res) => {
  const gene    = sanitiseGene(req.query.gene || '');
  const species = req.query.species === 'human' ? 'human' : 'mouse';

  if (!gene) return res.status(400).json({ error: 'gene parameter required' });

  const { product } = SPECIES[species];
  // $il = case-insensitive like — matches 'Bdnf' (mouse) and 'BDNF' (human) from the same query
  const url = `${ALLEN}/data/SectionDataSet/query.json?` +
              `criteria=[failed$eqfalse],genes[acronym$il'${gene}'],` +
              `products[abbreviation$eq'${product}']&include=genes&num_rows=5`;

  try {
    const data = await allen(url);
    res.json({ experiments: data.msg || [] });
  } catch (err) {
    console.error('[experiments]', err.message);
    res.status(502).json({ error: 'Allen API unreachable' });
  }
});

// ─── Section images for a dataset ────────────────────────────────────────────
// GET /api/images/:datasetId?num_rows=20
// Returns section image metadata; the frontend constructs image URLs from the IDs.
// Image URL pattern: https://api.brain-map.org/api/v2/image_download/{id}?downsample=4
router.get('/images/:datasetId', async (req, res) => {
  const { datasetId } = req.params;
  const numRows = Math.min(parseInt(req.query.num_rows) || 20, 40);

  if (!/^\d+$/.test(datasetId)) {
    return res.status(400).json({ error: 'Invalid datasetId' });
  }

  const url = `${ALLEN}/data/SectionImage/query.json?` +
              `criteria=[data_set_id$eq${datasetId}]&num_rows=${numRows}`;

  try {
    const data = await allen(url);
    res.json({ images: data.msg || [] });
  } catch (err) {
    console.error('[images]', err.message);
    res.status(502).json({ error: 'Allen API unreachable' });
  }
});

// ─── Per-structure expression for a dataset ───────────────────────────────────
// GET /api/expression/:datasetId
// Returns StructureUnionize rows — one per brain structure — sorted by expression
// energy descending. Used to paint the human 3D heatmap and the ranking panel.
router.get('/expression/:datasetId', async (req, res) => {
  const { datasetId } = req.params;

  if (!/^\d+$/.test(datasetId)) {
    return res.status(400).json({ error: 'Invalid datasetId' });
  }

  const url = `${ALLEN}/data/StructureUnionize/query.json?` +
              `criteria=[section_data_set_id$eq${datasetId}]&include=structure&num_rows=150`;

  try {
    const data = await allen(url);
    res.json({ expression: data.msg || [] });
  } catch (err) {
    console.error('[expression]', err.message);
    res.status(502).json({ error: 'Allen API unreachable' });
  }
});

// ─── Brain structure ontology ─────────────────────────────────────────────────
// GET /api/ontology/:species   (species = mouse | human)
// Returns the full nested structure tree for the given species.
// Response is cached 24 h — the tree is ~900 nodes and almost never changes.
router.get('/ontology/:species', async (req, res) => {
  const species = req.params.species === 'human' ? 'human' : 'mouse';
  const key     = `ontology_${species}`;
  const cached  = ontologyCache.get(key);

  if (cached && Date.now() - cached.ts < ONTOLOGY_TTL) {
    return res.json(cached.data);
  }

  const { graphId } = SPECIES[species];
  // Returns flat list; frontend uses parent_structure_id to build the tree
  const url = `${ALLEN}/data/Structure/query.json?criteria=[graph_id$eq${graphId}]&num_rows=2000`;

  try {
    const data   = await allen(url);
    const result = { ontology: data.msg || [] };
    ontologyCache.set(key, { data: result, ts: Date.now() });
    res.json(result);
  } catch (err) {
    console.error('[ontology]', err.message);
    res.status(502).json({ error: 'Allen API unreachable' });
  }
});

module.exports = router;
