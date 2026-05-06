const API_BASE = window.location.origin + '/api';

let devices = [];
let userCredentials = null;
let currentMode = 'use'; // 'use', 'edit', 'shabbat'

// Stockage du plan et des positions
let devicePositions = JSON.parse(localStorage.getItem('tuya_device_positions')) || {}; 
// Exemple: { "id_appareil": { x: 45, y: 30 } } en pourcentages

// --- GESTION DE LA CONNEXION ---
function checkAuth() {
    const saved = localStorage.getItem('tuya_credentials');
    if (saved) {
        userCredentials = JSON.parse(saved);
        document.getElementById('login-modal').classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');
        initApp();
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

// --- INITIALISATION DE L'APP ---
async function initApp() {
    loadFloorPlan();
    await fetchDevices();
    renderMap();
}

// Récupère les données brutes Tuya
async function fetchDevices() {
    document.getElementById('loading').classList.remove('hidden');
    try {
        const response = await apiFetch('/devices');
        const data = await response.json();
        if (data.success && data.result) {
            devices = data.result;
        } else {
            if(data.code === 1004 || data.code === 1106) { alert("Clés Tuya invalides."); logout(); }
            console.error("Erreur API", data);
        }
    } catch (e) {
        console.error("Erreur réseau", e);
    } finally {
        document.getElementById('loading').classList.add('hidden');
    }
}

// --- GESTION DES MODES DE NAVIGATION ---
function setMode(mode) {
    currentMode = mode;
    // UI Boutons
    ['use', 'edit', 'shabbat'].forEach(m => {
        const btn = document.getElementById(`btn-mode-${m}`);
        if(m === mode) {
            btn.classList.remove('text-gray-400', 'hover:text-white');
            btn.classList.add('bg-indigo-600', 'text-white', 'shadow');
        } else {
            btn.classList.add('text-gray-400', 'hover:text-white');
            btn.classList.remove('bg-indigo-600', 'text-white', 'shadow');
        }
    });

    // Affichage des vues
    if(mode === 'shabbat') {
        document.getElementById('view-map').classList.add('hidden');
        document.getElementById('view-shabbat').classList.remove('hidden');
        loadShabbatTimes(); loadScheduledTasks(); loadDevicesForScheduling();
    } else {
        document.getElementById('view-shabbat').classList.add('hidden');
        document.getElementById('view-map').classList.remove('hidden');
        document.getElementById('edit-sidebar').classList.toggle('hidden', mode !== 'edit');
        document.getElementById('edit-help-text').classList.toggle('hidden', mode !== 'edit');
        renderMap(); // Redessine selon le mode (draggable ou non)
    }
}

// --- GESTION DU PLAN D'ARRIÈRE-PLAN ---
document.getElementById('plan-upload').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if(!file) return;
    
    // Alerte si l'image est très lourde
    if(file.size > 3 * 1024 * 1024) { alert("L'image est un peu lourde, essayez un JPG compressé si possible !"); }
    
    const reader = new FileReader();
    reader.onload = function(event) {
        const base64Image = event.target.result;
        localStorage.setItem('tuya_floor_plan', base64Image);
        loadFloorPlan();
    };
    reader.readAsDataURL(file);
});
