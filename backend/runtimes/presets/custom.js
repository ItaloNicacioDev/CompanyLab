/**
 * Preset "genérico" pra qualquer servidor local compatível com a API
 * da OpenAI que o usuário configure manualmente — URL/porta digitada
 * por ele na tela de criação de agente (runtime "Local (Custom)").
 */
module.exports = {
  name: "Custom",
  baseUrl: null, // obrigatório vir de fora (config do agente/departamento)
  chatEndpoint: "/v1/chat/completions",
  modelsEndpoint: "/v1/models",
};