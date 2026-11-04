'use strict';
require('dotenv').config();

const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3050);
const HOST = process.env.HOST || '127.0.0.1';
const URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || 'nightscout';
const MANUAL_TAG = 'xdrip-monitor-ns:manual';

if (!URI) {
  console.error('FATAL: Brak MONGODB_URI w pliku .env');
  process.exit(1);
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('FATAL: Nieprawidłowy PORT:', process.env.PORT);
  process.exit(1);
}

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

let client;
let db;
let httpServer;

function millis(doc) {
  const ts = Number(doc.timestamp);
  if (Number.isFinite(ts) && ts > 0) return ts;
  const parsed = Date.parse(doc.created_at || '');
  return Number.isFinite(parsed) ? parsed : null;
}
function num(value) {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

// Deduplikacja jest wyłącznie w odpowiedzi API. Nie zmienia dokumentów MongoDB.
function normalizeTreatments(docs) {
  const rows = docs.map(doc => ({
    id: String(doc._id),
    timestamp: millis(doc),
    insulin: num(doc.insulin ?? doc.insulinUnits),
    carbs: num(doc.carbs ?? doc.carbs_g),
    eventType: doc.eventType || '',
    notes: doc.notes || ''
  })).filter(t => t.timestamp !== null && (t.insulin > 0 || t.carbs > 0));

  const skipped = new Set();
  const result = [];
  for (const row of rows) {
    if (skipped.has(row.id)) continue;
    const isLibre = row.notes.includes('LibreView CSV import');
    const isRecovered = row.eventType === 'Bolus (Odzyskany)';

    if (isLibre && row.insulin > 0) {
      const duplicate = rows.find(other =>
        other.id !== row.id && !skipped.has(other.id) &&
        other.eventType === 'Bolus (Odzyskany)' &&
        other.timestamp === row.timestamp &&
        other.insulin === row.insulin && other.carbs === row.carbs
      );
      if (duplicate) skipped.add(duplicate.id);
    } else if (isRecovered && row.insulin > 0) {
      const duplicate = rows.find(other =>
        other.id !== row.id && !skipped.has(other.id) &&
        other.notes.includes('LibreView CSV import') &&
        other.timestamp === row.timestamp &&
        other.insulin === row.insulin && other.carbs === row.carbs
      );
      if (duplicate) continue;
    }
    result.push(row);
  }
  return result.sort((a, b) => a.timestamp - b.timestamp);
}
function requireDb(res) {
  if (db) return true;
  res.status(503).json({ error: 'Połączenie z bazą Nightscout nie jest gotowe.' });
  return false;
}

app.get('/health', (req, res) => res.status(db ? 200 : 503).json({
  ok: Boolean(db),
  service: 'cgm-unified-monitor',
  database: DB_NAME
}));

app.get('/dane', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);
app.use('/dane', express.static(path.join(__dirname, 'public')));

app.get('/dane/api/data', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const latest = await db.collection('entries').find({
      type: 'sgv',
      date: { $type: 'number' },
      sgv: { $type: 'number' }
    }).sort({ date: -1 }).limit(1).next();

    if (!latest) return res.json({ entries: [], treatments: [], latest: {} });

    const parsedHours = Number.parseInt(req.query.hours, 10);
    const hours = Number.isFinite(parsedHours)
      ? Math.min(Math.max(parsedHours, 1), 8760)
      : 72;
    const cutoff = latest.date - hours * 3600000;

    const [entries, rawTreatments] = await Promise.all([
      db.collection('entries').find({
        type: 'sgv',
        date: { $gte: cutoff, $lte: latest.date },
        sgv: { $type: 'number' }
      }).sort({ date: 1 }).toArray(),
      db.collection('treatments').find({
        $or: [
          { timestamp: { $gte: cutoff } },
          { created_at: { $gte: new Date(cutoff).toISOString() } }
        ]
      }).toArray()
    ]);

    const treatments = normalizeTreatments(rawTreatments)
      .filter(t => t.timestamp >= cutoff && t.timestamp <= latest.date)
      .map(({ id, timestamp, insulin, carbs }) => ({ id, timestamp, insulin, carbs }));

    res.json({ entries, treatments, latest });
  } catch (err) {
    console.error('GET /dane/api/data:', err);
    res.status(500).json({ error: 'Nie udało się pobrać danych Nightscout.' });
  }
});

app.get('/dane/api/treemap', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const cutoff = Date.now() - 90 * 86400000;
    const raw = await db.collection('treatments').find({
      insulin: { $gt: 0 },
      $or: [
        { timestamp: { $gte: cutoff } },
        { created_at: { $gte: new Date(cutoff).toISOString() } }
      ]
    }).toArray();

    const treatments = normalizeTreatments(raw)
      .filter(t => t.timestamp >= cutoff && t.insulin > 0)
      .map(t => ({ timestamp: t.timestamp, insulin: t.insulin }));

    res.json({ treatments });
  } catch (err) {
    console.error('GET /dane/api/treemap:', err);
    res.status(500).json({ error: 'Nie udało się pobrać danych TreeMap.' });
  }
});

app.post('/dane/api/treatments', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const insulin = num(req.body.insulin);
    const carbs = num(req.body.carbs);
    const timestamp = Number(req.body.timestamp || Date.now());

    if (insulin < 0 || carbs < 0 || (!insulin && !carbs))
      return res.status(400).json({ error: 'Podaj prawidłową insulinę lub węglowodany.' });
    if (!Number.isFinite(timestamp) || timestamp <= 0)
      return res.status(400).json({ error: 'Nieprawidłowy czas wpisu.' });

    const doc = {
      created_at: new Date(timestamp).toISOString(),
      eventType: insulin && carbs ? 'Meal Bolus' : insulin ? 'Correction Bolus' : 'Carb Correction',
      notes: MANUAL_TAG,
      enteredBy: 'cgm-unified-monitor',
      utcOffset: -new Date(timestamp).getTimezoneOffset()
    };
    if (insulin) {
      doc.insulin = insulin;
      doc.insulinType = 'fast';
    }
    if (carbs) doc.carbs = carbs;

    const inserted = await db.collection('treatments').insertOne(doc);
    res.json({
      success: true,
      doc: { id: String(inserted.insertedId), timestamp, insulin, carbs }
    });
  } catch (err) {
    console.error('POST /dane/api/treatments:', err);
    res.status(500).json({ error: 'Nie udało się zapisać wpisu w Nightscout.' });
  }
});

app.delete('/dane/api/treatments/:id', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    if (!ObjectId.isValid(req.params.id))
      return res.status(400).json({ error: 'Nieprawidłowy identyfikator wpisu.' });

    const deleted = await db.collection('treatments').deleteOne({
      _id: new ObjectId(req.params.id),
      notes: MANUAL_TAG
    });

    if (!deleted.deletedCount)
      return res.status(404).json({ error: 'Można usuwać tylko ręczne wpisy tego monitora.' });

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /dane/api/treatments:', err);
    res.status(500).json({ error: 'Nie udało się usunąć wpisu.' });
  }
});

async function start() {
  client = new MongoClient(URI, {
    maxPoolSize: 15,
    serverSelectionTimeoutMS: 10000
  });
  await client.connect();
  db = client.db(DB_NAME);
  await db.command({ ping: 1 });

  httpServer = app.listen(PORT, HOST, () => {
    console.log('CGM Unified Monitor działa: http://' + HOST + ':' + PORT + '/dane');
    console.log('MongoDB: baza=' + DB_NAME + ' (istniejące dokumenty pozostają bez zmian)');
  });
}

async function stop(signal) {
  console.log('Otrzymano ' + signal + ', zamykanie...');
  if (httpServer) await new Promise(resolve => httpServer.close(resolve));
  if (client) await client.close();
  process.exit(0);
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

start().catch(err => {
  console.error('FATAL: Nie można uruchomić CGM Unified Monitor:', err.message);
  process.exit(1);
});
