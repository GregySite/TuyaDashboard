const API_BASE = window.location.origin + '/api';

let devices = [];
let userCredentials = null;

// --- VARIABLES DU PLAN ---
let isEditMode = false;
let devicePositions = JSON.parse(localStorage.getItem('device_positions')) || {};

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

// --- LOGIQUE D'INTERFACE (ONGLETS) ---
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
    if (tab === 'plan') renderPlan();
    if (tab === 'shabbat') { loadShabbatTimes(); loadScheduledTasks(); loadDevicesForScheduling(); }
}

async function loadDevices() {
    const container = document.getElementById('devices-container');
    const loading = document.getElementById('loading');
    const scrollPos = window.scrollY;
    
    if (!container || !loading) return;
    if (container.innerHTML === '') loading.classList.remove('hidden');
    
    try {
        const response = await apiFetch('/devices');
        const data = await response.json();
        
        if (data.success && data.result) {
            devices = data.result;
            container.innerHTML = '';
            devices.forEach(d => container.appendChild(createDeviceCard(d)));
            window.scrollTo(0, scrollPos);
            
            if(!document.getElementById('content-plan').classList.contains('hidden')) renderPlan();
        }
    } catch (e) { console.error(e); } 
    finally { loading.classList.add('hidden'); }
}

async function sendCommand(deviceId, code, value) {
    try {
        const res = await apiFetch(`/devices/${deviceId}/commands`, {
            method: 'POST', 
            body: JSON.stringify({ commands: [{ code, value }] })
        });
        const data = await res.json();
        if (data.success) {
            const device = devices.find(d => d.id === deviceId);
            if (device && device.status) {
                const s = device.status.find(st => st.code === code);
                if (s) s.value = value;
            }
            renderPlan();
            setTimeout(loadDevices, 1000);
        }
    } catch (e) { console.error(e); }
}

// --- MODULE LE PLAN V3 ---

function initPlanLogic() {
    const planContainer = document.getElementById('plan-container');
    if (planContainer && !document.getElementById('fullscreen-btn')) {
        const fsBtn = document.createElement('button');
        fsBtn.id = 'fullscreen-btn';
        fsBtn.className = "absolute top-2 right-2 bg-gray-900 bg-opacity-60 text-white p-2 rounded-lg z-20";
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
            localStorage.setItem('plan_image', ev.target.result);
            renderPlan();
        };
        reader.readAsDataURL(file);
    });

    document.getElementById('btn-edit-mode').addEventListener('click', () => {
        isEditMode = !isEditMode;
        document.getElementById('plan-sidebar').classList.toggle('hidden', !isEditMode);
        const btn = document.getElementById('btn-edit-mode');
        btn.innerHTML = isEditMode ? '<i class="fas fa-check mr-2"></i>Terminer' : '<i class="fas fa-tools mr-2"></i>Mode Édition';
        btn.className = isEditMode ? "bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm" : "bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-bold text-sm";
        renderPlan();
    });

    const dropzone = document.getElementById('plan-dropzone');
    dropzone.ondragover = (e) => e.preventDefault();
    dropzone.ondrop = (e) => {
        e.preventDefault();
        const deviceId = e.dataTransfer.getData('text/plain');
        const rect = dropzone.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        devicePositions[deviceId] = {x, y};
        localStorage.setItem('device_positions', JSON.stringify(devicePositions));
        renderPlan();
    };
}

function renderPlan() {
    const imgData = localStorage.getItem('plan_image');
    const imgEl = document.getElementById('plan-image');
    const placeholder = document.getElementById('plan-placeholder');
    const dropzone = document.getElementById('plan-dropzone');
    const sidebarList = document.getElementById('unplaced-devices');
    
    if(imgData) { imgEl.src = imgData; imgEl.classList.remove('hidden'); placeholder.classList.add('hidden'); }
    
    dropzone.innerHTML = '';
    sidebarList.innerHTML = '';
    
    devices.forEach(device => {
        const switchStatus = device.status?.find(s => s.code === 'switch_1' || s.code === 'switch_led');
        const isOn = switchStatus?.value || false;
        const pos = devicePositions[device.id];
        
        let icon = 'fa-lightbulb';
        if (device.category === 'wsdcg') icon = 'fa-temperature-half';
        else if (device.product_name?.toLowerCase().includes('boiler') || device.name.toLowerCase().includes('doud')) icon = 'fa-fire-flame-simple';

        if (pos) {
            const token = document.createElement('div');
            token.className = `token-placed w-10 h-10 rounded-full flex items-center justify-center text-lg border-2 border-white shadow-lg transition-all ${isOn ? 'bg-yellow-400 text-white scale-110' : 'bg-gray-800 text-white opacity-80'}`;
            token.style.left = pos.x + '%';
            token.style.top = pos.y + '%';
            token.innerHTML = `<i class="fas ${icon}"></i>`;
            
            if (isEditMode) {
                token.draggable = true;
                token.ondragstart = (e) => e.dataTransfer.setData('text/plain', device.id);
                token.ondblclick = () => { delete devicePositions[device.id]; localStorage.setItem('device_positions', JSON.stringify(devicePositions)); renderPlan(); };
            } else if (switchStatus) {
                token.onclick = () => sendCommand(device.id, switchStatus.code, !isOn);
            }
            dropzone.appendChild(token);
        } else if (isEditMode) {
            const listItem = document.createElement('div');
            listItem.className = "p-3 mb-2 bg-white border rounded-lg shadow-sm cursor-grab flex items-center text-xs font-bold";
            listItem.draggable = true;
            listItem.ondragstart = (e) => e.dataTransfer.setData('text/plain', device.id);
            listItem.innerHTML = `<i class="fas ${icon} mr-2 text-purple-500"></i> ${device.name}`;
            sidebarList.appendChild(listItem); // CORRECTION ICI : listItem et non token
        }
    });
}

// --- RESTE DU CODE (SANS CHANGEMENT) ---
function createDeviceCard(device) {
    const card = document.createElement('div');
    card.className = 'device-card bg-white rounded-xl p-5 shadow-lg border-t-4 border-purple-500';
    const state = {};
    if (device.status) device.status.forEach(s => { state[s.code] = s.value; });
    card.innerHTML = `<h3 class="font-bold text-gray-800">${device.name}</h3><p class="text-[10px] text-gray-400 mb-4">${device.product_name}</p>`;
    // Simplifié pour l'exemple, garde ta fonction createDeviceCard complète si tu veux
    return card;
}

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
