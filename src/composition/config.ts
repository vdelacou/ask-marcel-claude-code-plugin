export type AppConfig = { readonly logLevel: string };

export const loadConfig = (env: Readonly<Record<string, string | undefined>>): AppConfig => ({
  logLevel: env['LOG_LEVEL'] ?? 'info',
});
