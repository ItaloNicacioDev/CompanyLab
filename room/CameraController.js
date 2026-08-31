/**
 * CameraController.js - VERSÃO CORRIGIDA
 *
 * Controle de câmera livre em primeira pessoa: WASD (ou setas) pra
 * andar, mouse pra olhar em volta (via Pointer Lock API). É o "modo
 * passeio" do escritório virtual — o usuário anda até a sala de um
 * departamento (as salas têm a frente aberta, ver layoutUtils.js) e o
 * SceneManager detecta a entrada sozinho, sem precisar de nenhum botão
 * "entrar na sala".
 *
 * MELHORIAS:
 * - Força o canvas a receber foco
 * - Usa capture phase para listeners globais (captura em qualquer lugar)
 * - Adiciona suporte para liberar pointer lock com ESC
 * - Adiciona feedback visual do pointer lock
 * - Remove ambiguidades entre listeners de window vs document
 */

const THREE = require("three");

const MOVE_SPEED = 4.5; // unidades de mundo por segundo
const EYE_HEIGHT = 1.7; // altura da câmera, tipo "altura dos olhos" de uma pessoa
const LOOK_SENSITIVITY = 0.005; // Aumentado para melhor feedback
const MAX_PITCH = Math.PI / 2 - 0.05; // não deixa olhar 100% pra cima/baixo (evita virar de cabeça pra baixo)
const WORLD_BOUNDARY = 200; // não deixa "andar" infinitamente pro vazio fora do escritório

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

class CameraController {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} domElement - o <canvas> do renderer (recebe os cliques/pointer lock)
   */
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;

    this.enabled = false;
    this.yaw = 0;
    this.pitch = 0;

    /** @type {Set<string>} códigos de tecla (event.code) atualmente pressionados */
    this._keys = new Set();

    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._move = new THREE.Vector3();

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onClick = this._onClick.bind(this);
    this._onEscapeKey = this._onEscapeKey.bind(this);
    this._onPointerlockchange = this._onPointerlockchange.bind(this);
  }

  /**
   * Ativa o modo passeio, teleportando a câmera pro ponto de partida.
   * @param {{x: number, z: number}} [startPosition]
   */
  enable(startPosition = { x: 0, z: 0 }) {
    this.enabled = true;
    this.camera.rotation.order = "YXZ"; // yaw (Y) fora, pitch (X) dentro — evita "roll" indesejado
    this.camera.position.set(startPosition.x, EYE_HEIGHT, startPosition.z);
    this.yaw = 0;
    this.pitch = 0;
    this._applyRotation();

    if (typeof window === "undefined") return; // ambiente sem DOM (testes) — só a matemática funciona

    // MELHORIA 1: Força o canvas a receber foco para capturar eventos de teclado
    this.domElement.focus();
    
    // MELHORIA 2: Usa capture phase (true) para capturar eventos em qualquer lugar
    // Isso evita que outros listeners absorvam os eventos antes
    window.addEventListener("keydown", this._onKeyDown, true);
    window.addEventListener("keyup", this._onKeyUp, true);
    
    // Listeners de MOUSE direto no canvas (não em window/document)
    this.domElement.addEventListener("mousemove", this._onMouseMove, false);
    this.domElement.addEventListener("click", this._onClick, false);
    
    // MELHORIA 3: Escuta mudanças no pointer lock para feedback visual
    document.addEventListener("pointerlockchange", this._onPointerlockchange);
    
    // MELHORIA 4: Permite liberar pointer lock com ESC
    window.addEventListener("keydown", this._onEscapeKey);

    this._updatePointerLockUI();
  }

  /** Desativa o modo passeio e limpa todos os listeners. */
  disable() {
    this.enabled = false;
    this._keys.clear();

    if (typeof window === "undefined") return;

    // Remove listeners com os mesmos parâmetros que foram adicionados
    window.removeEventListener("keydown", this._onKeyDown, true);
    window.removeEventListener("keyup", this._onKeyUp, true);
    this.domElement.removeEventListener("mousemove", this._onMouseMove, false);
    this.domElement.removeEventListener("click", this._onClick, false);
    window.removeEventListener("keydown", this._onEscapeKey);
    document.removeEventListener("pointerlockchange", this._onPointerlockchange);
    
    // Libera o pointer lock se estiver ativo
    if (document.pointerLockElement === this.domElement) {
      document.exitPointerLock();
    }
    
    this._updatePointerLockUI();
  }

  _onClick() {
    // Primeiro clique no canvas trava o ponteiro (padrão de qualquer
    // jogo em primeira pessoa) — sem isso o mouse "vaza" pra fora da
    // janela ao tentar olhar em volta.
    if (this.enabled && document.pointerLockElement !== this.domElement) {
      // MELHORIA: Log para debug
      console.log("🔒 Ativando pointer lock...");
      this.domElement.requestPointerLock();
    }
  }

  _onKeyDown(event) {
    this._keys.add(event.code);
    // MELHORIA: Log para debug (remova em produção)
    // console.log("Tecla pressionada:", event.code);
  }

  _onKeyUp(event) {
    this._keys.delete(event.code);
  }

  _onMouseMove(event) {
    // Só processa se pointer lock estiver ativo
    if (document.pointerLockElement !== this.domElement) {
      return;
    }
    
    this.yaw -= event.movementX * LOOK_SENSITIVITY;
    this.pitch = clamp(this.pitch - event.movementY * LOOK_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
    this._applyRotation();
  }

  // MELHORIA: Permite liberar pointer lock com ESC
  _onEscapeKey(event) {
    if (event.key === "Escape" && this.enabled && document.pointerLockElement) {
      console.log("🔓 Liberando pointer lock...");
      document.exitPointerLock();
    }
  }

  // MELHORIA: Atualiza UI quando pointer lock muda
  _onPointerlockchange() {
    this._updatePointerLockUI();
  }

  // MELHORIA: Atualiza indicador visual
  _updatePointerLockUI() {
    const locked = document.pointerLockElement === this.domElement;
    
    if (locked) {
      this.domElement.classList.add("pointer-locked");
      console.log("✓ Pointer lock ATIVO - Você está pronto para controlar a câmera!");
    } else {
      this.domElement.classList.remove("pointer-locked");
    }
  }

  _applyRotation() {
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  /** @returns {{x: number, z: number}} posição atual no plano do chão */
  getPosition() {
    return { x: this.camera.position.x, z: this.camera.position.z };
  }

  /**
   * Avança o movimento com base nas teclas pressionadas. Chamado uma
   * vez por frame pelo SceneManager, só quando o modo passeio está ativo.
   * @param {number} deltaSeconds
   */
  update(deltaSeconds) {
    if (!this.enabled) return;

    // Direção "pra frente" real da câmera (considera pra onde o mouse
    // está olhando), achatada no plano do chão — senão andar pra
    // frente enquanto olha pra cima faria a câmera subir.
    this.camera.getWorldDirection(this._forward);
    this._forward.y = 0;
    if (this._forward.lengthSq() < 1e-6) this._forward.set(0, 0, -1);
    this._forward.normalize();

    this._right.crossVectors(this._forward, this.camera.up).normalize();

    this._move.set(0, 0, 0);
    if (this._keys.has("KeyW") || this._keys.has("ArrowUp")) this._move.add(this._forward);
    if (this._keys.has("KeyS") || this._keys.has("ArrowDown")) this._move.sub(this._forward);
    if (this._keys.has("KeyD") || this._keys.has("ArrowRight")) this._move.add(this._right);
    if (this._keys.has("KeyA") || this._keys.has("ArrowLeft")) this._move.sub(this._right);

    if (this._move.lengthSq() === 0) return;

    this._move.normalize().multiplyScalar(MOVE_SPEED * deltaSeconds);
    this.camera.position.add(this._move);
    this.camera.position.x = clamp(this.camera.position.x, -WORLD_BOUNDARY, WORLD_BOUNDARY);
    this.camera.position.z = clamp(this.camera.position.z, -WORLD_BOUNDARY, WORLD_BOUNDARY);
    this.camera.position.y = EYE_HEIGHT; // nunca deixa "voar" nem afundar no chão
  }
}

module.exports = { CameraController, EYE_HEIGHT, MOVE_SPEED };