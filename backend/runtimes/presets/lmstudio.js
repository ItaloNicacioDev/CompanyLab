/**
 * Preset do LM Studio pra LocalOpenAICompatibleAdapter.
 * O servidor local do LM Studio já é compatível com a API da OpenAI
 * por padrão (aba "Local Server" do app).
 */
module.exports = {
  name: "LM Studio",
  baseUrl: "http://localhost:1234",
  chatEndpoint: "/v1/chat/completions",
  modelsEndpoint: "/v1/models",
};