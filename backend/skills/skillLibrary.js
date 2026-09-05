/**
 * skillLibrary.js
 *
 * Biblioteca pronta de skills que o CompanyLab oferece de fábrica na aba
 * "Skills" (junto com a opção do usuário criar as dele próprio). Cada
 * entrada aqui vira uma linha em `skill_packages` (source='library') na
 * primeira vez que o app roda — ver SkillManager.seedLibrary().
 *
 * `slug` segue as mesmas regras de nome que o padrão Agent Skills usa
 * (OpenCode/Claude Code/Codex): minúsculo, números e hífen simples como
 * separador, sem começar/terminar com hífen, 1-64 caracteres. É o nome da
 * pasta e do campo `name` do frontmatter — por isso tem que bater.
 */

const LIBRARY_SKILLS = [
  {
    slug: "commit-message-writer",
    name: "Escritor de Commit Messages",
    description:
      "Use esta skill sempre que precisar escrever ou revisar uma mensagem de commit git a partir de um diff ou de uma descrição de mudança.",
    content: `# Escritor de Commit Messages

Ao escrever uma mensagem de commit a partir de um diff ou descrição de mudança:

1. Primeira linha: resumo no imperativo, até ~50 caracteres, sem ponto final
   (ex: "Corrige race condition no polling de status").
2. Se o diff mexe em mais de uma área, escolha a mudança PRINCIPAL para a
   primeira linha e deixe o resto para o corpo.
3. Linha em branco, depois o corpo explicando o PORQUÊ da mudança (não só
   o que mudou — isso já dá pra ver no diff).
4. Use bullet points no corpo quando houver mais de uma mudança relevante.
5. Referencie o número da issue/ticket no rodapé quando existir (ex:
   "Fixes #123").
6. Nunca invente contexto que não está no diff ou na descrição fornecida —
   se não souber o motivo da mudança, descreva o efeito observável dela.
`,
  },
  {
    slug: "code-reviewer",
    name: "Revisor de Código",
    description:
      "Use esta skill para revisar um trecho de código ou um pull request, apontando bugs, riscos e melhorias antes de aprovar.",
    content: `# Revisor de Código

Ao revisar código:

1. Leia o código inteiro antes de comentar qualquer linha isolada.
2. Separe os comentários em três níveis: **bloqueante** (bug real, falha de
   segurança, quebra comportamento existente), **sugestão** (melhoraria
   legibilidade/performance, mas não impede o merge) e **nitpick** (estilo).
3. Para cada comentário bloqueante, explique o cenário concreto que quebra
   (input, condição de corrida, edge case) — não só "isso está errado".
4. Verifique: tratamento de erro, casos de entrada vazia/nula, nomes que
   não refletem o que a variável/função faz, e se testes cobrem a mudança.
5. Se o código está bom, diga isso claramente — revisão não é só achar
   defeito.
6. Termine com um resumo de 1-2 frases: aprovar, aprovar com ressalvas, ou
   pedir mudanças.
`,
  },
  {
    slug: "api-doc-writer",
    name: "Redator de Documentação de API",
    description:
      "Use esta skill quando precisar documentar um endpoint de API (REST/GraphQL) ou gerar/atualizar um README de referência técnica.",
    content: `# Redator de Documentação de API

Ao documentar um endpoint ou biblioteca:

1. Comece com uma frase dizendo o que o endpoint/função FAZ, não como foi
   implementado.
2. Liste parâmetros em tabela: nome, tipo, obrigatório?, descrição curta.
3. Sempre inclua pelo menos um exemplo de requisição/uso REAL (com valores
   plausíveis, não "foo"/"bar" quando o domínio já é conhecido).
4. Documente os casos de erro esperados (códigos de status, mensagens) —
   não só o caminho feliz.
5. Se o comportamento mudou entre versões, anote isso explicitamente.
6. Prefira exemplos runáveis (copiar e colar funciona) a descrições vagas.
`,
  },
  {
    slug: "sql-query-optimizer",
    name: "Otimizador de Queries SQL",
    description:
      "Use esta skill ao analisar uma query SQL lenta ou um plano de execução, para sugerir índices e reescritas mais eficientes.",
    content: `# Otimizador de Queries SQL

Ao otimizar uma query:

1. Peça (ou identifique no contexto) o EXPLAIN/EXPLAIN ANALYZE antes de
   sugerir qualquer mudança — não adivinhe o plano de execução.
2. Procure por: full table scan onde um índice resolveria, JOIN sem
   índice na coluna de junção, subquery correlacionada que vira N+1,
   SELECT * trazendo colunas desnecessárias.
3. Ao sugerir um índice novo, diga explicitamente em qual(is) coluna(s),
   e se deveria ser composto (e em que ordem) baseado nas cláusulas WHERE/
   ORDER BY da query.
4. Avise sobre o trade-off: todo índice novo tem custo de escrita/espaço —
   não sugira índice para uma query que roda raramente.
5. Se a reescrita muda o resultado (não só a performance), deixe isso
   claro antes de qualquer coisa.
`,
  },
  {
    slug: "unit-test-generator",
    name: "Gerador de Testes Unitários",
    description:
      "Use esta skill para gerar ou completar testes unitários para uma função, classe ou módulo existente.",
    content: `# Gerador de Testes Unitários

Ao gerar testes para um trecho de código:

1. Identifique o comportamento observável (input -> output/efeito), não
   os detalhes internos de implementação.
2. Cubra: caso feliz típico, pelo menos um caso de borda (vazio, zero,
   nulo, limite), e pelo menos um caso de erro esperado.
3. Um assert/expectativa por conceito testado — evite testes gigantes
   que verificam três coisas diferentes de uma vez.
4. Nomeie o teste descrevendo o comportamento esperado, não a função
   testada (ex: "retorna lista vazia quando não há resultados", não
   "test_getResults_2").
5. Use mocks/stubs só para dependências externas reais (rede, disco,
   tempo) — não mocke a própria lógica que está sendo testada.
6. Siga o framework de teste já usado no projeto (não introduza um novo
   sem necessidade).
`,
  },
  {
    slug: "refactor-planner",
    name: "Planejador de Refatoração",
    description:
      "Use esta skill antes de refatorar um trecho grande de código, para planejar os passos em uma ordem segura e reversível.",
    content: `# Planejador de Refatoração

Antes de refatorar algo grande:

1. Descreva em 1-2 frases o problema atual (duplicação, acoplamento,
   nome ruim, responsabilidade demais numa função só) — a refatoração
   precisa resolver um problema concreto, não só "deixar mais bonito".
2. Quebre em passos PEQUENOS, cada um deixando o código funcionando (sem
   quebrar build/testes) ao final do passo.
3. Priorize: primeiro extrair/isolar, depois renomear, depois mover.
   Mudanças estruturais grandes por último.
4. Para cada passo, diga o que testar manualmente ou quais testes
   automatizados confirmam que nada quebrou.
5. Se a refatoração muda comportamento observável (não só estrutura),
   marque isso separadamente — não deve ser silencioso.
`,
  },
];

module.exports = { LIBRARY_SKILLS };