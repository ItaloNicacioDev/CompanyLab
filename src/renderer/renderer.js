/**
 * renderer.js
 *
 * Controller da UI do CompanyLab.
 * Usa window.ipc() do preload.js e window.World2D do world2d.js.
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
    this._currentPanelAgentId   = null;
    this._currentPanelAgentName = null;

    this._initWorld();
    this._bindNav();
    this._bindGlobalActions();
    this._bindModals();
    this._bindFilterBtns();
    this._startPolling();
    this._bindLiveEvents();

    // Aplica nome/emoji/cor da empresa (se já tiver sido customizado)
    // assim que o app abre, não só quando a aba Configurações é aberta.
    ipc('company:get').then(company => this._applyCompanyBranding(company));
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

      // Atualizar status visual do agente no mundo 2D
      const statusMap = {
        'agent.working': 'working',
        'agent.idle': 'idle',
        'agent.blocked': 'blocked',
        'agent.error': 'error',
        'agent.meeting.started': 'meeting',
        'agent.meeting.ended': 'idle',
        'agent.message.sent': 'communicating',
        'agent.task.started': 'working',
        'agent.task.completed': 'completed',
      };
      const statusKey = statusMap[evt.type];
      if (statusKey && this.world) {
        this.world.setAgentStatus(evt.payload.agentId, statusKey);
      }
    });
  }

  // ─── 2D World ─────────────────────────────────────────────────────────────

  _initWorld() {
    const container = document.getElementById('world-canvas');
    if (!window.World2D || !container) return;

    this.world = new window.World2D(container, {
      onPointerLock: (locked) => {
        // 2D Office: update UI state when "entering"/interacting
        document.getElementById('app').classList.toggle('app-locked', locked);

        // Show/hide UI overlays (2D doesn't have crosshair/prompt in same way)
        document.getElementById('world-start').style.display = locked ? 'none' : 'flex';
        // No crosshair in 2D mode
        document.getElementById('crosshair').style.display = 'none';
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
          document.getElementById('current-view').textContent = '2D Office';
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
      office:'Office', dashboard:'Dashboard', agents:'Agentes',
      departments:'Departamentos', tasks:'Tarefas', chat:'Chat', runtimes:'Runtimes',
      settings:'Configurações',
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
    if (name === 'settings')    this._loadSettings();
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

    this._mention = { active: false, items: [], activeIndex: 0, start: -1 };

    const chatInput = document.getElementById('chat-input');
    chatInput.addEventListener('input', () => this._updateMentionPopup());
    chatInput.addEventListener('keydown', e => {
      if (this._mention.active && this._handleMentionKeydown(e)) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._sendChat(); }
    });
    chatInput.addEventListener('blur', () => {
      // pequeno atraso pra permitir o clique no item do popup antes de fechar
      setTimeout(() => this._closeMentionPopup(), 150);
    });
    document.getElementById('mention-popup').addEventListener('mousedown', (e) => e.preventDefault());

    // Agents
    document.getElementById('btn-create-agent').addEventListener('click', () => {
      this._loadDeptsForSelect();
      this._showModal('modal-create-agent');
    });
    document.getElementById('btn-save-agent').addEventListener('click', () => this._createAgent());

    // Avatar builder: mostra/esconde opções furry, e permite gerar uma
    // combinação de aparência aleatória com um clique (pedido: "escolher
    // uma build aleatória, entre: cabelo, pele, cor da pele, estilo de
    // cabelo, furry, não furry").
    document.getElementById('agent-furry')?.addEventListener('change', () => this._toggleFurryOptions());
    document.getElementById('btn-randomize-avatar')?.addEventListener('click', () => this._randomizeAvatar());

    // Departments
    document.getElementById('btn-create-dept').addEventListener('click', () => this._showModal('modal-create-dept'));
    document.getElementById('btn-save-dept').addEventListener('click',  () => this._createDept());

    // Settings
    document.getElementById('btn-save-settings')?.addEventListener('click', () => this._saveSettings());

    // Agent panel close
    document.getElementById('agent-panel-close')?.addEventListener('click', () => this._hideAgentPanel());

    // Demitir — pelo painel do boneco selecionado no escritório 2D
    document.getElementById('btn-ap-dismiss')?.addEventListener('click', () => {
      this._dismissAgent(this._currentPanelAgentId, this._currentPanelAgentName);
    });

    // Demitir — pelo botão em cada card na lista de Agentes (delegação,
    // já que os cards são recriados a cada _loadAgents())
    document.getElementById('agents-grid')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-dismiss-id]');
      if (!btn) return;
      e.stopPropagation();
      const agent = this.agents.find(a => a.id === btn.dataset.dismissId);
      this._dismissAgent(btn.dataset.dismissId, agent?.name);
    });

    // World start overlay — dispensa a dica de controles e ativa a interação
    // com o escritório 2D (sem Pointer Lock — seção 17/33 do spec de migração).
    document.getElementById('world-start').addEventListener('click', () => {
      if (this.world) this.world.requestEnter();
    });
  }

  // ─── Agent Panel ────────────────────────────────────────────────────────────

  _showAgentPanel(agent) {
    const panel = document.getElementById('agent-panel');
    panel.classList.remove('hidden');

    this._currentPanelAgentId   = agent.id;
    this._currentPanelAgentName = agent.name;

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
        '<div class="agent-card-footer">' +
          '<button type="button" class="agent-card-dismiss" data-dismiss-id="' + a.id + '">Demitir</button>' +
        '</div>' +
      '</div>'
    ).join('');
  }

  /**
   * Demite (exclui) um funcionário. Pedido do usuário: "quero também a
   * opção de excluir (demitir o funcionário)". O backend (agent:delete)
   * já existia pronto; isso aqui é a ponta de UI, chamada tanto pelo botão
   * no card da lista de Agentes quanto pelo painel do boneco no escritório 2D.
   */
  async _dismissAgent(agentId, agentName) {
    if (!agentId) return;
    const label = agentName ? `"${agentName}"` : 'este funcionário';
    const confirmed = window.confirm(`Tem certeza que quer demitir ${label}? Essa ação não pode ser desfeita.`);
    if (!confirmed) return;

    const result = await ipc('agent:delete', agentId);
    if (!result || result.success === false) {
      window.alert('Não foi possível demitir o funcionário. Tente novamente.');
      return;
    }

    // Some o boneco do escritório 2D e atualiza a lista/painel
    this._hideAgentPanel();
    if (this.currentView === 'agents') this._loadAgents();
    this._loadWorldData();
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

  // ─── @Menção de agentes no chat ──────────────────────────────────────────

  _mentionQueryAt(value, caret) {
    // Acha o "@algumaCoisa" que termina exatamente no cursor, sem espaço no meio.
    const uptoCaret = value.slice(0, caret);
    const at = uptoCaret.lastIndexOf('@');
    if (at === -1) return null;
    const between = uptoCaret.slice(at + 1);
    if (/\s/.test(between)) return null; // já saiu da palavra da menção
    return { start: at, query: between };
  }

  _updateMentionPopup() {
    const input = document.getElementById('chat-input');
    const match = this._mentionQueryAt(input.value, input.selectionStart);
    if (!match) { this._closeMentionPopup(); return; }

    const q = match.query.toLowerCase();
    const items = (this.agents || [])
      .filter(a => a.name && a.name.toLowerCase().includes(q))
      .sort((a, b) => {
        // prioriza quem começa com a query, depois ordem alfabética
        const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a.name.localeCompare(b.name);
      })
      .slice(0, 8);

    this._mention.active = true;
    this._mention.start = match.start;
    this._mention.items = items;
    this._mention.activeIndex = 0;
    this._renderMentionPopup();
  }

  _renderMentionPopup() {
    const popup = document.getElementById('mention-popup');
    const { items, activeIndex } = this._mention;
    const statusMeta = (window.CompanyLabWorld2D && window.CompanyLabWorld2D.STATUS_META) || {};

    if (!items.length) {
      popup.innerHTML = '<div class="mention-empty">Nenhum agente encontrado</div>';
      popup.classList.remove('hidden');
      return;
    }

    popup.innerHTML = items.map((a, i) => {
      const initials = (a.name || '?').trim().slice(0, 2).toUpperCase();
      const dotColor = (statusMeta[a.status] && statusMeta[a.status].color) || '#64748b';
      const avatarBg = this._colorForAgent(a);
      return (
        '<div class="mention-item' + (i === activeIndex ? ' active' : '') + '" data-index="' + i + '">' +
          '<div class="mention-avatar" style="background:' + avatarBg + '">' + initials + '</div>' +
          '<span class="mention-name">' + a.name + '</span>' +
          '<span class="mention-status-dot" style="color:' + dotColor + ';background:' + dotColor + '"></span>' +
          '<span class="mention-dept">' + (a.department || '') + '</span>' +
        '</div>'
      );
    }).join('');

    popup.classList.remove('hidden');
    popup.querySelectorAll('.mention-item').forEach(el => {
      el.addEventListener('click', () => this._selectMention(parseInt(el.dataset.index, 10)));
    });
  }

  _colorForAgent(agent) {
    // Usa a cor de destaque do departamento se existir; senão gera uma cor estável a partir do id.
    const dept = (this.departments || []).find(d => d.id === agent.departmentId);
    if (dept && dept.accentColor) return dept.accentColor;
    let hash = 0;
    const s = String(agent.id || agent.name || '');
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    return `hsl(${hash % 360}, 65%, 55%)`;
  }

  _handleMentionKeydown(e) {
    const { items } = this._mention;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._mention.activeIndex = (this._mention.activeIndex + 1) % Math.max(items.length, 1);
      this._renderMentionPopup();
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._mention.activeIndex = (this._mention.activeIndex - 1 + items.length) % Math.max(items.length, 1);
      this._renderMentionPopup();
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (!items.length) { this._closeMentionPopup(); return false; }
      e.preventDefault();
      this._selectMention(this._mention.activeIndex);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      this._closeMentionPopup();
      return true;
    }
    return false;
  }

  _selectMention(index) {
    const agent = this._mention.items[index];
    if (!agent) return;
    const input = document.getElementById('chat-input');
    const caret = input.selectionStart;
    const before = input.value.slice(0, this._mention.start);
    const after = input.value.slice(caret);
    // nomes com espaço quebrariam a detecção de @menção no backend (extractMentions),
    // então usamos uma versão "colada" do nome, igual Slack/Discord fazem por trás dos panos.
    const safeName = agent.name.replace(/\s+/g, '');
    const insertion = '@' + safeName + ' ';
    input.value = before + insertion + after;
    const newCaret = before.length + insertion.length;
    input.setSelectionRange(newCaret, newCaret);
    input.focus();
    this._closeMentionPopup();
  }

  _closeMentionPopup() {
    this._mention.active = false;
    this._mention.items = [];
    document.getElementById('mention-popup').classList.add('hidden');
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
    this._closeMentionPopup();
    await ipc('chat:sendMessage', { content });
    input.value = '';
    setTimeout(() => this._loadChat(), 400);
  }

  // ─── Configurações (personalização opcional da empresa) ────────────────────

  async _loadSettings() {
    const company = await ipc('company:get');
    if (!company) return;

    document.getElementById('settings-emoji').value = company.emoji || '';
    document.getElementById('settings-name').value = company.name || '';
    document.getElementById('settings-tagline').value = company.tagline || '';
    document.getElementById('settings-description').value = company.description || '';
    document.getElementById('settings-accent-color').value = company.accentColor || '#3b82f6';
  }

  async _saveSettings() {
    const updates = {
      emoji: document.getElementById('settings-emoji').value.trim() || '🏢',
      name: document.getElementById('settings-name').value.trim(),
      tagline: document.getElementById('settings-tagline').value.trim(),
      description: document.getElementById('settings-description').value.trim(),
      accentColor: document.getElementById('settings-accent-color').value,
    };

    const result = await ipc('company:update', updates);
    if (result?.success) {
      this._applyCompanyBranding(result.company);
      const msg = document.getElementById('settings-saved-msg');
      msg.textContent = 'Salvo!';
      msg.classList.add('visible');
      setTimeout(() => msg.classList.remove('visible'), 2000);
    }
  }

  /** Aplica emoji/nome/cor da empresa na sidebar e no tema — chamado no boot e após salvar. */
  _applyCompanyBranding(company) {
    if (!company) return;
    const markEl = document.getElementById('app-logo-mark');
    const textEl = document.getElementById('app-logo-text');
    if (markEl) markEl.textContent = company.emoji || 'CL';
    if (textEl) textEl.textContent = company.name || 'CompanyLab';
    if (company.accentColor) {
      document.documentElement.style.setProperty('--accent', company.accentColor);
    }
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
      avatar:      JSON.stringify(this._collectAvatarConfig()),
    });
    if (result.success) {
      this._hideModal();
      this._loadAgents();
      this._loadWorldData(); // refresh 2D world
    }
  }

  // ─── Boneco / avatar (personalização opcional do agente) ───────────────────

  _toggleFurryOptions() {
    const isFurry = document.getElementById('agent-furry').checked;
    document.getElementById('agent-furry-options')?.classList.toggle('hidden', !isFurry);
  }

  _collectAvatarConfig() {
    const v = id => document.getElementById(id)?.value;
    return {
      skinColor: v('agent-skin-color') || '#f1c27d',
      hairColor: v('agent-hair-color') || '#2d1b0e',
      hairStyle: v('agent-hair-style') || 'short',
      outfitColor: v('agent-outfit-color') || '#3b82f6',
      furry:     !!document.getElementById('agent-furry')?.checked,
      furSpecies: v('agent-fur-species') || 'fox',
      furColor:  v('agent-fur-color') || '#d97706',
    };
  }

  /** Sorteia uma combinação inteira de aparência e aplica nos campos do modal. */
  _randomizeAvatar() {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];

    const skinTones = ['#f1c27d', '#ffdbac', '#e0ac69', '#c68642', '#8d5524', '#4a2c14', '#f5cba7'];
    const hairColors = ['#2d1b0e', '#0a0a0a', '#6b4423', '#c99a3f', '#b0b0b0', '#8b0000', '#3b2e5a'];
    const hairStyles = ['bald', 'short', 'long', 'mohawk', 'bun'];
    const outfitColors = ['#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#0f172a', '#84cc16', '#f97316'];
    const furSpecies = ['fox', 'wolf', 'cat', 'rabbit'];
    const furColors = ['#d97706', '#78716c', '#ffffff', '#1e293b', '#a16207', '#f5f5f4'];

    document.getElementById('agent-skin-color').value = pick(skinTones);
    document.getElementById('agent-hair-color').value = pick(hairColors);
    document.getElementById('agent-hair-style').value = pick(hairStyles);
    document.getElementById('agent-outfit-color').value = pick(outfitColors);

    const isFurry = Math.random() < 0.5;
    document.getElementById('agent-furry').checked = isFurry;
    document.getElementById('agent-fur-species').value = pick(furSpecies);
    document.getElementById('agent-fur-color').value = pick(furColors);
    this._toggleFurryOptions();
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
      this._loadWorldData(); // refresh 2D world
    }
  }
}

document.addEventListener('DOMContentLoaded', () => { new CompanyLabUI(); });