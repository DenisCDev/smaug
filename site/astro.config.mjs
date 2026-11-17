// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const repo = 'https://github.com/DenisCDev/smugan';

export default defineConfig({
	site: 'https://smugan-docs.vercel.app',
	integrations: [
		starlight({
			title: 'Smugan',
			description: 'Checks and reviewers for code produced with AI agents.',
			logo: { src: './src/assets/logo.svg', alt: 'Smugan' },
			defaultLocale: 'root',
			locales: {
				root: { label: 'English', lang: 'en' },
				'pt-br': { label: 'Português do Brasil', lang: 'pt-BR' },
			},
			social: [{ icon: 'github', label: 'GitHub', href: repo }],
			customCss: ['./src/styles/docs.css'],
			head: [
				{ tag: 'meta', attrs: { property: 'og:image', content: 'https://smugan-docs.vercel.app/og.png' } },
				{ tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
				{ tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
				{ tag: 'meta', attrs: { name: 'twitter:image', content: 'https://smugan-docs.vercel.app/og.png' } },
				{ tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: true } },
				{ tag: 'link', attrs: { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Jost:wght@400;500;700&family=Pixelify+Sans:wght@700&display=swap' } },
			],
			sidebar: [
				{
					label: 'Start here', translations: { 'pt-BR': 'Comece aqui' },
					items: [
						{ label: 'Introduction', translations: { 'pt-BR': 'Introdução' }, slug: 'start/introduction' },
						{ label: 'How Smugan compares', translations: { 'pt-BR': 'Como o Smugan se compara' }, slug: 'start/compare' },
						{ label: 'Install in Claude Code', translations: { 'pt-BR': 'Instalar no Claude Code' }, slug: 'start/install' },
						{ label: 'Install as a plugin', translations: { 'pt-BR': 'Instalar como plugin' }, slug: 'start/plugin' },
						{ label: 'Verify the installation', translations: { 'pt-BR': 'Verificar a instalação' }, slug: 'start/verify' },
					],
				},
				{
					label: 'Guides', translations: { 'pt-BR': 'Guias' },
					items: [
						{ label: 'Use in a project', translations: { 'pt-BR': 'Usar em um projeto' }, slug: 'guides/use-in-a-project' },
						{ label: 'From request to delivery', translations: { 'pt-BR': 'Do pedido à entrega' }, slug: 'guides/request-to-delivery' },
						{ label: 'How completion is verified', translations: { 'pt-BR': 'Como a conclusão é verificada' }, slug: 'guides/completion' },
						{ label: 'Code that uses an LLM', translations: { 'pt-BR': 'Código que usa um LLM' }, slug: 'guides/llm-code' },
						{ label: 'Testing the rules themselves', translations: { 'pt-BR': 'Testando as próprias regras' }, slug: 'guides/testing-rules' },
					],
				},
				{
					label: 'Other coding agents', translations: { 'pt-BR': 'Outros agentes de código' },
					items: [
						{ label: 'Overview', translations: { 'pt-BR': 'Visão geral' }, slug: 'adapters' },
						{ label: 'Codex', slug: 'adapters/codex' },
						{ label: 'Grok Build', slug: 'adapters/grok' },
						{ label: 'OpenCode', slug: 'adapters/opencode' },
						{ label: 'Antigravity', slug: 'adapters/antigravity' },
					],
				},
				{
					label: 'Reference', translations: { 'pt-BR': 'Referência' },
					items: [
						{ label: 'CLI', slug: 'reference/cli' },
						{ label: 'Configuration', translations: { 'pt-BR': 'Configuração' }, slug: 'reference/configuration' },
						{ label: 'Environment variables', translations: { 'pt-BR': 'Variáveis de ambiente' }, slug: 'reference/environment-variables' },
						{ label: 'Checks', translations: { 'pt-BR': 'Verificações' }, slug: 'reference/checks' },
						{ label: 'End-of-turn detectors', translations: { 'pt-BR': 'Detectores de fim de turno' }, slug: 'reference/end-of-turn-detectors' },
						{ label: 'Hooks', slug: 'reference/hooks' },
						{ label: 'Risk levels', translations: { 'pt-BR': 'Níveis de risco' }, slug: 'reference/risk-levels' },
						{ label: 'Acceptance contract', translations: { 'pt-BR': 'Contrato de aceitação' }, slug: 'reference/contract' },
						{ label: 'Version context', translations: { 'pt-BR': 'Contexto de versão' }, slug: 'reference/version-context' },
						{ label: 'AI guides', translations: { 'pt-BR': 'Guias de IA' }, slug: 'reference/ai-guides' },
						{ label: 'doctor and why', translations: { 'pt-BR': 'doctor e why' }, slug: 'reference/doctor-and-why' },
						{ label: 'Rules, agents and skills', translations: { 'pt-BR': 'Regras, agentes e skills' }, slug: 'reference/rules-and-agents' },
						{ label: 'Plugin', slug: 'reference/plugin' },
						{ label: 'How the engine works', translations: { 'pt-BR': 'Como o engine funciona' }, slug: 'reference/how-the-engine-works' },
					],
				},
				{
					label: 'Project', translations: { 'pt-BR': 'Projeto' },
					items: [
						{ label: 'Known limits', translations: { 'pt-BR': 'Limites conhecidos' }, slug: 'project/known-limits' },
						{ label: 'Repository structure', translations: { 'pt-BR': 'Estrutura do repositório' }, slug: 'project/repository' },
						{ label: 'Research and references', translations: { 'pt-BR': 'Pesquisa e referências' }, slug: 'project/research' },
					],
				},
			],
		}),
	],
});
