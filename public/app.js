const API_BASE = window.location.origin + '/api';

let devices = [];
let userCredentials = null;
let isEditMode = false;
let serverConfig = { image: null, positions: {} };
let pollingInterval = null;
let isFitMode = true;
let lastTapTime = 0; // ANTI DOUBLE-CLIC MOBILE

function applyFitMode() {
    const container = document.getElementById('plan-scroll-area');
    const img = document.getElementById('plan-image');
    const icon = document.getElementById('fit-btn-icon');
    if(!img || !container) return;

    if (isFitMode) {
        // MODE AJUSTÉ (Vue globale)
        img.style.maxWidth = '100%';
        img.style.maxHeight = (container.clientHeight - 20) + 'px'; 
        img.style.width = 'auto';
        img.style.height = 'auto';
        if(icon) icon.className = 'fas fa-search-plus';
    } else {
        // MODE ZOOM (Doux et équilibré)
        img.style.maxWidth = 'none';
        img.style.maxHeight = 'none';
        // Sur PC, prend la largeur naturelle. Sur mobile, force une belle largeur.
        img.style.width = 'max(100%, 800px)'; 
        img.style.height = 'auto';
        if(icon) icon.className = 'fas fa-compress';
    }
}

function toggleFitMode() {
    isFitMode = !isFitMode;
    applyFitMode();
}

window.addEventListener('resize', () => {
    if (!document.getElementById('content-plan').classList.contains('hidden')) {
        setTimeout(applyFitMode, 100); 
    }
});

function checkAuth() {
    const urlParams = new URLSearchParams(window.location.search);
    if(urlParams.has('id') && urlParams.has('secret')) {
        const creds = {
            accessId: urlParams.get('id'),
            accessSecret: urlParams.get('secret'),
            uid: urlParams.get('uid'),
            region: urlParams.get('region') || 'eu',
            city: 'Jerusalem'
        };
        localStorage.setItem('tuya_credentials', JSON.stringify(creds));
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    const saved = localStorage.getItem('tuya_credentials');
    const loginModal = document.getElementById('login-modal');
    const mainApp = document.getElementById('main-app');
    if (!loginModal || !mainApp) return;

    if (saved) {
        userCredentials = JSON.parse(saved);
        loginModal.classList.add('hidden');
        mainApp.classList.remove('hidden');
        loadDevices();
        fetchPlanConfig();
        startPolling(); 
    } else {
        loginModal.classList.remove('hidden');
        mainApp.classList.add('hidden');
        if(pollingInterval) clearInterval(pollingInterval);
    }
}

function logout() {
    localStorage.removeItem('tuya_credentials');
    userCredentials = null;
    if(pollingInterval) clearInterval(pollingInterval);
    checkAuth();
}

function showQRCode() {
    if(!userCredentials) return;
    const link = `${window.location.origin}?id=${userCredentials.accessId}&secret=${userCredentials.accessSecret}&uid=${userCredentials.uid}&region=${userCredentials.region}`;
    document.getElementById('qr-image').src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(link)}`;
    document.getElementById('qr-modal').classList.remove('hidden');
}

function closeQRCode() { document.getElementById('qr-modal').classList.add('hidden'); }

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

function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && userCredentials) loadDevices();
    });
    pollingInterval = setInterval(async () => {
        if (document.hidden || isEditMode || !document.getElementById('device-modal').classList.contains('hidden')) return; 
        try {
            const res = await apiFetch('/devices');
            const data = await res.json();
            if (data.success && data.result) {
                devices = data.result;
                if(!document.getElementById('content-plan').classList.contains('hidden')) renderPlan();
                if(!document.getElementById('content-manual').classList.contains('hidden')) {
                    document.getElementById('devices-container').innerHTML = '';
                    devices.forEach(d => document.getElementById('devices-container').appendChild(createDeviceCard(d)));
                }
            }
        } catch(e) { console.log("Polling error"); }
    }, 10000); 
}

async function loadDevices() {
    const container = document.getElementById('devices-container');
    const loading = document.getElementById('loading');
    if (!container || !loading) return;
    try {
        const response = await apiFetch('/devices');
        const data = await response.json();
        if (data.success && data.result) {
            devices = data.result;
            container.innerHTML = '';
            devices.forEach(d => container.appendChild(createDeviceCard(d)));
            if(!document.getElementById('content-plan').classList.contains('hidden')) renderPlan();
        }
    } catch (e) { console.error(e); } 
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

function closeDeviceModal() { document.getElementById('device-modal').classList.add('hidden'); }

async function fetchPlanConfig() {
    try {
        const res = await fetch(API_BASE + '/plan-config');
        serverConfig = await res.json();
        if(!serverConfig.positions) serverConfig.positions = {};
        if(!document.getElementById('content-plan').classList.contains('hidden')) renderPlan();
    } catch (e) { console.error(e); }
}

async function savePlanConfig() {
    try {
        await fetch(API_BASE + '/plan-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(serverConfig) });
    } catch (e) { console.error(e); }
}

function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('[id^="tab-"]').forEach(b => { b.classList.remove('tab-active'); b.classList.add('tab-inactive'); });
    document.getElementById(`content-${tab}`).classList.remove('hidden');
    document.getElementById(`tab-${tab}`).classList.remove('tab-inactive'); document.getElementById(`tab-${tab}`).classList.add('tab-active');
    
    if (tab === 'manual') loadDevices();
    if (tab === 'plan') { fetchPlanConfig(); renderPlan(); }
    if (tab === 'shabbat') { loadShabbatTimes(); loadScheduledTasks(); loadDevicesForScheduling(); }
}

function initPlanLogic() {
    const planContainer = document.getElementById('plan-container');
    const fsBtn = document.getElementById('fullscreen-btn');
    if (planContainer && fsBtn) {
        fsBtn.onclick = () => {
            if (!document.fullscreenElement) planContainer.requestFullscreen();
            else document.exitFullscreen();
        };
    }

    const uploadBtn = document.getElementById('upload-plan');
    if (uploadBtn) {
        uploadBtn.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if(!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => { serverConfig.image = ev.target.result; savePlanConfig(); renderPlan(); };
            reader.readAsDataURL(file);
        });
    }

    const editBtn = document.getElementById('btn-edit-mode');
    if (editBtn) {
        editBtn.addEventListener('click', () => {
            isEditMode = !isEditMode;
            document.getElementById('plan-sidebar').classList.toggle('hidden', !isEditMode);
            editBtn.innerHTML = isEditMode ? '<i class="fas fa-check mr-2"></i>Terminer Édition' : '<i class="fas fa-tools mr-2"></i>Mode Édition';
            editBtn.className = isEditMode ? "bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm" : "bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-bold text-sm";
            renderPlan();
        });
    }

    const dropzone = document.getElementById('plan-dropzone');
    if (dropzone) {
        dropzone.ondragover = (e) => e.preventDefault();
        dropzone.ondrop = (e) => {
            e.preventDefault();
            if(!isEditMode) return;
            try {
                const dataStr = e.dataTransfer.getData('text/plain');
                let deviceId = dataStr;
                let offset = { x: 20, y: 20 };
                
                if(dataStr.includes('{')) {
                    const parsed = JSON.parse(dataStr);
                    deviceId = parsed.id;
                    offset = { x: parsed.ox, y: parsed.oy };
                }
                
                const rect = dropzone.getBoundingClientRect();
                const exactX = (e.clientX - rect.left) - offset.x + 20; 
                const exactY = (e.clientY - rect.top) - offset.y + 20;
                
                serverConfig.positions[deviceId] = { x: (exactX / rect.width) * 100, y: (exactY / rect.height) * 100 };
                savePlanConfig();
                renderPlan();
            } catch(err) { console.error("Erreur drag", err); }
        };
    }
}

function renderPlan() {
    const imgEl = document.getElementById('plan-image');
    const placeholder = document.getElementById('plan-placeholder');
    const dropzone = document.getElementById('plan-dropzone');
    const sidebarList = document.getElementById('unplaced-devices');
    const fitBtn = document.getElementById('fit-btn');
    const wrapper = document.getElementById('plan-wrapper');
    
    if (!dropzone || !sidebarList) return;

    if(serverConfig.image) { 
        imgEl.src = serverConfig.image; 
        wrapper.classList.remove('hidden'); 
        if(fitBtn) fitBtn.classList.remove('hidden');
        if(placeholder) placeholder.classList.add('hidden'); 
        applyFitMode(); 
    }
    
    dropzone.innerHTML = '';
    sidebarList.innerHTML = '';
    
    devices.forEach(device => {
        const state = {};
        if (device.status) device.status.forEach(s => { state[s.code] = s.value; });
        const pos = serverConfig.positions[device.id];
        
        if (pos) {
            const tokenContainer = document.createElement('div');
            tokenContainer.className = 'absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 z-10';
            tokenContainer.style.left = pos.x + '%';
            tokenContainer.style.top = pos.y + '%';

            const tokenContent = document.createElement('div');
            tokenContent.className = 'select-none transition-transform duration-200';
            
            const isSensor = device.category === 'wsdcg' || ('va_temperature' in state);
            const isBoiler = device.product_name?.toLowerCase().includes('boiler') || device.name.toLowerCase().includes('doud');
            const switchesKeys = Object.keys(state).filter(k => k.startsWith('switch_') && k !== 'switch_led' && typeof state[k] === 'boolean');
            const mainSwitch = switchesKeys.length > 0 ? switchesKeys[0] : 'switch_1';
            
            if (isSensor) {
                const temp = state.va_temperature ? (state.va_temperature/10).toFixed(1) + '°C' : '--°C';
                const hum = state.humidity_value ? state.humidity_value + '%' : '';
                tokenContent.innerHTML = `<div class="bg-white text-gray-800 px-2 py-1 rounded shadow-lg border-2 border-orange-400 font-bold flex items-center whitespace-nowrap cursor-pointer" style="font-size: 12px;"><i class="fas fa-thermometer-half text-orange-500 mr-1"></i> ${temp} ${hum ? `<span class="mx-1 text-gray-300">|</span><i class="fas fa-droplet text-blue-500 mr-1"></i> ${hum}` : ''}</div>`;
            } else if (switchesKeys.length > 1) {
                let pillHtml = '<div class="flex bg-gray-800 rounded-full shadow-lg border-2 border-white overflow-hidden cursor-pointer">';
                switchesKeys.forEach((swCode, idx) => {
                    const isOn = state[swCode];
                    pillHtml += `<div data-sw="${swCode}" class="switch-part w-8 h-8 flex items-center justify-center font-bold text-xs ${idx > 0 ? 'border-l border-gray-600' : ''} ${isOn ? 'bg-yellow-400 text-white' : 'text-gray-300 hover:bg-gray-700'}">${idx + 1}</div>`;
                });
                tokenContent.innerHTML = pillHtml + '</div>';
            } else {
                let icon = isBoiler ? 'fa-fire-flame-simple' : (device.category === 'cz' ? 'fa-plug' : 'fa-lightbulb');
                const isOn = state[mainSwitch] || state.switch_led;
                const activeShadow = isOn ? 'box-shadow: 0 0 15px rgba(250,204,21,0.8); transform: scale(1.1);' : '';
                tokenContent.innerHTML = `<div class="w-10 h-10 rounded-full flex items-center justify-center text-lg border-2 border-white shadow-lg cursor-pointer transition-all ${isOn ? 'bg-yellow-400 text-white' : 'bg-gray-800 text-white'}" style="opacity: 0.9; ${activeShadow}"><i class="fas ${icon}"></i></div>`;
            }

            let pressTimer;
            let isLongPress = false;
            let startX, startY;

            const handlePointerDown = (e) => {
                if(isEditMode) return;
                // ANTI GHOST-CLICK (Ignore les clics de souris qui arrivent juste après un appui tactile)
                if (e.type === 'mousedown' && Date.now() - lastTapTime < 400) return;

                isLongPress = false;
                const touch = e.touches ? e.touches[0] : e;
                startX = touch.clientX; startY = touch.clientY;
                pressTimer = setTimeout(() => { isLongPress = true; openDeviceModal(device); }, 500);
            };

            const handlePointerUp = (e) => {
                if(isEditMode) return;
                clearTimeout(pressTimer);
                
                if (e.type === 'mouseup' && Date.now() - lastTapTime < 400) return;
                if (e.type === 'touchend') lastTapTime = Date.now();

                if (!isLongPress) {
                    const touch = e.changedTouches ? e.changedTouches[0] : e;
                    if(Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) return;

                    if (switchesKeys.length > 1) {
                        const swPart = e.target.closest('.switch-part');
                        if (swPart) sendCommand(device.id, swPart.getAttribute('data-sw'), !state[swPart.getAttribute('data-sw')]);
                    } else if (!isSensor) {
                        sendCommand(device.id, mainSwitch, !state[mainSwitch]);
                    } else { openDeviceModal(device); }
                }
            };

            if (!isEditMode) {
                tokenContent.addEventListener('mousedown', handlePointerDown);
                tokenContent.addEventListener('touchstart', handlePointerDown, {passive: true});
                tokenContent.addEventListener('mouseup', handlePointerUp);
                tokenContent.addEventListener('touchend', handlePointerUp);
                tokenContent.addEventListener('mouseleave', () => clearTimeout(pressTimer));
            }

            const label = document.createElement('div');
            label.className = 'bg-black bg-opacity-70 text-white px-2 py-0.5 rounded-full whitespace-nowrap pointer-events-none font-semibold shadow-sm tracking-wide mt-1';
            label.style.fontSize = '9px';
            label.innerText = device.name;

            if (isEditMode) {
                tokenContent.draggable = true;
                tokenContent.classList.add('cursor-grab');
                tokenContent.ondragstart = (e) => {
                    const rect = tokenContent.getBoundingClientRect();
                    e.dataTransfer.setData('text/plain', JSON.stringify({id: device.id, ox: e.clientX - rect.left, oy: e.clientY - rect.top}));
                };
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
            listItem.className = "p-3 mb-2 bg-white border border-gray-200 rounded-lg shadow-sm cursor-grab flex items-center text-xs font-bold text-gray-700";
            listItem.draggable = true;
            listItem.ondragstart = (e) => e.dataTransfer.setData('text/plain', device.id);
            listItem.innerHTML = `<i class="fas fa-grip-vertical text-gray-300 mr-3"></i> ${device.name}`;
            sidebarList.appendChild(listItem);
        }
    });

    if (isEditMode && sidebarList.innerHTML === '') sidebarList.innerHTML = '<p class="text-xs text-gray-400 text-center py-4 italic">Tous placés !</p>';
}

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
    } else { iconColor = state.switch_1 ? 'text-green-500' : 'text-gray-400'; }

    let html = `<div class="flex items-start justify-between mb-4"><div class="flex-1"><div class="flex items-center mb-1"><i class="fas ${icon} text-2xl ${iconColor} mr-3"></i><h3 class="font-bold text-gray-800 leading-tight text-base">${device.name}</h3></div><p class="text-gray-400 uppercase tracking-wider" style="font-size: 10px; margin-left: 36px;">${device.product_name || 'Tuya Device'}</p></div><div class="h-2 w-2 rounded-full ${device.online ? 'bg-green-500' : 'bg-red-500'} mt-1"></div></div><div class="space-y-3">`;

    ['switch_1', 'switch_2', 'switch_led'].forEach(code => {
        if (code in state) {
            let label = code === 'switch_2' ? 'Interrupteur 2' : 'Alimentation';
            if ('switch_1' in state && 'switch_2' in state && code === 'switch_1') label = 'Interrupteur 1';
            html += `<div class="flex justify-between items-center bg-gray-50 p-2 rounded-lg"><span class="text-xs font-bold text-gray-600">${label}</span><label class="switch"><input type="checkbox" ${state[code] ? 'checked' : ''} onchange="sendCommand('${device.id}', '${code}', this.checked)" ${!device.online ? 'disabled' : ''}><span class="slider"></span></label></div>`;
        }
    });

    if ('va_temperature' in state) html += `<div class="grid grid-cols-2 gap-2"><div class="bg-orange-50 text-orange-700 p-2 rounded text-center"><div class="text-xs">Temp</div><div class="font-bold">${(state.va_temperature/10).toFixed(1)}°C</div></div><div class="bg-blue-50 text-blue-700 p-2 rounded text-center"><div class="text-xs">Hum</div><div class="font-bold">${state.humidity_value}%</div></div></div>`;
    if ('cur_power' in state) html += `<div class="flex justify-between items-center bg-gray-900 text-white p-2 rounded-lg font-mono" style="font-size: 12px;"><span class="text-yellow-400 font-bold">${(state.cur_power/10).toFixed(1)} W</span><span>${(state.cur_voltage/10).toFixed(0)}V</span></div>`;
    if ('countdown_1' in state) html += `<div class="mt-2 pt-2 border-t border-gray-100"><div class="flex gap-1"><select id="timer-${device.id}" class="flex-1 bg-gray-100 rounded p-1 border-none" style="font-size: 10px;"><option value="0">Désactiver</option><option value="900" ${state.countdown_1 === 900 ? 'selected' : ''}>15m</option><option value="1800" ${state.countdown_1 === 1800 ? 'selected' : ''}>30m</option><option value="3600" ${state.countdown_1 === 3600 ? 'selected' : ''}>1h</option></select><button onclick="setCountdown('${device.id}')" class="bg-purple-600 text-white px-2 py-1 rounded font-bold" style="font-size: 10px;">OK</button></div>${state.countdown_1 > 0 ? `<p class="text-green-600 mt-1 font-bold" style="font-size: 9px;"><i class="fas fa-clock mr-1"></i> Fin dans ~${Math.round(state.countdown_1/60)} min</p>` : ''}</div>`;
    html += `</div>`;
    card.innerHTML = html;
    return card;
}

async function loadShabbatTimes() {
    try {
        const response = await apiFetch('/shabbat-times');
        const data = await response.json();
        if (data.success) {
            const cd = new Date(data.candleLighting.date);
            const hd = new Date(data.havdalah.date);
            const shabbatDiv = document.getElementById('shabbat-times');
            if (shabbatDiv) {
                shabbatDiv.innerHTML = `<div class="bg-white bg-opacity-10 p-4 rounded-lg"><h3><i class="fas fa-candle-holder mr-2"></i>Bougies</h3><p class="text-2xl font-bold">${cd.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</p></div><div class="bg-white bg-opacity-10 p-4 rounded-lg"><h3><i class="fas fa-star mr-2"></i>Havdalah</h3><p class="text-2xl font-bold">${hd.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</p></div>`;
            }
            const taskTime = document.getElementById('task-time');
            if (taskTime) taskTime.value = new Date(cd.getTime() - 7200000).toISOString().slice(0,16);
        }
    } catch(e) {}
}

async function loadDevicesForScheduling() {
    const select = document.getElementById('task-device');
    if (!select) return;
    if (devices.length === 0) await loadDevices();
    select.innerHTML = '<option value="">Choisir un appareil...</option>';
    devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = JSON.stringify({id: d.id, name: d.name});
        opt.textContent = d.name;
        select.appendChild(opt);
    });
}

async function loadScheduledTasks() {
    const c = document.getElementById('tasks-container');
    if (!c) return;
    try {
        const res = await apiFetch('/scheduled-tasks');
        const data = await res.json();
        c.innerHTML = data.tasks.length ? '' : '<p class="text-gray-500 text-center py-4">Aucune tâche programmée.</p>';
        data.tasks.forEach(t => {
            const isPast = new Date(t.executeAt) < new Date();
            c.innerHTML += `<div class="bg-gray-50 p-3 rounded flex justify-between items-center mb-2 border-l-4 ${isPast?'border-gray-400':'border-purple-500'}"><div class="text-sm"><h4 class="font-bold">${t.name}</h4><p class="text-gray-500" style="font-size: 10px;">${t.deviceName} - ${t.action} à ${new Date(t.executeAt).toLocaleString('fr-FR')}</p></div><button onclick="deleteTask('${t.id}')" class="text-red-400 hover:text-red-600 transition-colors"><i class="fas fa-trash"></i></button></div>`;
        });
    } catch(e) {}
}

async function deleteTask(id) {
    if(!confirm("Voulez-vous vraiment supprimer cette tâche ?")) return;
    await apiFetch(`/scheduled-tasks/${id}`, { method: 'DELETE' });
    loadScheduledTasks();
}

function initApp() {
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
    const taskForm = document.getElementById('task-form');
    if (taskForm) {
        taskForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const devValue = document.getElementById('task-device').value;
            if (!devValue) return alert("Veuillez choisir un appareil.");
            const dev = JSON.parse(devValue);
            const action = document.getElementById('task-action').value;
            try {
                await apiFetch('/scheduled-tasks', { method: 'POST', body: JSON.stringify({ name: document.getElementById('task-name').value, deviceId: dev.id, deviceName: dev.name, action, executeAt: new Date(document.getElementById('task-time').value).toISOString(), commands: [{code: 'switch_1', value: action === 'ON'}] }) });
                loadScheduledTasks();
                alert("Tâche programmée avec succès !");
            } catch(e) { alert("Erreur lors de la programmation."); }
        });
    }
    checkAuth();
}

if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initApp); } else { initApp(); }
