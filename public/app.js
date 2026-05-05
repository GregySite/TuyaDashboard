const API_BASE = window.location.origin + '/api';

let devices = [];
let userCredentials = null;

// --- GESTION DE LA CONNEXION ---
function checkAuth() {
    const saved = localStorage.getItem('tuya_credentials');
    if (saved) {
        userCredentials = JSON.parse(saved);
        document.getElementById('login-modal').classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');
        loadDevices();
    } else {
        document.getElementById('login-modal').classList.remove('hidden');
        document.getElementById('main-app').classList.add('hidden');
    }
}

document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    userCredentials = {
        accessId: document.getElementById('login-id').value.trim(),
        accessSecret: document.getElementById('login-secret').value.trim(),
        uid: document.getElementById('login-uid').value.trim(),
        region: document.getElementById('login-region').value,
        city: document.getElementById('login-city').value
    };
    localStorage.setItem('tuya_credentials', JSON.stringify(userCredentials));
    checkAuth();
});

function logout() {
    localStorage.removeItem('tuya_credentials');
    userCredentials = null;
    checkAuth();
}

// Wrapper pour fetch() injectant les secrets Tuya dans les headers
async function apiFetch(endpoint, options = {}) {
    if (!userCredentials) throw new Error("Non connecté");
    const headers = {
        'Content-Type': 'application/json',
        'x-tuya-access-id': userCredentials.accessId,
        'x-tuya-access-secret': userCredentials.accessSecret,
        'x-tuya-uid': userCredentials.uid,
        'x-tuya-region': userCredentials.region,
        'x-shabbat-city': userCredentials.city,
        ...options.headers
    };
    return fetch(API_BASE + endpoint, { ...options, headers });
}

// --- LOGIQUE D'INTERFACE ---
function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('[id^="tab-"]').forEach(b => { 
        b.classList.remove('tab-active'); 
        b.classList.add('tab-inactive'); 
    });
    
    document.getElementById(`content-${tab}`).classList.remove('hidden');
    const btn = document.getElementById(`tab-${tab}`);
    btn.classList.remove('tab-inactive'); 
    btn.classList.add('tab-active');
    
    if (tab === 'manual') loadDevices();
    if (tab === 'shabbat') { loadShabbatTimes(); loadScheduledTasks(); loadDevicesForScheduling(); }
}

async function loadDevices() {
    const container = document.getElementById('devices-container');
    const loading = document.getElementById('loading');
    const scrollPos = window.scrollY; // Mémorise la position
    
    if (container.innerHTML === '') loading.classList.remove('hidden');
    
    try {
        const response = await apiFetch('/devices');
        const data = await response.json();
        
        if (data.success && data.result) {
            devices = data.result;
            container.innerHTML = '';
            if (devices.length === 0) {
                container.innerHTML = '<div class="col-span-full text-center text-gray-500 py-10">Aucun appareil trouvé.</div>';
            } else {
                devices.forEach(d => container.appendChild(createDeviceCard(d)));
            }
            window.scrollTo(0, scrollPos); // Restaure la position
        } else {
            container.innerHTML = `<div class="col-span-full text-red-500 text-center py-10 text-sm">Erreur: ${data.msg || 'Vérifiez vos identifiants'}</div>`;
        }
    } catch (e) {
        container.innerHTML = '<div class="col-span-full text-red-500 text-center py-10 text-sm">Erreur réseau.</div>';
    } finally { loading.classList.add('hidden'); }
}

async function sendCommand(deviceId, code, value) {
    try {
        const res = await apiFetch(`/devices/${deviceId}/commands`, {
            method: 'POST', 
            body: JSON.stringify({ commands: [{ code, value }] })
        });
        const data = await res.json();
        if (data.success) setTimeout(loadDevices, 500);
    } catch (e) { console.error(e); }
}

function setCountdown(deviceId) {
    const seconds = parseInt(document.getElementById(`timer-${deviceId}`).value);
    sendCommand(deviceId, 'countdown_1', seconds);
}

// --- LE MOTEUR DE GÉNÉRATION DES CARTES (MAX FEATURES) ---
function createDeviceCard(device) {
    const card = document.createElement('div');
    card.className = 'device-card bg-white rounded-xl p-5 shadow-lg flex flex-col justify-between border-t-4 border-purple-500';
    
    const state = {};
    if (device.status) device.status.forEach(s => { state[s.code] = s.value; });
    
    let icon = 'fa-plug'; let iconColor = 'text-gray-400';
    if (device.category === 'wsdcg') { icon = 'fa-temperature-half'; iconColor = 'text-orange-500'; } 
    else if (device.product_name?.toLowerCase().includes('boiler') || device.name.toLowerCase().includes('doud')) {
        icon = 'fa-fire-flame-simple'; iconColor = state.switch_1 ? 'text-red-500' : 'text-gray-400';
    } else if (device.category === 'dj' || device.name.toLowerCase().includes('lumi')) {
        icon = 'fa-lightbulb'; iconColor = (state.switch_1 || state.switch_led) ? 'text-yellow-400' : 'text-gray-400';
    } else {
        iconColor = state.switch_1 ? 'text-green-500' : 'text-gray-400';
    }

    let html = `
    <div class="flex items-start justify-between mb-4">
        <div class="flex-1">
            <div class="flex items-center mb-1">
                <i class="fas ${icon} text-2xl ${iconColor} mr-3"></i>
                <h3 class="font-bold text-gray-800 leading-tight text-base">${device.name}</h3>
            </div>
            <p class="text-[10px] text-gray-400 ml-9 uppercase tracking-wider">${device.product_name || 'Tuya Device'}</p>
        </div>
        <div class="h-2 w-2 rounded-full ${device.online ? 'bg-green-500' : 'bg-red-500'} mt-1"></div>
    </div>
    <div class="space-y-3">`;

    // Interrupteurs
    ['switch_1', 'switch_2', 'switch_led'].forEach(code => {
        if (code in state) {
            html += `<div class="flex justify-between items-center bg-gray-50 p-2 rounded-lg">
                <span class="text-xs font-bold text-gray-600">Alimentation</span>
                <label class="switch"><input type="checkbox" ${state[code] ? 'checked' : ''} onchange="sendCommand('${device.id}', '${code}', this.checked)" ${!device.online ? 'disabled' : ''}><span class="slider"></span></label>
            </div>`;
        }
    });

    // Température / Humidité
    if ('va_temperature' in state) {
        html += `<div class="grid grid-cols-2 gap-2"><div class="bg-orange-50 text-orange-700 p-2 rounded text-center"><div class="text-xs">Temp</div><div class="font-bold">${(state.va_temperature/10).toFixed(1)}°C</div></div><div class="bg-blue-50 text-blue-700 p-2 rounded text-center"><div class="text-xs">Hum</div><div class="font-bold">${state.humidity_value}%</div></div></div>`;
    }

    // Watts / Volts
    if ('cur_power' in state) {
        html += `<div class="flex justify-between items-center bg-gray-900 text-white p-2 rounded-lg text-xs font-mono"><span class="text-yellow-400 font-bold">${(state.cur_power/10).toFixed(1)} W</span><span>${(state.cur_voltage/10).toFixed(0)}V</span></div>`;
    }

    // Minuteur
    if ('countdown_1' in state) {
        html += `<div class="mt-2 pt-2 border-t border-gray-100">
            <div class="flex gap-1">
                <select id="timer-${device.id}" class="flex-1 bg-gray-100 text-[10px] rounded p-1 border-none">
                    <option value="0">Désactiver</option>
                    <option value="1800" ${state.countdown_1 === 1800 ? 'selected' : ''}>30m</option>
                    <option value="3600" ${state.countdown_1 === 3600 ? 'selected' : ''}>1h</option>
                </select>
                <button onclick="setCountdown('${device.id}')" class="bg-purple-600 text-white px-2 py-1 rounded text-[10px] font-bold">OK</button>
            </div>
            ${state.countdown_1 > 0 ? `<p class="text-[9px] text-green-600 mt-1 font-bold">Fin dans ~${Math.round(state.countdown_1/60)} min</p>` : ''}
        </div>`;
    }

    // Fonctions Inconnues (Modules gris)
    const handled = ['switch_1', 'switch_2', 'switch_led', 'va_temperature', 'humidity_value', 'cur_power', 'cur_voltage', 'countdown_1', 'cur_current', 'add_ele', 'fault', 'voltage_coe', 'electric_coe', 'power_coe', 'electricity_coe'];
    let extras = '';
    for (const [k, v] of Object.entries(state)) {
        if (!handled.includes(k)) extras += `<span class="bg-gray-100 text-[9px] px-1 rounded mr-1 mb-1">${k}:${v}</span>`;
    }
    if (extras) html += `<div class="flex flex-wrap mt-2 opacity-50">${extras}</div>`;

    html += `</div>`;
    card.innerHTML = html;
    return card;
}

// --- SHABBAT & TÂCHES ---
async function loadShabbatTimes() {
    try {
        const response = await apiFetch('/shabbat-times');
        const data = await response.json();
        if (data.success) {
            const cd = new Date(data.candleLighting.date);
            const hd = new Date(data.havdalah.date);
            document.getElementById('shabbat-times').innerHTML = `
                <div class="bg-white bg-opacity-10 p-4 rounded-lg"><h3>Bougies</h3><p class="text-2xl font-bold">${cd.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</p></div>
                <div class="bg-white bg-opacity-10 p-4 rounded-lg"><h3>Havdalah</h3><p class="text-2xl font-bold">${hd.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</p></div>
            `;
        }
    } catch(e) {}
}

async function loadDevicesForScheduling() {
    const select = document.getElementById('task-device');
    if(devices.length === 0) await loadDevices();
    select.innerHTML = '<option value="">Choisir...</option>';
    devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = JSON.stringify({id: d.id, name: d.name});
        opt.textContent = d.name;
        select.appendChild(opt);
    });
}

async function loadScheduledTasks() {
    const c = document.getElementById('tasks-container');
    try {
        const res = await apiFetch('/scheduled-tasks');
        const data = await res.json();
        c.innerHTML = data.tasks.length ? '' : '<p class="text-gray-500 text-center py-4">Aucune tâche.</p>';
        data.tasks.forEach(t => {
            const isPast = new Date(t.executeAt) < new Date();
            c.innerHTML += `<div class="bg-gray-50 p-3 rounded flex justify-between items-center mb-2 border-l-4 ${isPast?'border-gray-400':'border-purple-500'}">
                <div class="text-sm"><h4 class="font-bold">${t.name}</h4><p class="text-[10px] text-gray-500">${t.deviceName} - ${t.action} à ${new Date(t.executeAt).toLocaleString('fr-FR')}</p></div>
                <button onclick="deleteTask('${t.id}')" class="text-red-400"><i class="fas fa-trash"></i></button>
            </div>`;
        });
    } catch(e) {}
}

document.getElementById('task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dev = JSON.parse(document.getElementById('task-device').value);
    const action = document.getElementById('task-action').value;
    try {
        await apiFetch('/scheduled-tasks', {
            method: 'POST', body: JSON.stringify({
                name: document.getElementById('task-name').value,
                deviceId: dev.id, deviceName: dev.name, action,
                executeAt: new Date(document.getElementById('task-time').value).toISOString(),
                commands: [{code: 'switch_1', value: action === 'ON'}]
            })
        });
        loadScheduledTasks();
        alert("Tâche programmée !");
    } catch(e) { alert("Erreur"); }
});

async function deleteTask(id) {
    if(!confirm("Supprimer ?")) return;
    await apiFetch(`/scheduled-tasks/${id}`, { method: 'DELETE' });
    loadScheduledTasks();
}

window.addEventListener('DOMContentLoaded', checkAuth);
