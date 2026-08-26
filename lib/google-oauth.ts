export const GOOGLE_OAUTH_CLIENT_ID_ERROR =
  "Google OAuth client ID must be the value ending in .apps.googleusercontent.com, not a Gmail address.";

const googleOAuthClientIdPattern =
  /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;

export function isGoogleOAuthClientId(value: string) {
  const clientId = value.trim();
  return clientId.length <= 300 && googleOAuthClientIdPattern.test(clientId);
}
