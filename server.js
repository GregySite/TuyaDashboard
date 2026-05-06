const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const cron = require('node-cron');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Augmente la limite pour autoriser l'upload de l'image du plan
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

let scheduledTasks = [];
let cronJobs = [];
const tokenCache = new Map();

// --- SAUVEGARDE DU PLAN (JSONBIN.IO) ---
const JSONBIN_ID = process.env.JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;

app.get('/api/plan-config', async (req, res) => {
    if(!JSONBIN_ID || !JSONBIN_KEY) return res.json({ image: null, positions: {} });
    try {
        const response = await axios.get(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, {
            headers: { 'X-Master-Key': JSONBIN_KEY }
        });
        res.json(response.data.record);
    } catch (e) {
        console.error("Erreur lecture JSONBin", e.message);
        res.json({ image: null, positions: {} });
    }
});

app.post('/api/plan-config', async (req, res) => {
    if(!JSONBIN_ID || !JSONBIN_KEY) return res.json({ success: true, msg: "Pas de config JSONBin" });
    try {
        await axios.put(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}`, req.body, {
            headers: { 'X-Master-Key': JSONBIN_KEY, 'Content-Type': 'application/json' }
        });
        res.json({ success: true });
    } catch (e) {
        console.error("Erreur écriture JSONBin", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- API TUYA ---
function getCredentials(req) {
    const accessId = req.headers['x-tuya-access-id'];
    const accessSecret = req.headers['x-tuya-access-secret'];
    const uid = req.headers['x-tuya-uid'];
    const region = req.headers['x-tuya-region'] || 'eu';
    if (!accessId || !accessSecret || !uid) throw new Error("Identifiants manquants.");
    return { accessId, accessSecret, uid, region };
}

function getTuyaBaseUrl(region) {
    const urls = { us: 'https://openapi.tuyaus.com', eu: 'https://openapi.tuyaeu.com', cn: 'https://openapi.tuyacn.com', in: 'https://openapi.tuyain.com' };
    return urls[region] || urls.eu;
}

async function getAccessToken(credentials) {
    const cached = tokenCache.get(credentials.accessId);
    if (cached && cached.expiry && Date.now() < cached.expiry) return cached.token;
  
    const timestamp = Date.now().toString();
    const nonce = '';
    const stringToSign = ['GET', crypto.createHash('sha256').update('').digest('hex'), '', '/v1.0/token?grant_type=1'].join('\n');
    const signStr = credentials.accessId + timestamp + nonce + stringToSign;
    const signature = crypto.createHmac('sha256', credentials.accessSecret).update(signStr).digest('hex').toUpperCase();
  
    const headers = { 'client_id': credentials.accessId, 'sign': signature, 't': timestamp, 'sign_method': 'HMAC-SHA256', 'nonce': nonce };
  
    try {
        const response = await axios({ method: 'GET', url: getTuyaBaseUrl(credentials.region) + '/v1.0/token?grant_type=1', headers });
        if (response.data.success) {
            const token = response.data.result.access_token;
            const expiry = Date.now() + (response.data.result.expire_time || 7200) * 1000 - 1800000;
            tokenCache.set(credentials.accessId, { token, expiry });
            return token;
        }
        throw new Error('Échec token');
    } catch (error) { throw error; }
}

function generateTuyaSignature(method, reqPath, params = {}, bodyString = '', token = '', credentials) {
    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString('hex');
    const sortedParams = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
    const queryString = sortedParams ? `?${sortedParams}` : '';
    const fullPath = reqPath + queryString;
    
    const contentHash = crypto.createHash('sha256').update(bodyString).digest('hex');
    const stringToSign = [method.toUpperCase(), contentHash, '', fullPath].join('\n');
    const signStr = credentials.accessId + token + timestamp + nonce + stringToSign;
    const signature = crypto.createHmac('sha256', credentials.accessSecret).update(signStr).digest('hex').toUpperCase();
      
    return { timestamp, nonce, signature, fullPath };
}

async function tuyaApiRequest(method, endpoint, body = null, params = {}, credentials) {
    const bodyString = body ? JSON.stringify(body) : '';
    const token = await getAccessToken(credentials);
    const { timestamp, nonce, signature, fullPath } = generateTuyaSignature(method, endpoint, params, bodyString, token, credentials);
    
    const headers = { 'client_id': credentials.accessId, 'access_token': token, 'sign': signature, 't': timestamp, 'nonce': nonce, 'sign_method': 'HMAC-SHA256' };
    if (method.toUpperCase() !== 'GET') headers['Content-Type'] = 'application/json';
    
    try {
        const response = await axios({ method, url: getTuyaBaseUrl(credentials.region) + fullPath, headers, data: body ? bodyString : undefined });
        return response.data;
    } catch (error) { throw error; }
}

app.get('/api/devices', async (req, res) => {
    try {
        const creds = getCredentials(req);
        res.json(await tuyaApiRequest('GET', `/v1.0/users/${creds.uid}/devices`, null, {}, creds));
    } catch (error) { res.status(500).json({ error: 'Failed', details: error.message }); }
});

app.post('/api/devices/:deviceId/commands', async (req, res) => {
    try {
        const creds = getCredentials(req);
        res.json(await tuyaApiRequest('POST', `/v1.0/devices/${req.params.deviceId}/commands`, { commands: req.body.commands }, {}, creds));
    } catch (error) { res.status(500).json({ error: 'Failed', details: error.message }); }
});

app.get('/api/shabbat-times', async (req, res) => {
    try {
        const city = req.headers['x-shabbat-city'] || 'Jerusalem';
        const response = await axios.get('https://www.hebcal.com/shabbat', { params: { cfg: 'json', geo: 'city', city: city, m: 42, b: 18 } });
        const items = response.data.items;
        res.json({ success: true, candleLighting: items.find(i => i.category === 'candles'), havdalah: items.find(i => i.category === 'havdalah') });
    } catch (error) { res.status(500).json({ error: 'Failed', details: error.message }); }
});

app.get('/api/scheduled-tasks', (req, res) => {
    try {
        const creds = getCredentials(req);
        const userTasks = scheduledTasks.filter(t => t.credentials && t.credentials.uid === creds.uid);
        res.json({ success: true, tasks: userTasks });
    } catch (error) { res.status(500).json({ error: 'Failed', details: error.message }); }
});

app.post('/api/scheduled-tasks', (req, res) => {
    try {
        const creds = getCredentials(req);
        const { name, deviceId, deviceName, action, executeAt, commands } = req.body;
        const task = {
            id: Date.now().toString(), name, deviceId, deviceName, action, executeAt,
            commands: commands || [{ code: 'switch_1', value: action === 'ON' }],
            status: 'scheduled', credentials: creds
        };
        scheduledTasks.push(task);
        scheduleTask(task);
        res.json({ success: true, task });
    } catch (error) { res.status(500).json({ error: 'Failed', details: error.message }); }
});

app.delete('/api/scheduled-tasks/:taskId', (req, res) => {
    const taskIndex = scheduledTasks.findIndex(t => t.id === req.params.taskId);
    if (taskIndex > -1) {
        const jobIndex = cronJobs.findIndex(j => j.taskId === req.params.taskId);
        if (jobIndex > -1) { cronJobs[jobIndex].job.stop(); cronJobs.splice(jobIndex, 1); }
        scheduledTasks.splice(taskIndex, 1);
    }
    res.json({ success: true });
});

function scheduleTask(task) {
    const executeDate = new Date(task.executeAt);
    if (executeDate <= new Date()) return;
    const cronExpression = `${executeDate.getMinutes()} ${executeDate.getHours()} ${executeDate.getDate()} ${executeDate.getMonth() + 1} *`;
    
    const job = cron.schedule(cronExpression, async () => {
        try {
            await tuyaApiRequest('POST', `/v1.0/devices/${task.deviceId}/commands`, { commands: task.commands }, {}, task.credentials);
            const taskRef = scheduledTasks.find(t => t.id === task.id);
            if (taskRef) { taskRef.status = 'executed'; taskRef.executedAt = new Date().toISOString(); }
        } catch (error) {
            const taskRef = scheduledTasks.find(t => t.id === task.id);
            if (taskRef) { taskRef.status = 'failed'; taskRef.error = error.message; }
        }
    }, { timezone: "Asia/Jerusalem" });
    cronJobs.push({ taskId: task.id, job });
}

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => { console.log(`🚀 Tuya Dashboard SaaS running on port ${PORT}`); });
