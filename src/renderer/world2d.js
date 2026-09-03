/**
 * world2d.js — CompanyLab 2D World Engine
 * 
 * Migração do mundo 3D para 2D Canvas.
 * Mantém API pública idêntica ao World 3D:
 *   - new World2D(container, callbacks)
 *   - world2d.populate(departments, agents)
 *   - world2d.setPassive(value)
 *   - world2d.requestEnter()
 *   - world2d.destroy()
 * 
 * Visuais:
 * - Renderização Canvas 2D
 * - Salas como retângulos 2D com decoração
 * - Agentes como sprites 2D coloridos com indicação de status
 * - Câmera top-down com pan e zoom
 * - Clique/hover em agente dispara callbacks
 */

 'use strict';

 const STATUS_COLORS = {
   idle:    '#64748b',
   working: '#22c55e',
   communicating: '#3b82f6',
   meeting: '#8b5cf6',
   waiting: '#f59e0b',
   blocked: '#ef4444',
   error:   '#dc2626',
   completed: '#06b6d4',
 };

 const DEPT_COLORS = [
   '#3b82f6', // development - blue
   '#8b5cf6', // marketing - purple
   '#22c55e', // finance - green
   '#f59e0b', // generic - amber
   '#ef4444', // error - red
   '#06b6d4', // completed - cyan
   '#ec4899', // pink
   '#84cc16', // lime
 ];

 /**
  * @param {HTMLElement} container
  * @param {{onAgentSelect, onPointerLock, onRoomEnter, onRoomExit, onPrompt}} cb
  */
 class World2D {
   constructor(container, cb = {}) {
     this.container = container;
     this.cb = cb;
     this.departments = [];
     this.agents = [];
     this.rooms = [];
     this.agentObjs = [];
     this.labelLayer = null;

     // 2D camera state
     this.camera = { x: 0, y: 0, scale: 1 };

     // Interaction state
     this.isLocked = false;
     this.keys = {};
     this.gazedAgent = null;
     this.gazeTimer = 0;
     this.currentRoom = null;
     this.nearRoom = null;
     this._promptCurrent = null;

     // Three.js references kept for compatibility (but not used for rendering)
     this.scene = null;
     this.camera3d = null;
     this.renderer3d = null;

     this._initCanvas();
     this._initEventListeners();
     this._animate();
   }

   _initCanvas() {
     // Clear container and create 2D canvas
     this.container.innerHTML = '';

     this.canvas = document.createElement('canvas');
     this.canvas.style.cssText = 'position: fixed; inset: 0; display: block;';
     this.container.appendChild(this.canvas);

     this.ctx = this.canvas.getContext('2d');
     this._resizeCanvas();

     window.addEventListener('resize', () => this._resizeCanvas());
   }

   _resizeCanvas() {
     const rect = this.container.getBoundingClientRect();
     this.canvas.width = rect.width;
     this.canvas.height = rect.height;
   }

   _initEventListeners() {
     // Click on canvas for interaction
     this.canvas.addEventListener('click', (e) => this._onCanvasClick(e));
     this.canvas.addEventListener('mousemove', (e) => this._onCanvasMove(e));
     this.canvas.addEventListener('mouseleave', () => this._onCanvasLeave());

     // Pointer lock / FPS mode compatibility
     this.canvas.addEventListener('pointerlockchange', () => {
       this.isLocked = document.pointerLockElement === this.canvas;
       this.cb.onPointerLock?.(this.isLocked);
     });

     this.canvas.addEventListener('click', () => {
       if (!this.isLocked) this.canvas.requestPointerLock();
     });
   }

   _onCanvasClick(e) {
     const rect = this.canvas.getBoundingClientRect();
     const x = e.clientX - rect.left;
     const y = e.clientY - rect.top;

     // Convert canvas coordinates to world coordinates considering camera
     const wx = (x - this.canvas.width / 2) / (this.canvas.width / 2) * this.camera.scale + this.camera.x;
     const wy = (this.canvas.height / 2 - y) / (this.canvas.height / 2) * this.camera.scale + this.camera.y;

     // Check if clicked on an agent
     const agent = this._pointInAgent(wx, wy);
     if (agent) {
       this.cb.onAgentSelect?.(agent);
       return;
     }

     // Check if clicked on a room
     const room = this._pointInRoom(wx, wy);
     if (room) {
       this.cb.onRoomEnter?.(room);
       return;
     }

     // Hide prompt if clicking elsewhere
     this._setPrompt(null);
   }

   _onCanvasMove(e) {
     const rect = this.canvas.getBoundingClientRect();
     const x = e.clientX - rect.left;
     const y = e.clientY - rect.top;

     // Check for agent hover
     const agent = this._pointInAgent(
       (x - this.canvas.width / 2) / (this.canvas.width / 2) * this.camera.scale + this.camera.x,
       (this.canvas.height / 2 - y) / (this.canvas.height / 2) * this.camera.scale + this.camera.y
     );

     if (agent) {
       this.gazedAgent = agent;
       this.gazeTimer += 16 / 1000; // approx delta
       if (this.gazeTimer >= 0.5) {
         this.cb.onPrompt?.('[E] Ver ' + agent.name);
       }
     } else {
       if (this.gazedAgent) {
         this.gazedAgent = null;
         this.gazeTimer = 0;
         this._setPrompt(this.nearRoom ? '[E] Entrar em ' + this.nearRoom : null);
       }
     }
   }

   _onCanvasLeave() {
     this.gazedAgent = null;
     this.gazeTimer = 0;
     this._setPrompt(this.nearRoom ? '[E] Entrar em ' + this.nearRoom : null);
   }

   _pointInAgent(wx, wy) {
     for (const ao of this.agentObjs) {
       // Simple point-in-rectangle check for agent visual
       const bounds = ao.spriteBounds;
       if (bounds && wx >= bounds.x && wx <= bounds.x + bounds.width && wy >= bounds.y && wy <= bounds.y + bounds.height) {
         return ao.agentData;
       }
     }
     return null;
   }

   _pointInRoom(wx, wy) {
     for (const room of this.rooms) {
       // Check if world coords are within room bounds
       const roomPos = room.position || { x: 0, y: 0 };
       const footprint = room.userData?.footprint;
       if (footprint) {
         if (wx >= roomPos.x - footprint.width / 2 && wx <= roomPos.x + footprint.width / 2 &&
             wy >= roomPos.y - footprint.depth / 2 && wy <= roomPos.y + footprint.depth / 2) {
           return room;
         }
       }
     }
     return null;
   }

   _setPrompt(text) {
     const el = document.getElementById('world-prompt');
     if (text) {
       el.textContent = text;
       el.classList.remove('hidden');
     } else {
       el.classList.add('hidden');
     }
     this._promptCurrent = text;
   }

   // =========================================================
   // Populate: build rooms and agents from department/agent data
   // =========================================================

   populate(departments, agents) {
     this.departments = departments || [];
     this.agents = agents || [];

     // Build rooms
     this.rooms = [];
     this._buildRooms();

     // Build agents
     this.agentObjs = [];
     this._buildAgents();

     this._animate();
   }

   _buildRooms() {
     const n = this.departments.length;
     if (n === 0) return;

     this.departments.forEach((dept, i) => {
       const color = DEPT_COLORS[i % DEPT_COLORS.length];
       const accentColor = dept.accentColor || color;

       // Compute room position (arranged horizontally)
       const roomWidth = (dept.userData?.footprint?.width || 200) + 20;
       const roomHeight = (dept.userData?.footprint?.depth || 150) + 20;
       const x = i * (roomWidth + 20) - (n * roomWidth) / 2 + roomWidth / 2;
       const y = 0;

       const room = {
         deptId: dept.id,
         deptName: dept.name,
         color,
         position: { x, y },
         footprint: { width: roomWidth, depth: roomHeight },
         userData: {
           departmentId: dept.id,
           departmentName: dept.name,
           accentColor,
         },
       };

       this.rooms.push(room);
     });

     // Reset prompt state
     this._setPrompt(null);
   }

   _buildAgents() {
     // Group agents by department
     const byDept = {};
     this.agents.forEach(a => {
       const key = a.departmentId || '__none__';
       (byDept[key] = byDept[key] || []).push(a);
     });

     // Position rooms and agents
     this.rooms.forEach((room) => {
       const dept = this.departments.find(d => d.id === room.deptId);
       const agentsInDept = byDept[room.deptId] || [];

       // Simple horizontal positioning within room
       const slotWidth = room.footprint.width / Math.max(agentsInDept.length, 1);
       agentsInDept.forEach((agent, i) => {
         const x = room.position.x + (i - (agentsInDept.length - 1) / 2) * slotWidth;
         const y = room.position.y + 30; // slightly inside room

         const agentObj = {
           agentData: agent,
           spriteBounds: { x, y, width: 20, height: 30 },
           status: agent.status || 'idle',
         };

         this.agentObjs.push(agentObj);
       });
     });

     this._animate();
   }

   // =========================================================
   // Status management
   // =========================================================

   setPassive(value) {
     this._isPassive = !!value;
     // Update UI class if needed
     const app = document.getElementById('app');
     if (app) {
       app.classList.toggle('app-passive', value);
     }
     this.cb.onPointerLock?.(value ? false : true);
   }

   requestEnter() {
     // In 2D, "enter" just means exiting passive mode and enabling interaction
     this.setPassive(false);
     this.isLocked = true;
     this.cb.onPointerLock?.(true);

     // Hide the start overlay
     const worldStart = document.getElementById('world-start');
     const crosshair = document.getElementById('crosshair');
     if (worldStart) worldStart.style.display = 'none';
     if (crosshair) crosshair.style.display = 'flex';

     // Show prompt area can still receive events
     this._setPrompt(null);
   }

   // -----------------------------------------------------------------
   // Agent status update (called from handleCompanyEvent / IPC)
   // -----------------------------------------------------------------

   setAgentStatus(agentId, status) {
     const agentObj = this.agentObjs.find(a => a.agentData.id === agentId);
     if (!agentObj) return;

     agentObj.status = status;

     // Update visual - change sprite color/appearance
     this._updateAgentVisual(agentObj);
   }

   _updateAgentVisual(agentObj) {
     const statusColor = STATUS_COLORS[agentObj.status] || STATUS_COLORS.idle;
     const el = document.getElementById('agent-sprite-' + agentObj.agentData.id);
     if (el) {
       el.style.fill = statusColor;
       el.style.stroke = statusColor;
     }
   }

   // -----------------------------------------------------------------
   // Main animation loop
   // -----------------------------------------------------------------

   _animate() {
     this._raf = requestAnimationFrame(() => this._animate());
     this._render();
   }

   _render() {
     // Clear canvas
     this.ctx.fillStyle = '#0b1120';
     this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

     // Draw rooms
     this._drawRooms();

     // Draw agents
     this._drawAgents();

     // Draw UI prompts (already handled by DOM)
   }

   _drawRooms() {
     this.ctx.save();
     this.ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
     this.ctx.scale(this.camera.scale, this.camera.scale);
     this.ctx.translate(-this.canvas.width / 2, -this.canvas.height / 2);

     this.rooms.forEach((room) => {
       const pos = room.position;
       const footprint = room.footprint;

       // Draw room floor
       this.ctx.fillStyle = room.color;
       this.ctx.fillRect(pos.x - footprint.width / 2, pos.y - footprint.depth / 2, footprint.width, footprint.depth);

       // Draw room border/accent
       this.ctx.strokeStyle = room.userData?.accentColor || '#64748b';
       this.ctx.lineWidth = 2;
       this.ctx.strokeRect(pos.x - footprint.width / 2, pos.y - footprint.depth / 2, footprint.width, footprint.depth);

       // Draw department name
       this.ctx.fillStyle = '#e2e8f0';
       this.ctx.font = 'bold 14px Inter, system-ui, sans-serif';
       this.ctx.textAlign = 'center';
       this.ctx.fillText(room.deptName, pos.x, pos.y - footprint.depth / 2 - 10);
     });

     this.ctx.restore();
   }

   _drawAgents() {
     this.ctx.save();
     this.ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
     this.ctx.scale(this.camera.scale, this.camera.scale);
     this.ctx.translate(-this.canvas.width / 2, -this.canvas.height / 2);

     this.agentObjs.forEach((ao) => {
       const { agentData, spriteBounds, status } = ao;
       const statusColor = STATUS_COLORS[status] || STATUS_COLORS.idle;

       // Draw agent sprite (colored rectangle with status color)
       const x = spriteBounds.x;
       const y = spriteBounds.y;
       const w = spriteBounds.width;
       const h = spriteBounds.height;

       // Body color based on department/avatar config
       const avatarConfig = this._parseAvatarConfig(agentData);
       const bodyColor = avatarConfig.outfitColor || statusColor;

       // Draw agent rectangle
       this.ctx.fillStyle = bodyColor;
       this.ctx.fillRect(x, y, w, h);

       // Draw status ring/outline
       this.ctx.fillStyle = statusColor;
       this.ctx.globalAlpha = 0.5;
       this.ctx.fillRect(x + 2, y + 2, w - 4, h / 3);
       this.ctx.globalAlpha = 1.0;

       // Draw name
       this.ctx.fillStyle = '#ffffff';
       this.ctx.font = '10px Inter, system-ui, sans-serif';
       this.ctx.textAlign = 'center';
       this.ctx.fillText(agentData.name || '—', x + w / 2, y + h + 14);

       // Draw status label
       this.ctx.fillStyle = '#ffffff';
       this.ctx.font = 'bold 10px Inter, system-ui, sans-serif';
       this.ctx.textAlign = 'center';
       this.ctx.fillText(status, x + w / 2, y + h + 28);
     });

     this.ctx.restore();
   }

   _parseAvatarConfig(agent) {
     let cfg = {};
     if (agent.avatar) {
       try { cfg = JSON.parse(agent.avatar); } catch { cfg = {}; }
     }
     return {
       skinColor: cfg.skinColor || '#f1c27d',
       hairColor: cfg.hairColor || '#2d1b0e',
       hairStyle: cfg.hairStyle || 'short',
       outfitColor: cfg.outfitColor || '#3b82f6',
       furry: !!cfg.furry,
       furSpecies: cfg.furSpecies || 'fox',
       furColor: cfg.furColor || '#d97706',
     };
   }

   // =========================================================
   // Destroy / cleanup
   // =========================================================

   destroy() {
     if (this._raf) cancelAnimationFrame(this._raf);
     if (this.canvas && this.canvas.parentNode) {
       this.canvas.parentNode.removeChild(this.canvas);
     }
     window.removeEventListener('resize', this._resizeCanvas);
   }
 }

 window.World2D = World2D;
module.exports = { World2D };