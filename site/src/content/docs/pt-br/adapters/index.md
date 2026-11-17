---
title: Outros agentes de código
description: O que a integração de cada plataforma consegue bloquear e retomar.
---

O engine é o mesmo em todas as integrações. O que muda é a capacidade de cada
plataforma de bloquear uma escrita ou retomar uma sessão.

| Plataforma | Instalação | Comportamento principal |
|---|---|---|
| Claude Code | `./install.sh` | Bloqueia a escrita e pode impedir o fim do turno |
| [Codex](/pt-br/adapters/codex/) | `cd adapters/codex && ./install.sh` | Bloqueia patches, devolve erros ao agente e segura o fim do turno; os hooks precisam ser marcados como confiáveis em `/hooks` |
| [Antigravity](/pt-br/adapters/antigravity/) | `cd adapters/antigravity && ./install.sh` | Usa hooks de pré, pós e final; os revisores ficam reservados para mudanças arriscadas |
| [OpenCode](/pt-br/adapters/opencode/) | `cd adapters/opencode && ./install.sh` | Bloqueia a chamada de ferramenta e retoma a sessão quando a verificação final falha |
| [Grok Build](/pt-br/adapters/grok/) | `cd adapters/grok && ./install.sh` | Bloqueia antes de escrever; uma falha final aparece como negação no turno seguinte |

Cada adaptador tem o próprio README com instalação, limites conhecidos e um roteiro de
verificação. Uma integração não é descrita como equivalente quando a plataforma não
oferece o mesmo evento.

Os quatro adaptadores copiam o `smugan-build`, então a etapa de contrato chega a todos
eles. Codex, Antigravity e OpenCode geram os revisores a partir de `claude/agents/`,
com a leitura do contrato e o bloco para quem recebe a revisão. O Grok usa cópias
próprias dos revisores, que ainda não têm essas mudanças.

A execução por tarefa foi escrita para o subagente `general-purpose` do Claude Code e
só foi verificada lá. Nas outras plataformas, nada garante que as edições de
subagentes passem pelos hooks. Nenhum adaptador instala o `smugan-finish`. O
`smugan contract` e o `smugan why` funcionam com qualquer plataforma; o
`smugan doctor` verifica só a instalação do Claude Code.
