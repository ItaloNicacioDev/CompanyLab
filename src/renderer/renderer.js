/**
 * CompanyLab Renderer Process
 * UI Controller - connects to main process via IPC
 */

const { ipcRenderer } = require('electron');

class CompanyLabUI {
  constructor() {
    this.currentView = 'dashboard';
    this.agents = [];
    this.departments = [];
    this.tasks = [];
    this.messages = [];
    this.setupEventListeners();
    this.setupNavigation();
    this.setupModals();
    this.startDataPolling();
  }

  setupEventListeners() {
    // Real-time events from main process
    ipcRenderer.on('event', (event, data) => {
      this.handleRealtimeEvent(data);
    });

    // Chat input
    document.getElementById('btn-send').addEventListener('click', () => this.sendChatMessage());
    document.getElementById('chat-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendChatMessage();
    });

    // New objective
    document.getElementById('new-objective').addEventListener('click', () => {
      this.showModal('modal-objective');
    });
    document.getElementById('btn-send-objective').addEventListener('click', () => {
      const objective = document.getElementById('objective-text').value;
      if (objective) {
        ipcRenderer.invoke('chat:sendMessage', { content: objective });
        this.hideModal('modal-objective');
        document.getElementById('objective-text').value = '';
        this.switchView('chat');
      }
    });

    // Create agent
    document.getElementById('btn-create-agent').addEventListener('click', () => {
      this.loadDepartmentsForSelect();
      this.showModal('modal-create-agent');
    });
    document.getElementById('btn-save-agent').addEventListener('click', () => this.createAgent());

    // Create department
    document.getElementById('btn-create-dept').addEventListener('click', () => {
      this.showModal('modal-create-dept');
    });
    document.getElementById('btn-save-dept').addEventListener('click', () => this.createDepartment());

    // Pause all
    document.getElementById('pause-all').addEventListener('click', () => {
      // Implementation for pausing all agents
    });
  }

  setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const view = item.dataset.view;
        this.switchView(view);
      });
    });
  }

  setupModals() {
    document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal');
        this.hideModal(modal.id);
      });
    });

    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') {
        document.getElementById('modal-overlay').classList.remove('active');
      }
    });
  }

  switchView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    const viewEl = document.getElementById(`view-${viewName}`);
    if (viewEl) viewEl.classList.add('active');
    
    const navEl = document.querySelector(`[data-view="${viewName}"]`);
    if (navEl) navEl.classList.add('active');
    
    document.getElementById('current-view').textContent = 
      viewName.charAt(0).toUpperCase() + viewName.slice(1).replace('-', ' ');
    
    this.currentView = viewName;
    
    // Load view-specific data
    if (viewName === 'agents') this.loadAgents();
    if (viewName === 'departments') this.loadDepartments();
    if (viewName === 'tasks') this.loadTasks();
    if (viewName === 'chat') this.loadChat();
    if (viewName === 'runtimes') this.loadRuntimes();
    if (viewName === '3d-office') this.init3DWorld();
  }

  async startDataPolling() {
    // Initial load
    this.loadDashboard();
    
    // Poll every 2 seconds
    setInterval(() => {
      if (this.currentView === 'dashboard') this.loadDashboard();
      if (this.currentView === 'agents') this.loadAgents();
      if (this.currentView === 'tasks') this.loadTasks();
    }, 2000);
  }

  async loadDashboard() {
    const data = await ipcRenderer.invoke('dashboard:getData');
    
    document.getElementById('stat-agents').textContent = data.activeAgents;
    document.getElementById('stat-tasks').textContent = data.inProgressTasks;
    document.getElementById('stat-projects').textContent = data.projects;
    document.getElementById('stat-departments').textContent = data.departments;

    // Activity feed
    const feed = document.getElementById('activity-feed');
    feed.innerHTML = data.recentActivity.map(a => `
      <div class="activity-item">
        <span>${this.getActivityIcon(a.type)}</span>
        <div>
          <div>${this.formatActivity(a)}</div>
          <div class="message-time">${new Date(a.timestamp).toLocaleTimeString()}</div>
        </div>
      </div>
    `).join('');

    // Agent status
    const statusList = document.getElementById('agent-status-list');
    statusList.innerHTML = data.recentActivity
      .filter(a => a.type === 'message')
      .slice(0, 5)
      .map(a => `
        <div class="agent-status-item">
          <span>${a.message?.fromName || 'Unknown'}</span>
          <span class="status-dot status-${a.message?.from === 'user' ? 'idle' : 'working'}"></span>
        </div>
      `).join('');
  }

  async loadAgents() {
    const agents = await ipcRenderer.invoke('agent:getAll');
    this.agents = agents;
    
    const grid = document.getElementById('agents-grid');
    grid.innerHTML = agents.map(agent => `
      <div class="agent-card" data-id="${agent.id}">
        <div class="agent-card-header">
          <img class="agent-avatar" src="${agent.avatar}" alt="${agent.name}" 
               onerror="this.src='default-avatar.png'">
          <div class="agent-info">
            <h4>${agent.name}</h4>
            <span>${agent.role}</span>
          </div>
        </div>
        <div class="agent-meta">
          <span class="tag">${agent.department || 'No Dept'}</span>
          <span class="tag">${agent.runtime}</span>
          <span class="tag">${agent.status}</span>
        </div>
      </div>
    `).join('');
  }

  async loadDepartments() {
    const depts = await ipcRenderer.invoke('department:getAll');
    this.departments = depts;
    
    const grid = document.getElementById('departments-grid');
    grid.innerHTML = depts.map(dept => `
      <div class="dept-card">
        <h4>${dept.name}</h4>
        <p style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 5px;">
          ${dept.employees?.length || 0} employees
        </p>
        <span class="tag" style="margin-top: 10px; display: inline-block;">
          ${dept.roomType}
        </span>
      </div>
    `).join('');
  }

  async loadTasks() {
    const tasks = await ipcRenderer.invoke('task:getAll');
    this.tasks = tasks;
    
    const list = document.getElementById('tasks-list');
    list.innerHTML = tasks.map(task => `
      <div class="task-item">
        <div style="display: flex; align-items: center;">
          <div class="task-priority priority-${task.priority}"></div>
          <div>
            <div style="font-weight: 600;">${task.title}</div>
            <div style="color: var(--text-secondary); font-size: 0.85rem;">
              Assigned to: ${task.assignedTo || 'Unassigned'} | Status: ${task.status}
            </div>
          </div>
        </div>
        <span class="tag">${task.status}</span>
      </div>
    `).join('');
  }

  async loadChat() {
    const messages = await ipcRenderer.invoke('chat:getMessages', 'company-general');
    this.renderMessages(messages);
  }

  renderMessages(messages) {
    const container = document.getElementById('chat-messages');
    container.innerHTML = messages.map(msg => `
      <div class="message ${msg.isUser ? 'message-user' : 'message-agent'}">
        <div class="message-header">
          ${!msg.isUser ? `<img class="message-avatar" src="${msg.avatar}" onerror="this.style.display='none'">` : ''}
          <span>${msg.sender}</span>
        </div>
        <div class="message-content">${msg.content}</div>
        <div class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</div>
      </div>
    `).join('');
    
    container.scrollTop = container.scrollHeight;
  }

  async sendChatMessage() {
    const input = document.getElementById('chat-input');
    const content = input.value.trim();
    if (!content) return;
    
    await ipcRenderer.invoke('chat:sendMessage', { content });
    input.value = '';
    
    // Reload chat
    setTimeout(() => this.loadChat(), 500);
  }

  async loadRuntimes() {
    const runtimes = await ipcRenderer.invoke('runtime:detect');
    const list = document.getElementById('runtimes-list');
    
    list.innerHTML = runtimes.map(rt => `
      <div class="runtime-card">
        <div>
          <h4>${rt.name}</h4>
          <div style="color: var(--text-secondary); font-size: 0.85rem;">
            ${rt.installed ? `Version: ${rt.version}` : 'Not installed'}
          </div>
        </div>
        <div class="runtime-status">
          <span class="${rt.installed ? 'runtime-installed' : 'runtime-missing'}">
            ${rt.installed ? '✓ Installed' : '✗ Not Installed'}
          </span>
          ${!rt.installed ? '<button class="btn-primary" style="padding: 5px 12px; font-size: 0.8rem;">Install</button>' : ''}
        </div>
      </div>
    `).join('');
  }

  async loadDepartmentsForSelect() {
    const depts = await ipcRenderer.invoke('department:getAll');
    const select = document.getElementById('agent-department');
    select.innerHTML = depts.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
  }

  async createAgent() {
    const config = {
      name: document.getElementById('agent-name').value,
      role: document.getElementById('agent-role').value,
      department: document.getElementById('agent-department').value,
      runtime: document.getElementById('agent-runtime').value,
      personality: { description: document.getElementById('agent-personality').value },
      skills: document.getElementById('agent-skills').value.split(',').map(s => s.trim()).filter(Boolean),
      isCEO: document.getElementById('agent-is-ceo').checked
    };
    
    const result = await ipcRenderer.invoke('agent:create', config);
    if (result.success) {
      this.hideModal('modal-create-agent');
      this.loadAgents();
    }
  }

  async createDepartment() {
    const config = {
      id: `dept_${Date.now()}`,
      name: document.getElementById('dept-name').value,
      description: document.getElementById('dept-description').value,
      roomType: document.getElementById('dept-room-type').value
    };
    
    await ipcRenderer.invoke('department:create', config);
    this.hideModal('modal-create-dept');
    this.loadDepartments();
  }

  init3DWorld() {
    // Initialize Three.js scene
    const container = document.getElementById('three-canvas-container');
    container.innerHTML = '';
    
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    
    const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 10, 20);
    
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 2);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(10, 20, 10);
    scene.add(directionalLight);
    
    // Floor
    const floorGeometry = new THREE.PlaneGeometry(50, 50);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x1e293b });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    
    // Grid
    const gridHelper = new THREE.GridHelper(50, 50, 0x334155, 0x1e293b);
    scene.add(gridHelper);
    
    // Example room
    this.createRoom3D(scene, 'development', { x: -10, z: -10 });
    this.createRoom3D(scene, 'marketing', { x: 10, z: -10 });
    
    // Animate
    const animate = () => {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();
    
    // Handle resize
    window.addEventListener('resize', () => {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    });
  }

  createRoom3D(scene, type, position) {
    const roomGeometry = new THREE.BoxGeometry(8, 4, 8);
    const roomMaterial = new THREE.MeshStandardMaterial({ 
      color: type === 'development' ? 0x3b82f6 : 0xf59e0b,
      transparent: true,
      opacity: 0.3
    });
    const room = new THREE.Mesh(roomGeometry, roomMaterial);
    room.position.set(position.x, 2, position.z);
    scene.add(room);
    
    // Label
    // In production, use TextGeometry or CSS2DRenderer
  }

  handleRealtimeEvent(data) {
    // Update UI based on real-time events
    if (data.type === 'agent.status.changed') {
      if (this.currentView === 'agents') this.loadAgents();
      if (this.currentView === 'dashboard') this.loadDashboard();
    }
    
    if (data.type === 'agent.message.sent') {
      if (this.currentView === 'chat') this.loadChat();
      // Update badge
      const badge = document.getElementById('chat-badge');
      badge.textContent = parseInt(badge.textContent) + 1;
    }
  }

  showModal(id) {
    document.getElementById('modal-overlay').classList.add('active');
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    document.getElementById(id).style.display = 'block';
  }

  hideModal(id) {
    document.getElementById('modal-overlay').classList.remove('active');
  }

  getActivityIcon(type) {
    const icons = { message: '💬', task: '✅', agent: '👤', system: '⚙️' };
    return icons[type] || '•';
  }

  formatActivity(activity) {
    if (activity.type === 'message') {
      return `${activity.message?.fromName}: ${activity.message?.content?.substring(0, 50)}...`;
    }
    return 'Activity occurred';
  }
}

// Initialize
new CompanyLabUI();