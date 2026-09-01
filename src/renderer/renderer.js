/**
 * renderer.js
 *
 * Controller da UI do CompanyLab.
 * Usa window.ipc() do preload.js e window.World do world.js.
 */

'use strict';

const ipc = (...args) => window.ipc(...args);

class CompanyLabUI {
  constructor() {
    this.currentView = 'office';
    this.agents      = [];
    this.departments = [];
    this.tasks       = [];
    this.world       = null;
    this._pollTimer  = null;

    this._initWorld();
    this._bindNav();
    this._bindGlobalActions();
    this._bindModals();
    this._bindFilterBtns();
    this._startPolling();
    this._bindLiveEvents();
  }

  // ─── Eventos ao vivo (EventBus -> main.js -> preload -> aqui) ──────────────

  _bindLiveEvents() {
    if (!window.onEvent) return;

    // main.js retransmite TODO evento do EventBus no canal "event".
    // Quando uma mensagem de chat chega (resposta de agente) ou o status
    // de um agente muda, atualizamos a view relevante na hora, em vez de
    // depender só do polling de 3s (que nem cobre a view de chat).
    window.onEvent('event', (evt) => {
      if (!evt || !evt.type) return;

      if (evt.type === 'agent.message.sent' && this.currentView === 'chat') {
        this._loadChat();
      }

      if (evt.type === 'agent.updated' && this.currentView === 'agents') {
        this._loadAgents();
      }
    });
  }

  // ─── 3D World ─────────────────────────────────────────────────────────────

  _initWorld() {
    const container = document.getElementById('world-canvas');
    if (!window.World || !container) return;

    this.world = new window.World(container, {
      onPointerLock: (locked) => {
        // Sidebar + topbar fade in FPS mode
        document.getElementById('app').classList.toggle('app-locked', locked);

        // Show/hide UI overlays
        document.getElementById('world-start').style.display = locked ? 'none' : 'flex';
        document.getElementById('crosshair').style.display   = locked ? 'flex' : 'none';
        if (!locked) document.getElementById('world-prompt').classList.add('hidden');
      },

      onPrompt: (text) => {
        const el = document.getElementById('world-prompt');
        if (text) {
          el.textContent = text;
          el.classList.remove('hidden');
        } else {
          el.classList.add('hidden');
        }
      },

      onAgentSelect: (agent) => {
        this._showAgentPanel(agent);
      },

      onRoomEnter: (deptName) => {
        document.getElementById('current-view').textContent = deptName;
      },

      onRoomExit: () => {
        if (this.currentView === 'office') {
          document.getElementById('current-view').textContent = '3D Office';
        }
        this._hideAgentPanel();
      },
    });

    // Load world data
    this._loadWorldData();
  }

  async _loadWorldData() {
    const [depts, agents] = await Promise.all([
      ipc('department:getAll'),
      ipc('agent:getAll'),
    ]);
    this.departments = depts;
    this.agents      = agents;
    if (this.world) this.world.populate(depts, agents);
  }

  // ─── Navigation ────────────────────────────────────────────────────────────

  _bindNav() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => this.switchView(btn.dataset.view));
    });
  }

  switchView(name) {
    this.currentView = name;

    document.querySelectorAll('.nav-item').forEach(b => {
      b.classList.toggle('active', b.dataset.view === name);
    });
    document.querySelectorAll('.view-office, .view-panel').forEach(v => v.classList.remove('active'));

    const viewEl = document.getElementById('view-' + name);
    if (viewEl) viewEl.classList.add('active');

    const labels = {
      office:'3D Office', dashboard:'Dashboard', agents:'Agentes',
      departments:'Departamentos', tasks:'Tarefas', chat:'Chat', runtimes:'Runtimes',
    };
    document.getElementById('current-view').textContent = labels[name] || name;

    // Release pointer lock when leaving office view
    if (name !== 'office' && document.pointerLockElement) {
      document.exitPointerLock();
    }

    // Set world to passive camera when not in office view
    if (this.world) this.world.setPassive(name !== 'office');

    if (name === 'dashboard')   this._loadDashboard();
    if (name === 'agents')      this._loadAgents();
    if (name === 'departments') this._loadDepartments();
    if (name === 'tasks')       this._loadTasks();
    if (name === 'chat')        this._loadChat();
    if (name === 'runtimes')    this._loadRuntimes();
  }

  // ─── Polling ───────────────────────────────────────────────────────────────

  _startPolling() {
    this._loadDashboard();
    this._pollTimer = setInterval(() => {
      if (this.currentView === 'dashboard') this._loadDashboard();
      if (this.currentView === 'agents')    this._loadAgents();
      if (this.currentView === 'tasks')     this._loadTasks();
      if (this.currentView === 'chat')      this._loadChat();
    }, 3000);
  }

  // ─── Global Actions ────────────────────────────────────────────────────────

  _bindGlobalActions() {
    // Chat
    document.getElementById('btn-send').addEventListener('click', () => this._sendChat());
    document.getElementById('chat-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._sendChat(); }
    });

    // Agents
    document.getElementById('btn-create-agent').addEventListener('click', () => {
      this._loadDeptsForSelect();
      this._showModal('modal-create-agent');
    });
    document.getElementById('btn-save-agent').addEventListener('click', () => this._createAgent());

    // Departments
    document.getElementById('btn-create-dept').addEventListener('click', () => this._showModal('modal-create-dept'));
    document.getElementById('btn-save-dept').addEventListener('click',  () => this._createDept());

    // Agent panel close
    document.getElementById('agent-panel-close')?.addEventListener('click', () => this._hideAgentPanel());

    // World start overlay — click to lock
    document.getElementById('world-start').addEventListener('click', () => {
      const canvas = document.querySelector('#world-canvas canvas');
      if (canvas) canvas.requestPointerLock();
    });
  }

  // ─── Agent Panel ────────────────────────────────────────────────────────────

  _showAgentPanel(agent) {
    const panel = document.getElementById('agent-panel');
    panel.classList.remove('hidden');

    document.getElementById('ap-avatar').textContent  = agent.name?.[0]?.toUpperCase() || '?';
    document.getElementById('ap-name').textContent    = agent.name;
    document.getElementById('ap-role').textContent    = agent.role || '—';
    document.getElementById('ap-dept').textContent    = agent.department || '—';
    document.getElementById('ap-runtime').textContent = agent.runtime || '—';
    document.getElementById('ap-status').textContent  = agent.status;

    // Status dot color
    const dot = document.getElementById('ap-status-dot');
    if (dot) dot.className = 'status-dot status-' + agent.status;
  }

  _hideAgentPanel() {
    document.getElementById('agent-panel').classList.add('hidden');
  }

  // ─── Dashboard ─────────────────────────────────────────────────────────────

  async _loadDashboard() {
    const data = await ipc('dashboard:getData');
    document.getElementById('stat-agents').textContent      = data.activeAgents;
    document.getElementById('stat-tasks').textContent       = data.inProgressTasks;
    document.getElementById('stat-projects').textContent    = data.projects;
    document.getElementById('stat-departments').textContent = data.departments;

    const icons = { message:'💬', task:'✅', agent:'👤', system:'⚙️' };
    document.getElementById('activity-feed').innerHTML = (data.recentActivity || []).map(a =>
      '<div class="activity-item">' +
        '<span class="activity-icon">' + (icons[a.type] || '•') + '</span>' +
        '<div>' +
          '<div class="activity-text">' + this._fmtActivity(a) + '</div>' +
          '<div class="activity-time">' + new Date(a.timestamp).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }) + '</div>' +
        '</div>' +
      '</div>'
    ).join('');

    document.getElementById('agent-status-list').innerHTML = (data.recentActivity || [])
      .filter(a => a.type === 'message').slice(0, 6).map(a =>
        '<div class="agent-status-item">' +
          '<span>' + (a.message?.fromName || 'Desconhecido') + '</span>' +
          '<span class="status-dot status-' + (a.message?.from === 'user' ? 'idle' : 'working') + '"></span>' +
        '</div>'
      ).join('');
  }

  _fmtActivity(a) {
    if (a.type === 'message') {
      const c = (a.message?.content || '').slice(0, 55);
      return '<b>' + (a.message?.fromName || '?') + '</b>: ' + c + (c.length >= 55 ? '…' : '');
    }
    return 'Atividade registrada';
  }

  // ─── Agents ────────────────────────────────────────────────────────────────

  async _loadAgents() {
    this.agents = await ipc('agent:getAll');
    document.getElementById('agents-grid').innerHTML = this.agents.map(a =>
      '<div class="agent-card" data-id="' + a.id + '">' +
        '<div class="agent-card-header">' +
          '<div class="agent-avatar-thumb">' + (a.name?.[0] || '?') + '</div>' +
          '<div>' +
            '<div class="agent-card-name">' + a.name + '</div>' +
            '<div class="agent-card-role">' + (a.role || '—') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="agent-tags">' +
          (a.department ? '<span class="tag">' + a.department + '</span>' : '') +
          (a.runtime    ? '<span class="tag">' + a.runtime    + '</span>' : '') +
          '<span class="tag status-tag-' + a.status + '">' + a.status + '</span>' +
        '</div>' +
      '</div>'
    ).join('');
  }

  // ─── Departments ───────────────────────────────────────────────────────────

  async _loadDepartments() {
    this.departments = await ipc('department:getAll');
    document.getElementById('departments-grid').innerHTML = this.departments.map(d =>
      '<div class="dept-card">' +
        '<div class="agent-card-name">' + (d.icon ? d.icon + ' ' : '') + d.name + '</div>' +
        '<div class="agent-card-role" style="margin-top:4px">' + (d.description || '') + '</div>' +
        '<div class="agent-tags" style="margin-top:10px">' +
          '<span class="tag">' + (d.roomType || 'generic') + '</span>' +
          '<span class="tag">' + (d.employeeCount || 0) + ' agentes</span>' +
        '</div>' +
      '</div>'
    ).join('');
  }

  // ─── Tasks ─────────────────────────────────────────────────────────────────

  async _loadTasks() {
    this.tasks = await ipc('task:getAll');
    const active = document.querySelector('.filter-btn.active');
    this._renderTasks(this.tasks, active?.dataset.filter || 'all');
  }

  _renderTasks(tasks, filter) {
    const filtered = filter === 'all' ? tasks : tasks.filter(t => t.status === filter);
    document.getElementById('tasks-list').innerHTML = filtered.map(t =>
      '<div class="task-item">' +
        '<div class="task-item-left">' +
          '<div class="task-bar priority-' + t.priority + '"></div>' +
          '<div>' +
            '<div class="task-title">' + t.title + '</div>' +
            '<div class="task-sub">' + (t.assignedTo || 'Sem responsável') + ' · ' + t.status + '</div>' +
          '</div>' +
        '</div>' +
        '<span class="tag">' + t.priority + '</span>' +
      '</div>'
    ).join('');
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

  // ─── Chat ──────────────────────────────────────────────────────────────────

  async _loadChat() {
    const msgs = await ipc('chat:getMessages', 'company-general');
    const c = document.getElementById('chat-messages');
    c.innerHTML = msgs.map(m =>
      '<div class="message ' + (m.isUser ? 'message-user' : (m.type === 'error' ? 'message-error' : 'message-agent')) + '">' +
        (!m.isUser ? '<div class="message-header">' + m.sender + '</div>' : '') +
        '<div class="message-content">' + m.content + '</div>' +
        '<div class="message-time">' + new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }) + '</div>' +
      '</div>'
    ).join('');
    c.scrollTop = c.scrollHeight;
  }

  async _sendChat() {
    const input   = document.getElementById('chat-input');
    const content = input.value.trim();
    if (!content) return;
    await ipc('chat:sendMessage', { content });
    input.value = '';
    setTimeout(() => this._loadChat(), 400);
  }

  // ─── Runtimes ──────────────────────────────────────────────────────────────

  async _loadRuntimes() {
    const rts = await ipc('runtime:detect');
    document.getElementById('runtimes-list').innerHTML = rts.map(rt =>
      '<div class="runtime-card">' +
        '<div class="runtime-info"><h4>' + rt.name + '</h4>' +
          '<div class="runtime-version">' + (rt.installed ? rt.version : 'Não instalado') + '</div>' +
        '</div>' +
        '<div class="runtime-state">' +
          '<span class="' + (rt.installed ? 'rt-installed' : 'rt-missing') + '">' +
            (rt.installed ? '✓ Instalado' : '✗ Ausente') +
          '</span>' +
          (!rt.installed && rt.installUrl
            ? '<a href="' + rt.installUrl + '" target="_blank" class="btn-primary" style="font-size:11px;padding:4px 10px;text-decoration:none">Instalar</a>'
            : '') +
        '</div>' +
      '</div>'
    ).join('');
  }

  // ─── Modals ────────────────────────────────────────────────────────────────

  _bindModals() {
    document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
      btn.addEventListener('click', () => this._hideModal());
    });
    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target.id === 'modal-overlay') this._hideModal();
    });
  }

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
      depts.map(d => '<option value="' + d.id + '">' + d.name + '</option>').join('');
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
    if (result.success) {
      this._hideModal();
      this._loadAgents();
      this._loadWorldData(); // refresh 3D world
    }
  }

  async _createDept() {
    const v = id => document.getElementById(id).value;
    const result = await ipc('department:create', {
      name:        v('dept-name'),
      description: v('dept-description'),
      roomType:    v('dept-room-type'),
    });
    if (result.success) {
      this._hideModal();
      this._loadDepartments();
      this._loadWorldData(); // refresh 3D world
    }
  }
}

document.addEventListener('DOMContentLoaded', () => { new CompanyLabUI(); });