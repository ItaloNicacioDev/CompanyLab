-- 002_create_skill_packages.sql
--
-- Aba "Skills" (biblioteca pronta + skills próprias do usuário) que podem
-- ser instaladas GLOBALMENTE em qualquer CLI de agente que o usuário tenha
-- na máquina (OpenCode, Claude Code, Codex CLI, ...).
--
-- Uma "skill" aqui é sempre um arquivo SKILL.md (formato Agent Skills:
-- frontmatter YAML com `name` + `description`, seguido do corpo em
-- Markdown). skill_packages guarda o CONTEÚDO canônico de cada skill;
-- skill_installations guarda EM QUAIS CLIs ela foi copiada e para qual
-- caminho — é o que permite mostrar "instalada" vs "não instalada" por
-- runtime e permite desinstalar (apagar só aquela pasta) sem afetar as
-- outras instalações da mesma skill.
--
-- NOTA: isso é um conceito diferente da coluna `agents.skills` (que é só
-- uma lista de tags/JSON descrevendo o que um agente sabe fazer, usada no
-- prompt dele). Nome de tabela diferente de propósito pra não confundir.

CREATE TABLE skill_packages (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,      -- nome de pasta/frontmatter (kebab-case)
    name TEXT NOT NULL,             -- nome de exibição
    description TEXT NOT NULL,      -- vira o `description` do frontmatter
    source TEXT NOT NULL DEFAULT 'custom', -- 'library' (biblioteca pronta) | 'custom'
    content TEXT NOT NULL,          -- corpo em Markdown (SEM frontmatter — é montado na hora de instalar)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE skill_installations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id TEXT NOT NULL REFERENCES skill_packages(id) ON DELETE CASCADE,
    runtime_name TEXT NOT NULL,     -- ex: 'OpenCode', 'Claude Code', 'Codex'
    install_path TEXT NOT NULL,     -- caminho absoluto onde o SKILL.md foi escrito
    installed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(skill_id, runtime_name)
);