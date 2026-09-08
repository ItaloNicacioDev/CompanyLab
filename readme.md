# CompanyLab 🏢

<p align="center">

  <img src="docs/screenshots/office-overview.png" alt="CompanyLab Office" width="850">

</p>

<p align="center">

  <strong>
    A virtual AI company where real agents work together.
  </strong>

</p>

<p align="center">

  <a href="https://github.com/ItaloNicacioDev/CompanyLab/actions">
    <img src="https://img.shields.io/github/actions/workflow/status/ItaloNicacioDev/CompanyLab/release.yml?label=ci" alt="CI">
  </a>

  <a href="https://www.npmjs.com/">
    <img src="https://img.shields.io/badge/npm-v2026.9.3-CB3837?logo=npm&logoColor=white" alt="npm">
  </a>

  <img src="https://img.shields.io/badge/node-%3E%3D24.16.0%20%3C25%20%7C%7C%20%3E%3D26.1.0-339933?logo=node.js&logoColor=white" alt="Node.js">

  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT License">
  </a>

  <a href="https://www.patreon.com/cw/ItaloNicacio_Dev">
    <img src="https://img.shields.io/badge/Patreon-Support%20the%20developer-F96854?logo=patreon&logoColor=white" alt="Patreon">
  </a>

</p>

<p align="center">

  <a href="https://github.com/ItaloNicacioDev/CompanyLab/releases/latest">
    <img src="https://img.shields.io/badge/Download-Latest%20Release-2ea44f?style=for-the-badge&logo=github&logoColor=white" alt="Download Latest Release">
  </a>

</p>

---

## 🏢 What is CompanyLab?

**CompanyLab** is a desktop AI workspace that turns your company into an interactive 2D office.

Create departments, hire AI agents, assign them roles, connect them to real AI runtimes, organize tasks, communicate with your team and watch your AI company operate inside a virtual office.

Agents are not just visual characters.

They can actually execute work through the AI runtimes you already use, including:

- OpenCode
- Claude Code
- Codex

CompanyLab acts as the **company layer** around your AI agents.

```text
                         ┌─────────────────────┐
                         │     CompanyLab       │
                         │     Desktop App      │
                         └──────────┬──────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
              ▼                     ▼                     ▼
        ┌───────────┐        ┌────────────┐        ┌────────────┐
        │  Agents   │        │ Departments│        │   Tasks    │
        └─────┬─────┘        └────────────┘        └────────────┘
              │
              ▼
        ┌──────────────────────────────────────┐
        │           Agent Runtime Layer        │
        ├──────────────┬──────────────┬────────┤
        │   OpenCode   │ Claude Code  │ Codex  │
        └──────────────┴──────────────┴────────┘
              │
              ▼
        ┌──────────────────────────────────────┐
        │              AI Models               │
        │   Cloud • Local • Custom Providers   │
        └──────────────────────────────────────┘