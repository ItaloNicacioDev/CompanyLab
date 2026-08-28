/**
 * EventBus.js
 *
 * O sistema nervoso central do CompanyLab (seção 34 do spec).
 *
 * Toda mudança real de estado da empresa — agente mudou de status,
 * tarefa foi criada, mensagem foi enviada, runtime conectou — passa
 * por aqui como UM evento. Chat, Tasks, Dashboards, o mundo 3D e o
 * Orchestrator escutam esse mesmo barramento, então nunca ficam
 * dessincronizados entre si.
 *
 * REGRA DE OURO (seção 26 e 38 do spec — "No Fake Activity"):
 * NINGUÉM pode emitir um evento aqui a não ser que ele corresponda
 * a algo que realmente aconteceu (uma escrita no banco, uma resposta
 * real de runtime, uma mensagem real). O EventBus não sabe distinguir
 * evento real de evento inventado — essa responsabilidade é de quem
 * chama emit(). Nunca emita um AGENT_WORKING sem uma task real por
 * trás, por exemplo.
 *
 * Implementado como singleton: sempre que algum módulo faz
 * `require('.../EventBus')`, recebe a MESMA instância.
 */

const { EventEmitter } = require("events");
const { isValidEventType } = require("./eventTypes");

const HISTORY_LIMIT = 200;

class CompanyEventBus extends EventEmitter {
  constructor() {
    super();
    // Node avisa "MaxListenersExceededWarning" com poucos listeners por
    // padrão (10). Numa empresa com dezenas de agentes + UI + 3D + logger,
    // isso é esperado, não um vazamento de memória.
    this.setMaxListeners(100);

    /**
     * Histórico curto em memória dos últimos eventos. Serve pra quem
     * se inscreve DEPOIS do evento acontecer (ex: renderer que abriu
     * a janela um pouco atrasado) conseguir "pegar o trem andando" via
     * getRecentEvents(), sem precisar reconsultar o banco inteiro.
     * Não é persistência — isso é papel do activity_log no banco.
     */
    this._history = [];
  }

  /**
   * Emite um evento tipado da empresa.
   * @param {string} type - Uma das constantes de eventTypes.js
   * @param {object} [payload] - Dados do evento (ids, status, etc.)
   */
  emitEvent(type, payload = {}) {
    if (!isValidEventType(type)) {
      // Não trava a aplicação por isso, mas avisa alto no console —
      // isso normalmente significa um typo ou um evento novo que
      // esqueceram de registrar em eventTypes.js.
      console.warn(
        `[EventBus] Tipo de evento desconhecido: "${type}". ` +
          `Registre-o em core/events/eventTypes.js antes de usar.`
      );
    }

    const event = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };

    this._history.push(event);
    if (this._history.length > HISTORY_LIMIT) {
      this._history.shift();
    }

    // Emite duas formas: o tipo específico (pra quem só quer
    // 'agent.task.completed') e um canal genérico 'event' (pra quem,
    // como o main.js repassando pro renderer, quer TUDO indistintamente).
    this.emit(type, event);
    this.emit("event", event);
  }

  /**
   * Retorna os últimos N eventos emitidos (mais recente por último).
   * @param {number} [limit=HISTORY_LIMIT]
   */
  getRecentEvents(limit = HISTORY_LIMIT) {
    return this._history.slice(-limit);
  }

  /**
   * Atalho pra escutar um tipo específico de evento.
   * @param {string} type
   * @param {(event: {type: string, payload: object, timestamp: string}) => void} handler
   */
  onEvent(type, handler) {
    this.on(type, handler);
    return () => this.off(type, handler); // retorna função de unsubscribe
  }

  /**
   * Escuta TODOS os eventos, independente do tipo. Usado pelo main.js
   * pra retransmitir tudo ao renderer, e por um logger de atividade.
   * @param {(event: {type: string, payload: object, timestamp: string}) => void} handler
   */
  onAnyEvent(handler) {
    this.on("event", handler);
    return () => this.off("event", handler);
  }
}

// Singleton — todo `require` deste arquivo recebe a mesma instância.
module.exports = new CompanyEventBus();