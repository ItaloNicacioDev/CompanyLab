/**
 * Preset do llama.cpp (binário `server`) pra LocalOpenAICompatibleAdapter.
 * O servidor do llama.cpp expõe /v1/chat/completions e /v1/models
 * quando rodado com suporte a API compatível com OpenAI.
 */
module.exports = {
  name: "llama.cpp",
  baseUrl: "http://localhost:8080",
  chatEndpoint: "/v1/chat/completions",
  modelsEndpoint: "/v1/models",
};