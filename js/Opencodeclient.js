/**
 * openCodeClient.js
 *
 * Fala com o servidor HTTP REAL do OpenCode (iniciado com `opencode serve`).
 * Não simula nada: cria sessões de verdade e manda mensagens de verdade
 * para o backend do OpenCode.
 *
 * IMPORTANTE: os nomes exatos de rota (/session, /session/:id/message, etc.)
 * seguem o formato documentado publicamente do OpenCode server. Se a sua
 * versão instalada expuser rotas ligeiramente diferentes, rode:
 *
 *    opencode serve
 *
 * e depois abra no navegador:
 *
 *    http://localhost:4096/doc
 *
 * (o OpenCode expõe um OpenAPI/Swagger automático). Ajuste as constantes
 * ROUTES abaixo se necessário — é só isso que muda.
 */

const fetch = global.fetch || require("node-fetch");

const ROUTES = {
  createSession: () => `/session`,
  sendMessage: (sessionId) => `/session/${sessionId}/message`,
  getSession: (sessionId) => `/session/${sessionId}`,
  health: () => `/global/health`,
};

class OpenCodeClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async checkHealth() {
    try {
      const res = await fetch(this.baseUrl + ROUTES.health());
      return res.ok;
    } catch (err) {
      return false;
    }
  }

  /**
   * Cria uma sessão nova no OpenCode para um agente específico.
   * O systemPrompt/persona é enviado como a primeira mensagem "de sistema"
   * (na prática, como uma mensagem de setup) para fixar a personalidade
   * daquele agente durante toda a sessão.
   */
  async createSession(title) {
    const res = await fetch(this.baseUrl + ROUTES.createSession(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      throw new Error(
        `Falha ao criar sessão no OpenCode (HTTP ${res.status}). ` +
          `Confirme que 'opencode serve' está rodando em ${this.baseUrl}.`
      );
    }
    const data = await res.json();
    return data.id || data.sessionID || data.session_id;
  }

  /**
   * Manda uma mensagem para uma sessão e devolve o texto final da resposta.
   * O OpenCode faz streaming (SSE) da resposta; aqui concatenamos os
   * pedaços de texto até o evento de finalização.
   */
  async sendMessage(sessionId, text) {
    const res = await fetch(this.baseUrl + ROUTES.sendMessage(sessionId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parts: [{ type: "text", text }],
      }),
    });

    if (!res.ok) {
      throw new Error(
        `Falha ao enviar mensagem para sessão ${sessionId} (HTTP ${res.status}).`
      );
    }

    const contentType = res.headers.get("content-type") || "";

    // Caso a resposta venha como JSON simples (não-streaming)
    if (contentType.includes("application/json")) {
      const data = await res.json();
      return extractTextFromResponse(data);
    }

    // Caso venha como SSE (text/event-stream), concatena os deltas de texto
    if (contentType.includes("text/event-stream")) {
      return await readSSEText(res);
    }

    // Fallback: tenta ler como texto puro
    const raw = await res.text();
    try {
      return extractTextFromResponse(JSON.parse(raw));
    } catch {
      return raw;
    }
  }
}

function extractTextFromResponse(data) {
  // Formatos comuns: { parts: [{type:'text', text: '...'}] } ou { text: '...' }
  if (typeof data === "string") return data;
  if (data.text) return data.text;
  if (Array.isArray(data.parts)) {
    return data.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");
  }
  if (data.message && data.message.parts) {
    return data.message.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");
  }
  return JSON.stringify(data);
}

async function readSSEText(res) {
  let full = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    const str = decoder.decode(chunk, { stream: true });
    for (const line of str.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload);
        if (evt.type === "text-delta" && evt.text) full += evt.text;
        else if (evt.text) full += evt.text;
      } catch {
        // ignora linhas que não são JSON válido
      }
    }
  }
  return full;
}

module.exports = { OpenCodeClient };