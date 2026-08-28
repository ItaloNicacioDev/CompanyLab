/**
 * registry.js
 *
 * Registro central dos templates de sala + lógica de "matching":
 * dado o `roomType` salvo no departamento (coluna `room_type` da
 * tabela `departments`) e/ou as tags de função escolhidas pelo
 * usuário, decide qual template.build() chamar.
 *
 * Esta é a peça de LÓGICA PURA (sem I/O, sem banco). Quem orquestra
 * de fato — lê o departamento no banco, chama isso aqui, e salva o
 * resultado em cache — é o RoomFactory.js (próximo arquivo).
 */

const development = require("./development");
const marketing = require("./marketing");
const finance = require("./finance");
const generic = require("./generic");

/** Todos os templates fixos disponíveis, indexados pelo roomType. */
const BUILTIN_TEMPLATES = Object.freeze({
  [development.ROOM_TYPE]: development,
  [marketing.ROOM_TYPE]: marketing,
  [finance.ROOM_TYPE]: finance,
  [generic.ROOM_TYPE]: generic,
});

/**
 * Tags associadas a cada template fixo — usado pra decidir se um
 * departamento customizado "se parece" o suficiente com um template
 * pronto pra reaproveitá-lo, em vez de cair direto no genérico.
 */
const TEMPLATE_TAGS = Object.freeze({
  development: ["Tecnologia", "Dados", "Desenvolvimento", "TI", "Software", "Engenharia"],
  marketing: ["Criativo", "Comunicação", "Marketing", "Design", "Social Media"],
  finance: ["Financeiro", "Contabilidade", "Dados"],
});

/**
 * Retorna o template fixo pelo nome exato, se existir.
 * @param {string} roomType
 * @returns {{ build: Function, ROOM_TYPE: string } | null}
 */
function resolveBuiltInTemplate(roomType) {
  return BUILTIN_TEMPLATES[roomType] || null;
}

/**
 * Compara as tags escolhidas pelo usuário contra os templates fixos
 * e retorna o de maior sobreposição, se houver alguma. Não normaliza
 * acentos/maiúsculas de propósito — as tags vêm de uma lista fechada
 * na UI (não é texto livre), então o valor já chega padronizado.
 *
 * @param {string[]} tags
 * @returns {{ type: string, score: number, template: object } | null}
 */
function matchTemplateByTags(tags = []) {
  if (!tags.length) return null;

  let best = null;

  for (const [type, templateTags] of Object.entries(TEMPLATE_TAGS)) {
    const score = tags.filter((tag) => templateTags.includes(tag)).length;
    if (score > 0 && (!best || score > best.score)) {
      best = { type, score, template: BUILTIN_TEMPLATES[type] };
    }
  }

  return best;
}

/**
 * Função principal: decide qual template usar pra um departamento.
 *
 * Cascata (bate com o que combinamos anteriormente):
 *   1. roomType exato bate com um template fixo -> usa ele direto.
 *   2. roomType é 'custom'/desconhecido, mas as tags batem fortemente
 *      com um template fixo -> reaproveita esse template.
 *   3. Nenhum dos dois -> generic.js (composição procedural por tags).
 *
 * @param {object} params
 * @param {string} [params.roomType] - valor salvo em departments.room_type
 * @param {string[]} [params.tags] - tags de função do departamento customizado
 * @returns {{ build: Function, ROOM_TYPE: string, matchedBy: 'exact'|'tags'|'fallback' }}
 */
function resolveTemplate({ roomType, tags = [] } = {}) {
  const exact = resolveBuiltInTemplate(roomType);
  if (exact) {
    return { ...exact, matchedBy: "exact" };
  }

  const tagMatch = matchTemplateByTags(tags);
  if (tagMatch) {
    return { ...tagMatch.template, matchedBy: "tags" };
  }

  return { ...generic, matchedBy: "fallback" };
}

module.exports = {
  BUILTIN_TEMPLATES,
  TEMPLATE_TAGS,
  resolveBuiltInTemplate,
  matchTemplateByTags,
  resolveTemplate,
};