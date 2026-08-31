/**
 * Preset da Ollama pra LocalOpenAICompatibleAdapter.
 * Ollama expõe uma API compatível com a da OpenAI na mesma porta do
 * servidor normal, a partir da v0.1.x.
 */
module.exports = {
  name: "Ollama",
  baseUrl: "http://localhost:11434",
  chatEndpoint: "/v1/chat/completions",
  modelsEndpoint: "/v1/models",
};