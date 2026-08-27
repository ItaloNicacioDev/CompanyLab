-- CompanyLab Database Schema

CREATE TABLE companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    config TEXT
);

CREATE TABLE departments (
    id TEXT PRIMARY KEY,
    company_id TEXT REFERENCES companies(id),
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    room_type TEXT DEFAULT 'generic',
    rules TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    company_id TEXT REFERENCES companies(id),
    department_id TEXT REFERENCES departments(id),
    name TEXT NOT NULL,
    avatar TEXT,
    role TEXT,
    title TEXT,
    personality TEXT,
    soul TEXT,
    skills TEXT,
    responsibilities TEXT,
    permissions TEXT,
    runtime TEXT,
    model TEXT,
    is_ceo BOOLEAN DEFAULT 0,
    status TEXT DEFAULT 'idle',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    creator_id TEXT REFERENCES agents(id),
    assigned_to TEXT REFERENCES agents(id),
    department_id TEXT REFERENCES departments(id),
    project_id TEXT REFERENCES projects(id),
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'pending',
    dependencies TEXT,
    deadline DATETIME,
    result TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    company_id TEXT REFERENCES companies(id),
    name TEXT NOT NULL,
    description TEXT,
    departments TEXT,
    agents TEXT,
    progress INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    from_agent TEXT,
    to_agent TEXT,
    content TEXT NOT NULL,
    mentions TEXT,
    type TEXT DEFAULT 'text',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    type TEXT DEFAULT 'channel',
    participants TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agent_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT REFERENCES agents(id),
    entry TEXT,
    category TEXT DEFAULT 'general',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT REFERENCES agents(id),
    action TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT REFERENCES agents(id),
    resource TEXT,
    action TEXT,
    granted BOOLEAN DEFAULT 0
);