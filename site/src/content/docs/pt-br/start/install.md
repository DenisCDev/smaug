---
title: Instalar no Claude Code
description: Instalação global com install.sh, perfis de custo, desativação de partes e idiomas.
---

Requisitos:

- Node.js 22 ou mais recente (a CI roda 22 e 24);
- Claude Code instalado (integração verificada com a 2.1.299);
- Git for Windows no Windows, que é o ambiente testado. Sem o Git Bash, o
  Claude Code roda os hooks no PowerShell, e um hook de pré-escrita que falha passa
  a bloquear a edição ([documentação de hooks](https://code.claude.com/docs/en/hooks),
  campo `shell`). O `smugan doctor` avisa quando não encontra o Git Bash.

```bash
git clone https://github.com/DenisCDev/smugan.git
cd smugan
./install.sh
```

O instalador pode ser executado de novo. Ele atualiza só os blocos que o Smugan
gerencia e preserva o resto da configuração. Os hooks apontam para este checkout,
então atualizar o repositório também atualiza o engine usado nas sessões seguintes.
Regras, agentes, skills e o estilo são cópias: depois de um `git pull`, rode
`./install.sh` de novo. O `smugan doctor` aponta qual cópia ficou para trás.

Para desinstalar, rode `./install.sh --uninstall`. Ele remove só o que o instalador
escreve: o bloco gerenciado no `CLAUDE.md`, as regras, skills, agentes, estilo e
arquivos de hook do Smugan, os hooks dele no `settings.json`, o `outputStyle` se
ainda for `Smugan` e os comandos `smugan` que ele marcou em `~/.local/bin`. O resto
da configuração fica como estava.

O processo instala:

- as regras gerais em um bloco delimitado do `~/.claude/CLAUDE.md`. O texto fora do
  bloco não é tocado; o bloco é substituído por inteiro a cada instalação;
- as regras específicas de stack em `~/.claude/rules/`;
- os revisores `critic` e `flow-critic` em `~/.claude/agents/`;
- as skills de `claude/skills/`: `/smugan` (auditoria), `smugan-build` (preparação,
  critérios de aceite e execução por tarefa, com as referências por stack) e
  `smugan-finish` (entrega);
- o estilo de resposta do Smugan em `~/.claude/output-styles/`. Ele vira o padrão
  só quando o `settings.json` ainda não define `outputStyle`; uma escolha anterior é
  mantida;
- o lançador `~/.claude/hooks/smugan-hook.mjs` e os hooks `PreToolUse`, `PostToolUse`
  e `Stop` que o chamam, mesclados ao `settings.json`. Uma instalação nova
  substitui entradas antigas do Smugan e preserva as demais;
- `~/.claude/hooks/smugan.paths.json`, que aponta para o engine deste checkout;
- o comando `smugan` em `~/.local/bin`, a mesma pasta onde o instalador do Claude Code
  coloca o `claude`. No Windows, ele vem em dois arquivos: `smugan`, para o Git Bash,
  e `smugan.cmd`, para PowerShell e cmd. Um arquivo com esse nome que o Smugan não
  escreveu é deixado em paz. Se a pasta não estiver no `PATH`, o instalador avisa.
  `SMUGAN_BIN_DIR` muda a pasta.

O instalador respeita `CLAUDE_CONFIG_DIR` quando a configuração do Claude Code fica
fora de `~/.claude`. Se o `settings.json` tiver JSON inválido, o instalador escreve
o resto, deixa esse arquivo como está e sai com erro; os hooks só passam a valer
depois de corrigir o arquivo e rodar de novo. Os hooks só se aplicam a sessões
abertas depois da instalação, e o estilo de resposta depois de `/clear` ou de uma
sessão nova.

Para rodar `critic` e `flow-critic` em um modelo diferente do que escreveu o
código, defina `SMUGAN_REVIEW_MODEL` na instalação, com um alias ou um ID completo:

```bash
SMUGAN_REVIEW_MODEL=sonnet ./install.sh
```

Sem a variável, os revisores seguem o padrão do Claude Code para subagentes: o
modelo da conversa, ou `CLAUDE_CODE_SUBAGENT_MODEL` quando definido.
`CLAUDE_CODE_SUBAGENT_MODEL_FORCE` sobrepõe até o `model:` escrito pelo instalador.

### Perfil de custo

`SMUGAN_PROFILE` escolhe quanto custa a revisão:

| Perfil | Revisores |
|---|---|
| `completo` (padrão) | `critic` e `flow-critic` no modelo da conversa |
| `economico` | `critic` e `flow-critic` no sonnet; nada mais muda |
| `minimo` | só o `critic`, no haiku; o `flow-critic` não é instalado nem mencionado nas regras |

```bash
SMUGAN_PROFILE=economico ./install.sh
```

O gate, as regras e o checklist do `critic` são os mesmos em todos. O que muda é
quem revisa, e um revisor mais barato encontra menos: lê o diff com menos cuidado e
deixa passar defeitos que o modelo maior pegaria. Sem o `flow-critic`, nenhuma
revisão olha o fluxo de quem usa a tela. Use `economico` e `minimo` só em tarefas
pequenas e reversíveis, e volte para `completo` antes de mexer em autenticação,
dinheiro, migrations ou telas. A escolha fica salva como os idiomas, e o
`SMUGAN_REVIEW_MODEL`, quando definido, tem precedência sobre o modelo do perfil.

### Desativando partes

`SMUGAN_DISABLE` recebe uma lista separada por vírgulas do que você não quer usar:
um revisor (`critic`, `flow-critic`), uma skill (`smugan`, `smugan-build`,
`smugan-finish`) ou uma regra de stack (o nome do arquivo em `claude/rules/` sem
`.md`, como `nextjs` ou `supabase`).

```bash
SMUGAN_DISABLE=flow-critic,nextjs ./install.sh   # turns off flow-critic and the Next rule
SMUGAN_DISABLE=none ./install.sh                 # turns everything back on
```

O que está desativado não é instalado, e o que já estava instalado é removido.
O `CLAUDE.md` deixa de mencionar a parte: sem o `critic`, a Definition of done pede
só o `flow-critic`; sem os dois, os itens de revisão somem; sem o `smugan-build`, a
preparação pede só o `smugan context`; uma regra desativada sai da lista de regras.
Uma skill desativada perde só o `SKILL.md`: os guias em `smugan-build/references/`
ficam, porque as regras de stack apontam para eles. A lista fica salva como o
perfil, um nome desconhecido aborta a instalação antes de escrever qualquer coisa, e
o `smugan doctor` compara a instalação com a lista aplicada. Os adaptadores
(`adapters/*/install.sh`) aceitam a mesma variável.

Em um projeto, `"disable": [...]` no `smugan.config.json` ou no `smugan.local.json`
desativa as mesmas partes só ali, até onde um hook alcança:

- o lembrete de primeira edição de um arquivo crítico para de pedir o revisor
  desativado e de mencionar o `smugan-build`, em qualquer instalação;
- no plugin, o contexto de início de sessão deixa a parte de fora, a regra deixa de
  ser ensinada e o lançamento do revisor ou da skill é recusado;
- no Codex, a regra deixa de ser ensinada.

Na instalação global do Claude Code, o `CLAUDE.md`, os agentes e as regras em
`~/.claude` valem para todos os projetos, e o próprio Claude Code carrega as regras
por caminho: nenhum hook consegue removê-las de um único projeto. Para isso,
desative-as na instalação ou use o plugin. Nos adaptadores do Antigravity, do
OpenCode e do Grok, a lista do projeto também não muda o ensino das regras.

Os idiomas vêm desligados por padrão. Sem configuração, nenhuma regra impõe o idioma
das strings do projeto e o agente responde no idioma em que você escreve. Para fixar
um ou os dois, passe um código de idioma na instalação:

```bash
SMUGAN_UI_LANG=pt-BR SMUGAN_REPLY_LANG=pt-BR ./install.sh   # UI strings and conversation
SMUGAN_UI_LANG=es ./install.sh                              # UI strings only
SMUGAN_UI_LANG=off ./install.sh                             # turns it off again
```

A escolha fica salva e vale para as reinstalações seguintes até você mudá-la. Com
uma UI em português, entram também a regra `ui-ptbr` e a checagem `ui-strings`; as
duas só conhecem pt-BR. Um projeto pode ligar ou desligar essa checagem por conta
própria no `smugan.config.json` (`"checks": { "ui-strings": true }`), que é como ela
roda na CI, onde não há instalação.
