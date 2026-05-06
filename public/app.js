const API_BASE = window.location.origin + '/api';

let devices = [];
let userCredentials = null;

// --- VARIABLES DU PLAN (Maintenant synchronisées avec le serveur) ---
let isEditMode = false;
let serverConfig = { image: null, positions: {} };

// --- GESTION DE LA CONNEXION ---
function checkAuth() {
    const saved = localStorage.getItem('tuya_credentials');
    const loginModal = document.getElementById('login-modal');
    const mainApp = document.getElementById('main-app');
    if (!loginModal || !mainApp) return;

    if (saved) {
        userCredentials = JSON.parse(saved);
        loginModal.classList.add('hidden');
        mainApp.classList.remove('hidden');
        loadDevices();
        fetchPlanConfig(); // Charge le plan depuis le serveur
    } else {
        loginModal.classList.remove('hidden');
        mainApp.classList.add('hidden');
    }
}

function logout() {
    localStorage.removeItem('tuya_credentials');
    userCredentials = null;
    checkAuth();
}

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

// --- LOGIQUE DU PLAN SERVEUR ---
async function fetchPlanConfig() {
    try {
        const res = await fetch(API_BASE + '/plan-config');
        serverConfig = await res.json();
        if(!serverConfig.positions) serverConfig.positions = {};
        if(!document.getElementById('content-plan').classList.contains('hidden')) renderPlan();
    } catch (e) { console.error("Erreur chargement plan", e); }
}

async function savePlanConfig() {
    try {
        await fetch(API_BASE + '/plan-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(serverConfig)
        });
    } catch (e) { console.error("Erreur sauvegarde plan", e); }
}

// --- LOGIQUE D'INTERFACE ---
function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('[id^="tab-"]').forEach(b => { 
        b.classList.remove('tab-active'); b.classList.add('tab-inactive'); 
    });
    
    document.getElementById(`content-${tab}`).classList.remove('hidden');
    const btn = document.getElementById(`tab-${tab}`);
    btn.classList.remove('tab-inactive'); btn.classList.add('tab-active');
    
    if (tab === 'manual') loadDevices();
    if (tab === 'plan') { fetchPlanConfig(); renderPlan(); }
    if (tab === 'shabbat') { loadShabbatTimes(); loadScheduledTasks(); loadDevicesForScheduling(); }
}

async function loadDevices() {
    const container = document.getElementById('devices-container');
    const loading = document.getElementById('loading');
    
    if (!container || !loading) return;
    if (container.innerHTML === '') loading.classList.remove('hidden');
    
    try {
        const response = await apiFetch('/devices');
        const data = await response.json();
        
        if (data.success && data.result) {
            devices = data.result;
            container.innerHTML = '';
            devices.forEach(d => container.appendChild(createDeviceCard(d)));
            
            if(!document.getElementById('content-plan').classList.contains('hidden')) renderPlan();
            
            const modalContent = document.getElementById('device-modal-content');
            if(modalContent.firstChild && !document.getElementById('device-modal').classList.contains('hidden')) {
                const openDeviceId = modalContent.firstChild.getAttribute('data-device-id');
                const updatedDev = devices.find(d => d.id === openDeviceId);
                if(updatedDev) {
                    modalContent.innerHTML = '';
                    modalContent.appendChild(createDeviceCard(updatedDev));
                }
            }
        }
    } catch (e) { console.error(e); } 
    finally { loading.classList.add('hidden'); }
}

async function sendCommand(deviceId, code, value) {
    try {
        const device = devices.find(d => d.id === deviceId);
        if (device && device.status) {
            const s = device.status.find(st => st.code === code);
            if (s) s.value = value;
        }
        renderPlan();

        const res = await apiFetch(`/devices/${deviceId}/commands`, {
            method: 'POST', body: JSON.stringify({ commands: [{ code, value }] })
        });
        const data = await res.json();
        
        if (data.success) {
            const modalContent = document.getElementById('device-modal-content');
            if(modalContent.firstChild && !document.getElementById('device-modal').classList.contains('hidden')) {
                modalContent.innerHTML = '';
                modalContent.appendChild(createDeviceCard(device));
            }
        }
    } catch (e) { console.error(e); }
}

function setCountdown(deviceId) {
    const timerSelect = document.getElementById(`timer-${deviceId}`);
    if (timerSelect) {
        sendCommand(deviceId, 'countdown_1', parseInt(timerSelect.value));
        closeDeviceModal();
    }
}

// --- POPUP APPUI LONG ---
function openDeviceModal(device) {
    if(isEditMode) return;
    const modal = document.getElementById('device-modal');
    const content = document.getElementById('device-modal-content');
    content.innerHTML = '';
    
    const card = createDeviceCard(device);
    card.setAttribute('data-device-id', device.id);
    content.appendChild(card);
    
    modal.classList.remove('hidden');
}

function closeDeviceModal() {
    document.getElementById('device-modal').classList.add('hidden');
}

// --- MODULE LE PLAN V3 ---

function initPlanLogic() {
    const planContainer = document.getElementById('plan-container');
    if (planContainer && !document.getElementById('fullscreen-btn')) {
        const fsBtn = document.createElement('button');
        fsBtn.id = 'fullscreen-btn';
        fsBtn.className = "absolute top-2 right-2 bg-gray-900 bg-opacity-60 text-white p-2 rounded-lg z-20 hover:bg-opacity-100 transition-all";
        fsBtn.innerHTML = '<i class="fas fa-expand"></i>';
        fsBtn.onclick = () => {
            if (!document.fullscreenElement) planContainer.requestFullscreen();
            else document.exitFullscreen();
        };
        planContainer.appendChild(fsBtn);
    }

    document.getElementById('upload-plan').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            serverConfig.image = ev.target.result;
            savePlanConfig();
            renderPlan();
        };
        reader.readAsDataURL(file);
    });

    document.getElementById('btn-edit-mode').addEventListener('click', () => {
        isEditMode = !isEditMode;
        document.getElementById('plan-sidebar').classList.toggle('hidden', !isEditMode);
        const btn = document.getElementById('btn-edit-mode');
        btn.innerHTML = isEditMode ? '<i class="fas fa-check mr-2"></i>Terminer Édition' : '<i class="fas fa-tools mr-2"></i>Mode Édition';
        btn.className = isEditMode ? "bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm" : "bg-gray-200 text-gray-700 hover:bg-gray-300 px-4 py-2 rounded-lg font-bold text-sm";
        renderPlan();
    });

    const dropzone = document.getElementById('plan-dropzone');
    dropzone.ondragover = (e) => e.preventDefault();
    dropzone.ondrop = (e) => {
        e.preventDefault();
        const deviceId = e.dataTransfer.getData('text/plain');
        if(!deviceId || !isEditMode) return;
        const rect = dropzone.getBoundingClientRect();
        
        // Placement exact (100% libre)
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        serverConfig.positions[deviceId] = {x, y};
        savePlanConfig();
        renderPlan();
    };
}

function renderPlan() {
    const imgEl = document.getElementById('plan-image');
    const placeholder = document.getElementById('plan-placeholder');
    const dropzone = document.getElementById('plan-dropzone');
    const sidebarList = document.getElementById('unplaced-devices');
    
    if(serverConfig.image) { 
        imgEl.src = serverConfig.image; 
        imgEl.classList.remove('hidden'); 
        placeholder.classList.add('hidden'); 
    }
    
    dropzone.innerHTML = '';
    sidebarList.innerHTML = '';
    
    devices.forEach(device => {
        const state = {};
        if (device.status) device.status.forEach(s => { state[s.code] = s.value; });
        
        const pos = serverConfig.positions[device.id];
        const isSensor = device.category === 'wsdcg' || ('va_temperature' in state);
        const isBoiler = device.product_name?.toLowerCase().includes('boiler') || device.name.toLowerCase().includes('doud');
        const switchesKeys = Object.keys(state).filter(k => k.startsWith('switch_') && k !== 'switch_led' && typeof state[k] === 'boolean');
        const mainSwitch = switchesKeys.length > 0 ? switchesKeys[0] : 'switch_1';
        
        if (pos) {
            const tokenContainer = document.createElement('div');
            tokenContainer.className = 'absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 z-10';
            tokenContainer.style.left = pos.x + '%';
            tokenContainer.style.top = pos.y + '%';

            const tokenContent = document.createElement('div');
            tokenContent.className = 'select-none transition-transform duration-200';
            
            if (isSensor) {
                const temp = state.va_temperature ? (state.va_temperature/10).toFixed(1) + '°C' : '--°C';
                const hum = state.humidity_value ? state.humidity_value + '%' : '';
                tokenContent.innerHTML = `<div class="bg-white text-gray-800 px-2 py-1 rounded shadow-lg border-2 border-orange-400 text-xs font-bold flex items-center whitespace-nowrap cursor-pointer hover:scale-105"><i class="fas fa-thermometer-half text-orange-500 mr-1"></i> ${temp} ${hum ? `<span class="mx-1 text-gray-300">|</span><i class="fas fa-droplet text-blue-500 mr-1"></i> ${hum}` : ''}</div>`;
            } else if (switchesKeys.length > 1) {
                let pillHtml = '<div class="flex bg-gray-800 rounded-full shadow-lg border-2 border-white overflow-hidden cursor-pointer hover:scale-105">';
                switchesKeys.forEach((swCode, idx) => {
                    const isOn = state[swCode];
                    const borderLeft = idx > 0 ? 'border-l border-gray-600' : '';
                    const bgClass = isOn ? 'bg-yellow-400 text-white' : 'text-gray-300 hover:bg-gray-700';
                    pillHtml += `<div data-sw="${swCode}" class="switch-part w-8 h-8 flex items-center justify-center font-bold text-xs ${borderLeft} ${bgClass}">${idx + 1}</div>`;
                });
                pillHtml += '</div>';
                tokenContent.innerHTML = pillHtml;
            } else {
                let icon = 'fa-lightbulb';
                if (isBoiler) icon = 'fa-fire-flame-simple';
                else if (device.category === 'cz') icon = 'fa-plug';
                
                const isOn = state[mainSwitch] || state.switch_led;
                tokenContent.innerHTML = `<div class="w-10 h-10 rounded-full flex items-center justify-center text-lg border-2 border-white shadow-lg cursor-pointer transition-all ${isOn ? 'bg-yellow-400 text-white scale-110 shadow-[0_0_15px_rgba(250,204,21,0.8)]' : 'bg-gray-800 text-white opacity-90 hover:bg-gray-700 hover:scale-105'}"><i class="fas ${icon}"></i></div>`;
            }

            let pressTimer;
            let isLongPress = false;
            let startX, startY;

            const handlePointerDown = (e) => {
                if(isEditMode) return;
                isLongPress = false;
                const touch = e.touches ? e.touches[0] : e;
                startX = touch.clientX;
                startY = touch.clientY;
                pressTimer = setTimeout(() => {
                    isLongPress = true;
                    openDeviceModal(device);
                }, 500);
            };

            const handlePointerUp = (e) => {
                if(isEditMode) return;
                clearTimeout(pressTimer);
                
                if (!isLongPress) {
                    const touch = e.changedTouches ? e.changedTouches[0] : e;
                    const diffX = Math.abs(touch.clientX - startX);
                    const diffY = Math.abs(touch.clientY - startY);
                    
                    if(diffX > 10 || diffY > 10) return; // Scroll ignoré

                    if (switchesKeys.length > 1) {
                        const swPart = e.target.closest('.switch-part');
                        if (swPart) {
                            const swCode = swPart.getAttribute('data-sw');
                            sendCommand(device.id, swCode, !state[swCode]);
                        }
                    } else if (!isSensor) {
                        sendCommand(device.id, mainSwitch, !state[mainSwitch]);
                    } else {
                        openDeviceModal(device);
                    }
                }
            };

            if (!isEditMode) {
                tokenContent.addEventListener('mousedown', handlePointerDown);
                tokenContent.addEventListener('touchstart', handlePointerDown, {passive: true});
                tokenContent.addEventListener('mouseup', handlePointerUp);
                tokenContent.addEventListener('touchend', handlePointerUp);
                tokenContent.addEventListener('mouseleave', () => clearTimeout(pressTimer));
                tokenContent.addEventListener('contextmenu', (e) => { e.preventDefault(); clearTimeout(pressTimer); });
            }

            const label = document.createElement('div');
            label.className = 'bg-black bg-opacity-70 text-white text-[9px] px-2 py-0.5 rounded-full whitespace-nowrap pointer-events-none font-semibold shadow-sm tracking-wide mt-1';
            label.innerText = device.name;

            if (isEditMode) {
                tokenContent.draggable = true;
                tokenContent.classList.add('cursor-grab');
                tokenContent.ondragstart = (e) => e.dataTransfer.setData('text/plain', device.id);
                tokenContent.ondblclick = () => { 
                    delete serverConfig.positions[device.id]; 
                    savePlanConfig(); 
                    renderPlan(); 
                };
            }

            tokenContainer.appendChild(tokenContent);
            tokenContainer.appendChild(label);
            dropzone.appendChild(tokenContainer);
            
        } else if (isEditMode) {
            const listItem = document.createElement('div');
            listItem.className = "p-3 mb-2 bg-white border border-gray-200 rounded-lg shadow-sm cursor-grab hover:bg-gray-50 flex items-center text-xs font-bold text-gray-700 transition-colors";
            listItem.draggable = true;
            listItem.ondragstart = (e) => e.dataTransfer.setData('text/plain', device.id);
            listItem.innerHTML = `<i class="fas fa-grip-vertical text-gray-300 mr-3"></i> ${device.name}`;
            sidebarList.appendChild(listItem);
        }
    });

    if (isEditMode && sidebarList.innerHTML === '') {
        sidebarList.innerHTML = '<p class="text-xs text-gray-400 text-center py-4 italic">Tous les appareils sont placés !</p>';
    }
}

// --- MOTEUR DE CARTE ---
function createDeviceCard(device) {
    const card = document.createElement('div');
    card.className = 'device-card bg-white rounded-xl p-5 shadow border-t-4 border-purple-500 w-full';
    
    const state = {};
    if (device.status) device.status.forEach(s => { state[s.code] = s.value; });
    
    let icon = 'fa-plug'; let iconColor = 'text-gray-400';
    if (device.category === 'wsdcg') { icon = 'fa-temperature-half'; iconColor = 'text-orange-500'; } 
    else if (device.product_name?.toLowerCase().includes('boiler') || device.name.toLowerCase().includes('doud')) {
        icon = 'fa-fire-flame-simple'; iconColor = state.switch_1 ? 'text-red-500' : 'text-gray-400';
    } else if (device.category === 'dj' || device.name.toLowerCase().includes('lumi') || device.name.toLowerCase().includes('lamp')) {
        icon = 'fa-lightbulb'; iconColor = (state.switch_1 || state.switch_led) ? 'text-yellow-400' : 'text-gray-400';
    } else {
        iconColor = state.switch_1 ? 'text-green-500' : 'text-gray-400';
    }

    let html = `
    <div class="flex items-start justify-between mb-4">
        <div class="flex-1">
            <div class="flex items-center mb-1"><i class="fas ${icon} text-2xl ${iconColor} mr-3"></i><h3 class="font-bold text-gray-800 leading-tight text-base">${device.name}</h3></div>
            <p class="text-[10px] text-gray-400 ml-9 uppercase tracking-wider">${device.product_name || 'Tuya Device'}</p>
        </div>
        <div class="h-2 w-2 rounded-full ${device.online ? 'bg-green-500' : 'bg-red-500'} mt-1"></div>
    </div>
    <div class="space-y-3">`;

    ['switch_1', 'switch_2', 'switch_led'].forEach(code => {
        if (code in state) {
            let label = code === 'switch_2' ? 'Interrupteur 2' : 'Alimentation';
            if ('switch_1' in state && 'switch_2' in state && code === 'switch_1') label = 'Interrupteur 1';
            html += `<div class="flex justify-between items-center bg-gray-50 p-2 rounded-lg"><span class="text-xs font-bold text-gray-600">${label}</span><label class="switch"><input type="checkbox" ${state[code] ? 'checked' : ''} onchange="sendCommand('${device.id}', '${code}', this.checked)" ${!device.online ? 'disabled' : ''}><span class="slider"></span></label></div>`;
        }
    });

    if ('va_temperature' in state) {
        html += `<div class="grid grid-cols-2 gap-2"><div class="bg-orange-50 text-orange-700 p-2 rounded text-center"><div class="text-xs">Temp</div><div class="font-bold">${(state.va_temperature/10).toFixed(1)}°C</div></div><div class="bg-blue-50 text-blue-700 p-2 rounded text-center"><div class="text-xs">Hum</div><div class="font-bold">${state.humidity_value}%</div></div></div>`;
    }

    if ('cur_power' in state) {
        html += `<div class="flex justify-between items-center bg-gray-900 text-white p-2 rounded-lg text-xs font-mono"><span class="text-yellow-400 font-bold">${(state.cur_power/10).toFixed(1)} W</span><span>${(state.cur_voltage/10).toFixed(0)}V</span></div>`;
    }

    if ('countdown_1' in state) {
        html += `<div class="mt-2 pt-2 border-t border-gray-100">
            <div class="flex gap-1">
                <select id="timer-${device.id}" class="flex-1 bg-gray-100 text-[10px] rounded p-1 border-none">
                    <option value="0">Désactiver</option>
                    <option value="900" ${state.countdown_1 === 900 ? 'selected' : ''}>15m</option>
                    <option value="1800" ${state.countdown_1 === 1800 ? 'selected' : ''}>30m</option>
                    <option value="3600" ${state.countdown_1 === 3600 ? 'selected' : ''}>1h</option>
                </select>
                <button onclick="setCountdown('${device.id}')" class="bg-purple-600 text-white px-2 py-1 rounded text-[10px] font-bold">OK</button>
            </div>
            ${state.countdown_1 > 0 ? `<p class="text-[9px] text-green-600 mt-1 font-bold"><i class="fas fa-clock mr-1"></i> Fin dans ~${Math.round(state.countdown_1/60)} min</p>` : ''}
        </div>`;
    }

    html += `</div>`;
    card.innerHTML = html;
    return card;
}

// --- SHABBAT ---
async function loadShabbatTimes() { /* Identique */ }
async function loadDevicesForScheduling() { /* Identique */ }
async function loadScheduledTasks() { /* Identique */ }

window.addEventListener('DOMContentLoaded', () => {
    initPlanLogic();
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            userCredentials = {
                accessId: document.getElementById('login-id').value,
                accessSecret: document.getElementById('login-secret').value,
                uid: document.getElementById('login-uid').value,
                region: document.getElementById('login-region').value,
                city: document.getElementById('login-city').value
            };
            localStorage.setItem('tuya_credentials', JSON.stringify(userCredentials));
            checkAuth();
        });
    }
    checkAuth();
});
