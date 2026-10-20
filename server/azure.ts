export interface AzureConfig {
  endpoint: string
  key: string
  deployment: string
  apiVersion: string
}

export function getAzureConfig(env: Record<string, string>): AzureConfig {
  const endpoint = env['AZURE_OPENAI_ENDPOINT']
  const key = env['AZURE_OPENAI_KEY']
  const deployment = env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4o'
  const apiVersion = env['AZURE_OPENAI_API_VERSION'] ?? '2025-01-01-preview'
  if (!endpoint || !key) throw new Error('AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_KEY are required')
  return { endpoint, key, deployment, apiVersion }
}

export function azureChatUrl(cfg: AzureConfig): string {
  const base = cfg.endpoint.replace(/\/$/, '')
  return `${base}/openai/deployments/${cfg.deployment}/chat/completions?api-version=${cfg.apiVersion}`
}
