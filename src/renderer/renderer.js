/**
 * renderer.js
 *
 * Controller da UI do CompanyLab. Usa window.ipc() (injetado pelo
 * preload.js) em vez de require('electron') diretamente, facilitando
 * eventual migracao para contextIsolation: true.
 */

const ipc = (...args) => window.ipc(...args);

class CompanyLabUI {
  constructor() {
    this.currentView = 'office';
    this.agents = [];
    this.departments = [];
    this.tasks = [];
    this._3dInited = false;
    this._threeRefs = {};
    this._pollTimer = null;

    this._bindNav();
    this._bindGlobalActions();
    this._bindModals();
    this._bindFilterBtns();
    this.init3DWorld();
    this._startPolling();
  }

  // ─── Navigation ────────────────────────────────────
  _bindNav() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => this.switchView(btn.dataset.view));
    });
  }

  switchView(name) {
    this.currentView = name;

    // sidebar highlight
    document.querySelectorAll('.nav-item').forEach(b => {
      b.classList.toggle('active', b.dataset.view === name);
    });

    // hide all views
    document.querySelectorAll('.view-office, .view-panel').forEach(v => v.classList.remove('active'));
    const viewEl = document.getElementById('view-' + name);
    if (viewEl) viewEl.classList.add('active');

    // breadcrumb
    const labels = {
      office:'3D Office', dashboard:'Dashboard', agents:'Agentes',
      departments:'Departamentos', tasks:'Tarefas', chat:'Chat', runtimes:'Runtimes'
    };
    document.getElementById('current-view').textContent = labels[name] || name;

    // load data
    if (name === 'dashboard')   this._loadDashboard();
    if (name === 'agents')      this._loadAgents();
    if (name === 'departments') this._loadDepartments();
    if (name === 'tasks')       this._loadTasks();
    if (name === 'chat')        this._loadChat();
    if (name === 'runtimes')    this._loadRuntimes();
    if (name === 'office' && !this._3dInited) this.init3DWorld();
  }

  // ─── Polling ────────────────────────────────────────
  _startPolling() {
    this._loadDashboard();
    this._pollTimer = setInterval(() => {
      if (this.currentView === 'dashboard') this._loadDashboard();
      if (this.currentView === 'agents')    this._loadAgents();
      if (this.currentView === 'tasks')     this._loadTasks();
    }, 3000);
  }

  // ─── Global actions ────────────────────────────────
  _bindGlobalActions() {
    // chat
    document.getElementById('btn-send').addEventListener('click', () => this._sendChat());
    document.getElementById('chat-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._sendChat(); }
    });

    // agents
    document.getElementById('btn-create-agent').addEventListener('click', () => {
      this._loadDeptsForSelect();
      this._showModal('modal-create-agent');
    });
    document.getElementById('btn-save-agent').addEventListener('click', () => this._createAgent());

    // departments
    document.getElementById('btn-create-dept').addEventListener('click', () => this._showModal('modal-create-dept'));
    document.getElementById('btn-save-dept').addEventListener('click',  () => this._createDept());

    // 3d hud
    document.getElementById('btn-reset-cam').addEventListener('click', () => this._resetCamera());
  }

  _bindModals() {
    document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
      btn.addEventListener('click', () => this._hideModal());
    });
    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target.id === 'modal-overlay') this._hideModal();
    });
  }

  _bindFilterBtns() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._renderTasks(this.tasks, btn.dataset.filter || 'all');
      });
    });
  }

  // ─── Dashboard ──────────────────────────────────────
  async _loadDashboard() {
    const data = await ipc('dashboard:getData');
    document.getElementById('stat-agents').textContent      = data.activeAgents;
    document.getElementById('stat-tasks').textContent       = data.inProgressTasks;
    document.getElementById('stat-projects').textContent    = data.projects;
    document.getElementById('stat-departments').textContent = data.departments;

    const icons = { message:'💬', task:'✅', agent:'👤', system:'⚙️' };
    document.getElementById('activity-feed').innerHTML = (data.recentActivity || []).map(a => `
      <div class="activity-item">
        <span class="activity-icon">${icons[a.type] || '•'}</span>
        <div>
          <div class="activity-text">${this._fmtActivity(a)}</div>
          <div class="activity-time">${new Date(a.timestamp).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}</div>
        </div>
      </div>
    `).join('');

    document.getElementById('agent-status-list').innerHTML = (data.recentActivity || [])
      .filter(a => a.type === 'message').slice(0, 6).map(a => `
        <div class="agent-status-item">
          <span>${a.message?.fromName || 'Desconhecido'}</span>
          <span class="status-dot status-${a.message?.from === 'user' ? 'idle' : 'working'}"></span>
        </div>
      `).join('');
  }

  _fmtActivity(a) {
    if (a.type === 'message') {
      const c = (a.message?.content || '').slice(0, 55);
      return `<b>${a.message?.fromName || '?'}</b>: ${c}${c.length >= 55 ? '…' : ''}`;
    }
    return 'Atividade registrada';
  }

  // ─── Agents ─────────────────────────────────────────
  async _loadAgents() {
    this.agents = await ipc('agent:getAll');
    document.getElementById('agents-grid').innerHTML = this.agents.map(a => `
      <div class="agent-card" data-id="${a.id}">
        <div class="agent-card-header">
          <div class="agent-avatar-thumb">${a.name?.[0] || '?'}</div>
          <div>
            <div class="agent-card-name">${a.name}</div>
            <div class="agent-card-role">${a.role || '—'}</div>
          </div>
        </div>
        <div class="agent-tags">
          ${a.department ? `<span class="tag">${a.department}</span>` : ''}
          ${a.runtime    ? `<span class="tag">${a.runtime}</span>`    : ''}
          <span class="tag">${a.status}</span>
        </div>
      </div>
    `).join('');
  }

  // ─── Departments ────────────────────────────────────
  async _loadDepartments() {
    this.departments = await ipc('department:getAll');
    document.getElementById('departments-grid').innerHTML = this.departments.map(d => `
      <div class="dept-card">
        <div class="agent-card-name">${d.name}</div>
        <div class="agent-card-role" style="margin-top:4px">${d.description || ''}</div>
        <div class="agent-tags" style="margin-top:10px">
          <span class="tag">${d.roomType || 'generic'}</span>
          <span class="tag">${d.employeeCount || 0} agentes</span>
        </div>
      </div>
    `).join('');
  }

  // ─── Tasks ──────────────────────────────────────────
  async _loadTasks() {
    this.tasks = await ipc('task:getAll');
    const active = document.querySelector('.filter-btn.active');
    this._renderTasks(this.tasks, active?.dataset.filter || 'all');
  }

  _renderTasks(tasks, filter) {
    const filtered = filter === 'all' ? tasks : tasks.filter(t => t.status === filter);
    document.getElementById('tasks-list').innerHTML = filtered.map(t => `
      <div class="task-item">
        <div class="task-item-left">
          <div class="task-bar priority-${t.priority}"></div>
          <div>
            <div class="task-title">${t.title}</div>
            <div class="task-sub">${t.assignedTo || 'Sem responsável'} · ${t.status}</div>
          </div>
        </div>
        <span class="tag">${t.priority}</span>
      </div>
    `).join('');
  }

  // ─── Chat ────────────────────────────────────────────
  async _loadChat() {
    const msgs = await ipc('chat:getMessages', 'company-general');
    const c = document.getElementById('chat-messages');
    c.innerHTML = msgs.map(m => `
      <div class="message ${m.isUser ? 'message-user' : 'message-agent'}">
        ${!m.isUser ? `<div class="message-header">${m.sender}</div>` : ''}
        <div class="message-content">${m.content}</div>
        <div class="message-time">${new Date(m.timestamp).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>
      </div>
    `).join('');
    c.scrollTop = c.scrollHeight;
  }

  async _sendChat() {
    const input = document.getElementById('chat-input');
    const content = input.value.trim();
    if (!content) return;
    await ipc('chat:sendMessage', { content });
    input.value = '';
    setTimeout(() => this._loadChat(), 400);
  }

  // ─── Runtimes ────────────────────────────────────────
  async _loadRuntimes() {
    const rts = await ipc('runtime:detect');
    document.getElementById('runtimes-list').innerHTML = rts.map(rt => `
      <div class="runtime-card">
        <div class="runtime-info">
          <h4>${rt.name}</h4>
          <div class="runtime-version">${rt.installed ? rt.version : 'Não instalado'}</div>
        </div>
        <div class="runtime-state">
          <span class="${rt.installed ? 'rt-installed' : 'rt-missing'}">${rt.installed ? '✓ Instalado' : '✗ Ausente'}</span>
          ${!rt.installed && rt.installUrl ? `<a href="${rt.installUrl}" target="_blank" class="btn-primary" style="font-size:11px;padding:4px 10px;text-decoration:none">Instalar</a>` : ''}
        </div>
      </div>
    `).join('');
  }

  // ─── Modals ──────────────────────────────────────────
  _showModal(id) {
    document.getElementById('modal-overlay').classList.add('active');
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    document.getElementById(id).style.display = 'block';
  }
  _hideModal() {
    document.getElementById('modal-overlay').classList.remove('active');
  }

  async _loadDeptsForSelect() {
    const depts = await ipc('department:getAll');
    document.getElementById('agent-department').innerHTML =
      depts.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
  }

  async _createAgent() {
    const v = id => document.getElementById(id).value;
    const result = await ipc('agent:create', {
      name:        v('agent-name'),
      role:        v('agent-role'),
      department:  v('agent-department'),
      runtime:     v('agent-runtime'),
      personality: { description: v('agent-personality') },
      skills:      v('agent-skills').split(',').map(s => s.trim()).filter(Boolean),
      isCEO:       document.getElementById('agent-is-ceo').checked,
    });
    if (result.success) { this._hideModal(); this._loadAgents(); }
  }

  async _createDept() {
    const v = id => document.getElementById(id).value;
    const result = await ipc('department:create', {
      name:        v('dept-name'),
      description: v('dept-description'),
      roomType:    v('dept-room-type'),
    });
    if (result.success) { this._hideModal(); this._loadDepartments(); }
  }

  // ─── 3D World ─────────────────────────────────────────
  init3DWorld() {
    if (this._3dInited) return;
    if (typeof THREE === 'undefined') {
      console.warn('[renderer] Three.js nao carregado ainda.');
      return;
    }
    this._3dInited = true;
    const container = document.getElementById('world-canvas');

    const scene    = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1120);
    scene.fog = new THREE.FogExp2(0x0b1120, 0.018);

    const camera   = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 300);
    camera.position.set(0, 18, 28);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Lights
    scene.add(new THREE.AmbientLight(0x1a2a4a, 3));
    const sun = new THREE.DirectionalLight(0x6699ff, 1.2);
    sun.position.set(10, 20, 10);
    sun.castShadow = true;
    scene.add(sun);

    const rimLight = new THREE.PointLight(0x3b82f6, 1.5, 40);
    rimLight.position.set(-10, 8, -10);
    scene.add(rimLight);

    // Floor
    const floorGeo = new THREE.PlaneGeometry(80, 80);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x0d1b2e, roughness: 0.9 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Grid (glowing)
    const grid = new THREE.GridHelper(80, 80, 0x1e3a5f, 0x0f2847);
    grid.position.y = 0.01;
    scene.add(grid);

    // Store refs
    this._threeRefs = { scene, camera, renderer };

    // Rooms from departments (async)
    this._loadAgents().then(() => this._build3DRooms());

    // Animate
    let frame;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();
    this._threeRefs.animFrame = frame;

    // Resize
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  _build3DRooms() {
    const { scene } = this._threeRefs;
    if (!scene) return;
    // Cria caixas coloridas por departamento
    const colors = [0x3b82f6, 0x8b5cf6, 0x22c55e, 0xf59e0b, 0xef4444, 0x06b6d4];
    this.departments.forEach((dept, i) => {
      const col = colors[i % colors.length];
      const geo = new THREE.BoxGeometry(9, 3.5, 9);
      const mat = new THREE.MeshStandardMaterial({
        color: col, transparent: true, opacity: 0.18,
        roughness: 0.3, metalness: 0.5,
        emissive: col, emissiveIntensity: 0.1,
      });
      const room = new THREE.Mesh(geo, mat);
      const angle = (i / Math.max(this.departments.length, 1)) * Math.PI * 2;
      const r = 14;
      room.position.set(Math.cos(angle) * r, 1.75, Math.sin(angle) * r);
      room.castShadow = true;
      room.receiveShadow = true;
      scene.add(room);

      // Edges
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: col, opacity: 0.6, transparent: true })
      );
      edges.position.copy(room.position);
      scene.add(edges);
    });
  }

  _resetCamera() {
    const { camera } = this._threeRefs;
    if (!camera) return;
    camera.position.set(0, 18, 28);
    camera.lookAt(0, 0, 0);
  }
}

document.addEventListener('DOMContentLoaded', () => { new CompanyLabUI(); });
