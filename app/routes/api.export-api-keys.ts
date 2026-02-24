import type { LoaderFunction } from '@remix-run/cloudflare';
import { LLMManager } from '~/lib/modules/llm/manager';
import { getApiKeysFromCookie } from '~/lib/api/cookies';

console.log('[api.export-api-keys] module loaded');

export const loader: LoaderFunction = async ({ context, request }) => {
  console.log('[api.export-api-keys] loader start');

  const cookieHeader = request.headers.get('Cookie');
  const apiKeysFromCookie = getApiKeysFromCookie(cookieHeader);

  // LLMManager init (이미 앱 시작 시 찍히는 로그가 있으니 보통 안전)
  const llmManager = LLMManager.getInstance(context?.cloudflare?.env as any);
  const providers = llmManager.getAllProviders();

  // 여기서는 "값(키)"을 모으되, 응답에는 절대 실 키를 내보내지 않음
  const apiKeys: Record<string, string> = { ...apiKeysFromCookie };

  for (const provider of providers) {
    if (!provider.config.apiTokenKey) continue;

    const envVarName = provider.config.apiTokenKey;
    if (apiKeys[provider.name]) continue;

    const envValue =
      (context?.cloudflare?.env as Record<string, any>)?.[envVarName] ||
      process.env[envVarName] ||
      (llmManager as any).env?.[envVarName];

    if (envValue) apiKeys[provider.name] = String(envValue);
  }

  // ✅ 안전 반환: provider별로 "set"만 내려보냄 (실 키 노출 X)
  const redacted: Record<string, string> = {};
  for (const name of Object.keys(apiKeys)) {
    redacted[name] = 'set';
  }

  console.log('[api.export-api-keys] returning providers:', Object.keys(redacted));
  return Response.json(redacted);
};