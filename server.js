const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3050);
const NIGHTSCOUT_URL = (process.env.NIGHTSCOUT_URL || '').replace(/\/$/, '');
const API_SECRET = process.env.API_SECRET || '';
const DATA_DIR = path.join(__dirname, 'data');
const TREATMENTS_FILE = path.join(DATA_DIR, 'treatments.json');

app.use(express.json({ limit: '1mb' }));
app.use('/dane', express.static(path.join(__dirname, 'public')));
app.get('/dane', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (req, res) => res.json({ ok: true, platform: 'android-termux', nightscoutConfigured: Boolean(NIGHTSCOUT_URL) }));

function readLocalTreatments() {
  try { return JSON.parse(fs.readFileSync(TREATMENTS_FILE, 'utf8')); }
  catch { return []; }
}
function writeLocalTreatments(rows) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = TREATMENTS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
  fs.renameSync(tmp, TREATMENTS_FILE);
}
function nsHeaders() {
  if (!API_SECRET) return {};
  return { 'api-secret': crypto.createHash('sha1').update(API_SECRET).digest('hex') };
}
async function nsGet(endpoint, params = {}) {
  if (!NIGHTSCOUT_URL) throw new Error('Brak NIGHTSCOUT_URL w pliku .env');
  const url = NIGHTSCOUT_URL + endpoint;
  const response = await axios.get(url, { headers: nsHeaders(), params, timeout: 20000 });
  return response.data;
}
function toMs(t) {
  if (Number.isFinite(Number(t.timestamp))) return Number(t.timestamp);
  const d = Date.parse(t.created_at || t.date || '');
  return Number.isFinite(d) ? d : 0;
}
function normalizeTreatment(t) {
  const timestamp = toMs(t);
  return {
    ...t,
    timestamp,
    insulin: Number(String(t.insulin ?? t.insulinUnits ?? 0).replace(',', '.')) || 0,
    carbs: Number(String(t.carbs ?? t.carbs_g ?? 0).replace(',', '.')) || 0
  };
}

app.get('/dane/api/data', async (req, res) => {
  try {
    const hours = Math.min(2160, Math.max(1, Number.parseInt(req.query.hours, 10) || 72));
    const entriesRaw = await nsGet('/api/v1/entries/sgv.json', { count: Math.min(26000, Math.ceil(hours * 12) + 30) });
    const now = Date.now();
    const cutoff = now - hours * 3600000;
    const entries = (Array.isArray(entriesRaw) ? entriesRaw : [])
      .map(e => ({ ...e, date: Number(e.date || Date.parse(e.dateString || e.sysTime || '')), sgv: Number(e.sgv) }))
      .filter(e => e.date >= cutoff && Number.isFinite(e.sgv))
      .sort((a,b) => a.date - b.date);
    let nsTreatments = [];
    try {
      const raw = await nsGet('/api/v1/treatments.json', { count: 5000 });
      nsTreatments = (Array.isArray(raw) ? raw : []).map(normalizeTreatment)
        .filter(t => t.timestamp >= cutoff && (t.insulin > 0 || t.carbs > 0));
    } catch (e) { console.warn('Nightscout treatments:', e.message); }
    const local = readLocalTreatments().map(normalizeTreatment).filter(t => t.timestamp >= cutoff);
    const treatments = [...nsTreatments, ...local].sort((a,b) => a.timestamp - b.timestamp);
    res.json({ entries, treatments, latest: entries[entries.length - 1] || {} });
  } catch (err) {
    res.status(502).json({ error: 'Nie można pobrać danych z Nightscout', details: err.message });
  }
});

app.get('/dane/api/treemap', async (req, res) => {
  try {
    const raw = await nsGet('/api/v1/treatments.json', { count: 5000 });
    const cutoff = Date.now() - 90 * 86400000;
    const treatments = (Array.isArray(raw) ? raw : []).map(normalizeTreatment)
      .filter(t => t.timestamp >= cutoff && t.insulin > 0);
    res.json({ treatments });
  } catch (err) {
    const treatments = readLocalTreatments().map(normalizeTreatment)
      .filter(t => t.timestamp >= Date.now() - 90 * 86400000 && t.insulin > 0);
    res.json({ treatments });
  }
});

app.post('/dane/api/treatments', (req, res) => {
  const insulin = Number(String(req.body.insulin ?? '').replace(',', '.')) || 0;
  const carbs = Number(String(req.body.carbs ?? '').replace(',', '.')) || 0;
  if (insulin <= 0 && carbs <= 0) return res.status(400).json({ error: 'Podaj insulinę lub węglowodany.' });
  const timestamp = Number(req.body.timestamp) || Date.now();
  const rows = readLocalTreatments();
  const doc = { _id: crypto.randomUUID(), timestamp, created_at: new Date(timestamp).toISOString(),
    eventType: 'Manual Entry', insulin, carbs, enteredBy: 'xdrip-cgm-android', source: 'local' };
  rows.push(doc);
  writeLocalTreatments(rows);
  res.json({ success: true, doc });
});

app.delete('/dane/api/treatments/:ts', (req, res) => {
  const timestamp = Number(req.params.ts);
  if (!Number.isFinite(timestamp)) return res.status(400).json({ error: 'Nieprawidłowy timestamp.' });
  const rows = readLocalTreatments();
  const index = rows.findIndex(t => Number(t.timestamp) === timestamp);
  if (index < 0) return res.status(404).json({ error: 'Można usuwać tylko lokalne wpisy ręczne; wpis Nightscout pozostaje nietknięty.' });
  rows.splice(index, 1);
  writeLocalTreatments(rows);
  res.json({ success: true });
});

app.listen(PORT, '127.0.0.1', () => console.log('xDrip CGM Android działa: http://127.0.0.1:' + PORT + '/dane'));
