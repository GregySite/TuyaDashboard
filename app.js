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

// Wrapper pour fetch() injectant les secrets
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

// --- LOGIQUE PRINCIPALE ---
function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('[id^="tab-"]').forEach(b => { b.classList.remove('tab-active'); b.classList.add('tab-inactive'); });
    
    document.getElementById(`content-${tab}`).classList.remove('hidden');
    const btn = document.getElementById(`tab-${tab}`);
    btn.classList.remove('tab-inactive'); btn.classList.add('tab-active');
    
    if (tab === 'manual') loadDevices();
    if (tab === 'shabbat') { loadShabbatTimes(); loadScheduledTasks(); loadDevicesForScheduling(); }
}

async function loadDevices() {
    const container = document.getElementById('devices-container');
    const loading = document.getElementById('loading');
    const scrollPos = window.scrollY;
    
    if (container.innerHTML === '') loading.classList.remove('hidden');
    
    try {
        const response = await apiFetch('/devices');
        const data = await response.json();
        
        if (data.success && data.result) {
            devices = data.result;
            container.innerHTML = devices.length ? '' : '<div class="col-span-full text-center text-gray-500 py-10">Aucun appareil trouvé.</div>';
            devices.forEach(d => container.appendChild(createDeviceCard(d)));
            window.scrollTo(0, scrollPos);
        } else {
            if (data.code === 1004 || data.code === 1106) {
                alert("Identifiants incorrects ou expirés !");
                logout();
            }
            container.innerHTML = `<div class="col-span-full text-red-500 text-center py-10">Erreur API: ${data.msg || 'Inconnue'}</div>`;
        }
    } catch (e) {
        container.innerHTML = '<div class="col-span-full text-red-500 text-center py-10">Erreur réseau.</div>';
    } finally { loading.classList.add('hidden'); }
}

async function sendCommand(deviceId, code, value) {
    try {
        await apiFetch(`/devices/${deviceId}/commands`, {
            method: 'POST', body: JSON.stringify({ commands: [{ code, value }] })
        });
        setTimeout(loadDevices, 500);
    } catch (e) { console.error(e); }
}

function createDeviceCard(device) {
    const card = document.createElement('div');
    card.className = 'device-card bg-white rounded-xl p-5 shadow-lg flex flex-col justify-between';
    
    const state = {};
    if (device.status) device.status.forEach(s => { state[s.code] = s.value; });
    
    let html = `<div class="flex justify-between items-start mb-4">
        <div><h3 class="font-bold text-lg text-gray-800">${device.name}</h3><p class="text-xs text-gray-400">${device.product_name}</p></div>
        <div class="h-3 w-3 rounded-full ${device.online ? 'bg-green-500' : 'bg-red-500'} mt-1"></div>
    </div><div class="space-y-3">`;

    ['switch_1', 'switch_2', 'switch_led'].forEach(code => {
        if (code in state) {
            html += `<div class="flex justify-between items-center bg-gray-50 p-2 rounded">
                <span class="text-sm font-semibold">Alimentation</span>
                <label class="switch"><input type="checkbox" ${state[code] ? 'checked' : ''} onchange="sendCommand('${device.id}', '${code}', this.checked)" ${!device.online?'disabled':''}><span class="slider"></span></label>
            </div>`;
        }
    });

    if ('cur_power' in state) {
        html += `<div class="flex justify-between bg-gray-800 text-white p-2 rounded"><span class="text-yellow-400"><i class="fas fa-bolt mr-2"></i>Watts</span><span class="font-mono">${(state.cur_power/10).toFixed(1)} W</span></div>`;
    }
    if ('va_temperature' in state) {
        html += `<div class="flex justify-between bg-orange-100 text-orange-800 p-2 rounded"><span class="font-bold"><i class="fas fa-temperature-half mr-2"></i>Temp</span><span class="font-bold">${(state.va_temperature/10).toFixed(1)}°C</span></div>`;
    }

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
                <div class="bg-white bg-opacity-20 p-4 rounded-lg"><h3><i class="fas fa-candle-holder mr-2"></i>Bougies</h3><p class="text-2xl font-bold">${cd.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</p></div>
                <div class="bg-white bg-opacity-20 p-4 rounded-lg"><h3><i class="fas fa-star mr-2"></i>Havdalah</h3><p class="text-2xl font-bold">${hd.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</p></div>
            `;
            document.getElementById('task-time').value = new Date(cd.getTime() - 7200000).toISOString().slice(0,16);
        }
    } catch(e) {}
}

async function loadDevicesForScheduling() {
    const select = document.getElementById('task-device');
    if(devices.length === 0) await loadDevices();
    select.innerHTML = '';
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
                <div><h4 class="font-bold">${t.name}</h4><p class="text-xs text-gray-500">${t.deviceName} - ${t.action} à ${new Date(t.executeAt).toLocaleString('fr-FR')}</p></div>
                <button onclick="deleteTask('${t.id}')" class="text-red-500 hover:text-red-700"><i class="fas fa-trash"></i></button>
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
        alert("Tâche ajoutée !");
    } catch(e) { alert("Erreur"); }
});

async function deleteTask(id) {
    await apiFetch(`/scheduled-tasks/${id}`, { method: 'DELETE' });
    loadScheduledTasks();
}

window.addEventListener('DOMContentLoaded', checkAuth);